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
const supabaseConfigured = !!(supabaseUrl && supabaseKey);
let _client = null;
let _testClient = null;
/** Tests only: route all reads/writes through a fake supabase client (null to reset). */
export function __setTestClient(client) {
  _testClient = client;
}
const supabaseAvailable = () => !!_testClient || supabaseConfigured;
function getClient() {
  if (_testClient) return _testClient;
  // WHI-883: force no-store on every Supabase REST call. Next.js patches global
  // fetch with a data cache that froze health-check reads at deploy time
  // (same failure family as the WHI-687 Spotify-call caching) — lastRun looked
  // stuck at the last pre-deploy run and the failsafe emailed false alarms.
  if (!_client && supabaseConfigured) {
    _client = createClient(supabaseUrl, supabaseKey, {
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    });
  }
  return _client;
}

const memStore = new Map();

export async function getAllJobs() {
  if (!supabaseAvailable()) return Array.from(memStore.values());
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
  if (!supabaseAvailable()) return memStore.get(id) || null;
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

const PIN_URI = /^spotify:track:[A-Za-z0-9]{22}$/;

/**
 * WHI-2061: stored top songs. `pinnedUris` (Spotify track URIs, in order) is
 * optional; null clears it. When set it must be unique and non-empty;
 * excludeTopN is raised to fit it (see normalize).
 */
function normalizePins(data, existing) {
  const src = Object.prototype.hasOwnProperty.call(data, 'pinnedUris') ? data.pinnedUris : existing?.pinnedUris;
  if (src == null) return null;
  if (!Array.isArray(src) || src.length === 0) {
    throw new Error('pinnedUris must be a non-empty array of Spotify track URIs (or null to clear)');
  }
  const uris = src.map((u) => String(u).trim());
  const bad = uris.find((u) => !PIN_URI.test(u));
  if (bad) throw new Error(`pinnedUris: "${bad}" is not a spotify:track:<id> URI`);
  if (new Set(uris).size !== uris.length) throw new Error('pinnedUris must be unique');
  return uris;
}

function normalize(data, existing) {
  const pinnedUris = normalizePins(data, existing);
  const job = normalizeFields(data, existing, pinnedUris);
  // Pins must fit in the protected top. Older jobs often still carry the old
  // refresh/resort default of 3, so raise it rather than reject the pins.
  if (pinnedUris && pinnedUris.length > job.excludeTopN) job.excludeTopN = Math.max(5, pinnedUris.length);
  return job;
}

function normalizeFields(data, existing, pinnedUris) {
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
      // Stored pins protect the top 5 in every mode (WHI-2061).
      return (data.mode ?? existing?.mode) === 'insert' || !(data.mode ?? existing?.mode) || pinnedUris ? 5 : 3;
    })(),
    pinnedUris,
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
  if (!supabaseAvailable()) {
    memStore.set(job.id, job);
    return job;
  }
  const { error } = await getClient()
    .from('curator_jobs')
    .upsert({ id: job.id, data: job, created_at: job.createdAt }, { onConflict: 'id' });
  // Surface write failures instead of swallowing them (WHI-829): a silent
  // failure here once froze run-tracking and caused false failsafe alarms.
  // Throw so callers (the jobs API answers 500) never report a lost write as saved.
  if (error) {
    console.error('[curator-jobs] save/upsert failed:', error.message || error);
    throw Object.assign(new Error(`Saving curator job failed: ${error.message || error}`), { status: 500 });
  }
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
  if (!supabaseAvailable()) return memStore.delete(id);
  try {
    await getClient().from('curator_jobs').delete().eq('id', id);
    return true;
  } catch (err) {
    console.error('[curator-jobs] delete error:', err);
    return false;
  }
}

export async function recordRun(id, result, now = new Date()) {
  const existing = await getJob(id);
  if (!existing) return null;
  existing.lastRun = now.toISOString();
  existing.lastResult = result;
  return save(existing);
}

// ---------------------------------------------------------------------------
// WHI-2061: per-job run lease + scheduled-run guard.
// The cron route is hit at :00 by Vercel Cron and at :05 by the Mac runner
// (force=1). Both must run only jobs due this PST hour, skip a job that
// already ran successfully in this PST hour slot, and never overlap.

const LEASE_MS = 5 * 60 * 1000; // > route maxDuration (60s); a killed run's lease expires
const memLeases = new Map(); // id -> { until: ms, token }

/**
 * Take the job's lease with a conditional update (only if free or expired).
 * Returns { ok: true, token } or { ok: false, reason }.
 */
export async function acquireLease(id, { now = new Date(), ms = LEASE_MS } = {}) {
  const token = uuidv4();
  const until = new Date(now.getTime() + ms);
  if (!supabaseAvailable()) {
    const cur = memLeases.get(id);
    if (cur && cur.until > now.getTime()) return { ok: false, reason: 'lease held', held: true };
    memLeases.set(id, { until: until.getTime(), token });
    return { ok: true, token };
  }
  try {
    const { data, error } = await getClient()
      .from('curator_jobs')
      .update({ lease_until: until.toISOString(), lease_token: token })
      .eq('id', id)
      .or(`lease_until.is.null,lease_until.lt."${now.toISOString()}"`)
      .select('id');
    if (error) return { ok: false, reason: `lease unavailable: ${error.message || error}` };
    if (!data || data.length === 0) return { ok: false, reason: 'lease held', held: true };
    return { ok: true, token };
  } catch (err) {
    return { ok: false, reason: `lease unavailable: ${err.message}` };
  }
}

