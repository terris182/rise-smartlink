/**
 * Persistence for auto-curator jobs, stored in Supabase Postgres.
 * Falls back to in-memory Map for local dev (no Supabase configured).
 *
 * Job shape stored as JSONB in curator_jobs table.
 */
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Curator uses its OWN isolated Supabase project when configured (WHI-830),
// falling back to the shared project. Keeps the curator off the shared
// free-tier DB that periodically freezes writes (WHI-774/829).
const supabaseUrl = process.env.SUPABASE_CURATOR_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_CURATOR_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAvailable = !!(supabaseUrl && supabaseKey);
let _client = null;
function getClient() {
  // WHI-883: force no-store on every Supabase REST call. Next.js patches global
  // fetch with a data cache that froze health-check reads at deploy time
  // (same failure family as the WHI-687 Spotify-call caching) — lastRun looked
  // stuck at the last pre-deploy run and the failsafe emailed false alarms.
  if (!_client && supabaseAvailable) {
    _client = createClient(supabaseUrl, supabaseKey, {
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    });
  }
  return _client;
}

const memStore = new Map();

export async function getAllJobs() {
  if (!supabaseAvailable) return Array.from(memStore.values());
  try {
    const { data, error } = await getClient()
      .from('curator_jobs')
      .select('data')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map((r) => r.data).filter(Boolean);
  } catch (err) {
    console.error('[curator-jobs] getAll error:', err);
    return [];
  }
}

export async function getJob(id) {
  if (!supabaseAvailable) return memStore.get(id) || null;
  try {
    const { data, error } = await getClient()
      .from('curator_jobs')
      .select('data')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    return data.data || null;
  } catch (err) {
    console.error('[curator-jobs] get error:', err);
    return null;
  }
}

function normalize(data, existing) {
  return {
    id: existing?.id || data.id || uuidv4(),
    name: data.name ?? existing?.name ?? 'Untitled curation',
    sourcePlaylistId: data.sourcePlaylistId ?? existing?.sourcePlaylistId ?? '',
    sourcePlaylistName: data.sourcePlaylistName ?? existing?.sourcePlaylistName ?? '',
    targetPlaylistId: data.targetPlaylistId ?? existing?.targetPlaylistId ?? '',
    targetPlaylistName: data.targetPlaylistName ?? existing?.targetPlaylistName ?? '',
    energyDirection: (data.energyDirection ?? existing?.energyDirection) === 'asc' ? 'asc' : 'desc',
    mode: ['resort', 'refresh', 'insert'].includes(data.mode ?? existing?.mode) ? (data.mode ?? existing?.mode) : 'insert',
    excludeTopN: (() => {
      const v = data.excludeTopN ?? existing?.excludeTopN;
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 0) return n;
      return (data.mode ?? existing?.mode) === 'insert' || !(data.mode ?? existing?.mode) ? 5 : 3;
    })(),
    placementMode: (data.placementMode ?? existing?.placementMode) === 'throughout' ? 'throughout' : 'window',
    windowSize: (() => {
      const n = parseInt(data.windowSize ?? existing?.windowSize, 10);
      return Number.isFinite(n) && n > 0 ? n : 30;
    })(),
    removeFromSource: data.removeFromSource ?? existing?.removeFromSource ?? false,
    active: data.active ?? existing?.active ?? true,
    cadence: (data.cadence ?? existing?.cadence) === 'daily' ? 'daily' : 'manual',
    dailyHours: (() => {
      const src = data.dailyHours ?? existing?.dailyHours;
      if (Array.isArray(src)) {
        const arr = [...new Set(src.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 23))];
        if (arr.length) return arr.sort((a, b) => a - b);
      }
      const n = parseInt(data.dailyHour ?? existing?.dailyHour, 10);
      return [Number.isFinite(n) && n >= 0 && n <= 23 ? n : 2];
    })(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    lastRun: existing?.lastRun || null,
    lastResult: existing?.lastResult || null,
  };
}

async function save(job) {
  if (!supabaseAvailable) {
    memStore.set(job.id, job);
    return job;
  }
  const { error } = await getClient()
    .from('curator_jobs')
    .upsert({ id: job.id, data: job, created_at: job.createdAt }, { onConflict: 'id' });
  // Surface write failures instead of swallowing them (WHI-829): a silent
  // failure here once froze run-tracking and caused false failsafe alarms.
  if (error) console.error('[curator-jobs] save/upsert failed:', error.message || error);
  return job;
}

export async function createJob(data) {
  return save(normalize(data, null));
}

export async function updateJob(id, updates) {
  const existing = await getJob(id);
  if (!existing) return null;
  return save(normalize(updates, existing));
}

export async function deleteJob(id) {
  if (!supabaseAvailable) return memStore.delete(id);
  try {
    await getClient().from('curator_jobs').delete().eq('id', id);
    return true;
  } catch (err) {
    console.error('[curator-jobs] delete error:', err);
    return false;
  }
}

export async function recordRun(id, result) {
  const existing = await getJob(id);
  if (!existing) return null;
  existing.lastRun = new Date().toISOString();
  existing.lastResult = result;
  return save(existing);
}
