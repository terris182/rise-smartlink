/**
 * Persistence for auto-curator jobs, stored in Vercel KV.
 * Falls back to an in-memory Map for local dev (no KV configured).
 *
 * Job shape:
 * {
 *   id, name,
 *   sourcePlaylistId, sourcePlaylistName,
 *   targetPlaylistId, targetPlaylistName,
 *   energyDirection: 'desc' | 'asc',   // desc = high energy at top (default)
 *   removeFromSource: boolean,         // clear submissions after adding
 *   active: boolean,                   // included in scheduled runs
 *   cadence: 'manual' | 'daily',       // 'daily' runs on the cron
 *   createdAt, lastRun, lastResult
 * }
 */

import { kv } from '@vercel/kv';
import { v4 as uuidv4 } from 'uuid';

const PREFIX = 'curator:job:';
const kvAvailable = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const memStore = new Map();

export async function getAllJobs() {
  if (!kvAvailable) return Array.from(memStore.values());
  try {
    const keys = await kv.keys(`${PREFIX}*`);
    if (!keys.length) return [];
    const jobs = await Promise.all(keys.map((k) => kv.get(k)));
    return jobs.filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch (err) {
    console.error('[curator-jobs] getAll error:', err);
    return [];
  }
}

export async function getJob(id) {
  if (!kvAvailable) return memStore.get(id) || null;
  try {
    return (await kv.get(`${PREFIX}${id}`)) || null;
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
    mode: (data.mode ?? existing?.mode) === 'resort' ? 'resort' : 'insert',
    excludeTopN: (() => {
      const v = data.excludeTopN ?? existing?.excludeTopN;
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 0) return n;
      // sensible default per mode: insert protects 5, resort pins 3
      return (data.mode ?? existing?.mode) === 'resort' ? 3 : 5;
    })(),
    placementMode: (data.placementMode ?? existing?.placementMode) === 'throughout' ? 'throughout' : 'window',
    windowSize: (() => {
      const n = parseInt(data.windowSize ?? existing?.windowSize, 10);
      return Number.isFinite(n) && n > 0 ? n : 30;
    })(),
    removeFromSource: data.removeFromSource ?? existing?.removeFromSource ?? false,
    active: data.active ?? existing?.active ?? true,
    cadence: (data.cadence ?? existing?.cadence) === 'daily' ? 'daily' : 'manual',
    createdAt: existing?.createdAt || new Date().toISOString(),
    lastRun: existing?.lastRun || null,
    lastResult: existing?.lastResult || null,
  };
}

async function save(job) {
  if (!kvAvailable) {
    memStore.set(job.id, job);
    return job;
  }
  await kv.set(`${PREFIX}${job.id}`, job);
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
  if (!kvAvailable) return memStore.delete(id);
  try {
    await kv.del(`${PREFIX}${id}`);
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