/** Clear the lease, only if we still hold it. */
export async function releaseLease(id, token) {
  if (!supabaseAvailable()) {
    if (memLeases.get(id)?.token === token) memLeases.delete(id);
    return;
  }
  try {
    const { error } = await getClient()
      .from('curator_jobs')
      .update({ lease_until: null, lease_token: null })
      .eq('id', id)
      .eq('lease_token', token);
    if (error) console.error('[curator-jobs] releaseLease failed:', error.message || error);
  } catch (err) {
    console.error('[curator-jobs] releaseLease error:', err);
  }
}

const TZ = 'America/Los_Angeles';
const SLOT_FMT = { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false };
export const pstHour = (d) => parseInt(d.toLocaleString('en-US', { timeZone: TZ, hour12: false, hour: '2-digit' }), 10) % 24;
export const pstSlot = (d) => d.toLocaleString('en-US', SLOT_FMT); // unique per PST hour

function ranOkInSlot(job, slot) {
  if (!job.lastRun) return false;
  return pstSlot(new Date(job.lastRun)) === slot && job.lastResult?.ok !== false;
}

/** recordRun that never throws: a failed write must not abort the other jobs. */
async function safeRecordRun(id, result, now) {
  try {
    await recordRun(id, result, now);
    return null;
  } catch (err) {
    console.error('[curator-jobs] recordRun failed:', err.message);
    return err.message;
  }
}

const lastResultSummary = (job) =>
  job?.lastResult ? { ok: job.lastResult.ok !== false, message: job.lastResult.message || '', at: job.lastResult.at || job.lastRun } : null;

/**
 * Run one job under its lease. `precheck(job)` runs after the lease is taken
 * and may return a skip reason; a skip records nothing and never calls curate.
 * Returns { result } | { error, result } | { skipped, held?, job }.
 */
async function runLeased(job, curate, now, precheck) {
  const lease = await acquireLease(job.id, { now });
  if (!lease.ok) return { skipped: lease.reason, held: !!lease.held, job };
  try {
    if (precheck) {
      const fresh = (await getJob(job.id)) || job;
      const reason = precheck(fresh);
      if (reason) return { skipped: reason, job: fresh };
      job = fresh;
    }
    try {
      const result = await curate(job);
      // lastRun = run start, so the run is credited to the slot it was started in.
      const recordError = await safeRecordRun(job.id, { ...result, at: new Date().toISOString() }, now);
      return { result: recordError ? { ...result, recordError } : result };
    } catch (err) {
      const result = { ok: false, message: err.message, at: new Date().toISOString() };
      await safeRecordRun(job.id, result, now);
      return { error: err, result };
    }
  } finally {
    await releaseLease(job.id, lease.token);
  }
}

/** Run one job now (manual run), under the lease. */
export async function runJobNow(job, curate) {
  return runLeased(job, curate, new Date());
}

/**
 * Run every active daily job that is due this PST hour.
 *  - force: accepted (Mac runner), same due-hour and slot rules as plain cron.
 *  - override: deliberately bypass the "already ran this slot" guard (not the lease).
 * `runs` lists every due job. Skips that mean "healthy" (already ran OK this
 * slot, or another run holds the lease right now) appear there as
 * { ok: true, skipped: true, reason } so the Mac runner does not raise a false
 * alarm. `ran` counts real executions only; `skipped` repeats the skips.
 * `jobs` lets tests pass a stale job list.
 */
export async function runScheduledJobs({ force = false, override = false, now = new Date(), curate, jobs }) {
  const curHour = pstHour(now);
  const curSlot = pstSlot(now);
  const runs = [];
  const skipped = [];
  let ran = 0;
  const slotGuard = (j) => (!override && ranOkInSlot(j, curSlot) ? 'already ran this slot' : null);
  for (const j of jobs || (await getAllJobs())) {
    if (!j.active || j.cadence !== 'daily') continue;
    const hours = (Array.isArray(j.dailyHours) && j.dailyHours.length ? j.dailyHours : [j.dailyHour ?? 2]).map(Number);
    if (!hours.includes(curHour)) continue;
    // Checked once on the list read (cheap), and again on fresh state once
    // the lease is held: another run may have finished in between.
    const early = slotGuard(j);
    const r = early ? { skipped: early, job: j } : await runLeased(j, curate, now, slotGuard);
    if (r.skipped) {
      skipped.push({ id: j.id, name: j.name, reason: r.skipped });
      const healthy = r.skipped === 'already ran this slot' || r.held;
      runs.push({
        id: j.id, name: j.name, ok: healthy, skipped: true, reason: r.skipped,
        ...(r.skipped === 'already ran this slot' ? { lastResult: lastResultSummary(r.job) } : {}),
      });
      continue;
    }
    ran += 1;
    if (r.error) runs.push({ id: j.id, name: j.name, ok: false, message: r.error.message });
    else runs.push({ id: j.id, name: j.name, ok: true, ...r.result });
  }
  return { ran, runs, skipped, slot: curSlot, force, override };
}
