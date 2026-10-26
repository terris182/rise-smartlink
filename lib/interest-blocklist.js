/**
 * WHI-2305: internal note + blocklist for Meta interests that failed validation.
 * Stored in the project's existing Supabase (table meta_interest_blocklist, see
 * supabase/migrations/20261026000000_*). Every function fails soft: if Supabase is
 * not configured or the table is missing, nothing is recorded and nothing is filtered.
 */
import { createClient } from '@supabase/supabase-js';

const TABLE = 'meta_interest_blocklist';
const TTL = 60 * 1000;
let _client = null;
let _testClient = null;
let _cache = null; // { at, ids:Set, names:Set }

/** Tests only: route all reads/writes through a fake client (null to reset). */
export function __setTestClient(c) { _testClient = c; _cache = null; }
export function __resetCache() { _cache = null; }

function getClient() {
  if (_testClient) return _testClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!_client) _client = createClient(url, key, { global: { fetch: (i, init) => fetch(i, { ...init, cache: 'no-store' }) } });
  return _client;
}

const norm = (s) => String(s || '').trim().toLowerCase();

// Every database call is bounded so a stalled database can never hold up targeting.
const DB_TIMEOUT_MS = 1500;
const bounded = (promise) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), DB_TIMEOUT_MS))]);

async function note(row) {
  const c = getClient();
  if (!c) return false;
  try {
    const { error } = await bounded(Promise.resolve(c.rpc('note_meta_interest', {
      p_key: row.key ?? null, p_kind: row.kind ?? null, p_interest_id: row.interest_id ?? null, p_name: row.name ?? null, p_reason: row.reason ?? null, p_campaign_id: row.campaign_id ?? null,
    })));
    if (error) { console.error('[interest-blocklist] write', error.message); return false; }
    _cache = null;
    return true;
  } catch (e) { console.error('[interest-blocklist] write', e.message); return false; }
}

/** An interest Meta rejected: remember it so the picker stops offering it. */
export function recordBlockedInterest({ id, name, reason, campaignId }) {
  const k = String(id || '').trim() || norm(name);
  if (!k) return Promise.resolve(false);
  return note({ key: 'interest:' + k, kind: 'interest', interest_id: id ? String(id) : null, name: name || null, reason: reason || 'failed Meta validation', campaign_id: campaignId || null });
}

/** Custom targeting arrived with no valid countries (Big 5 used instead). */
export function recordNoCountries({ campaignId }) {
  return note({ key: 'no_countries:' + (campaignId || 'unknown'), kind: 'no_countries', reason: 'no countries', campaign_id: campaignId || null });
}

/** Blocked interest ids and lowercased names (cached 60s, empty on any failure). */
export async function getBlocked() {
  if (_cache && Date.now() - _cache.at < TTL) return _cache;
  const out = { at: Date.now(), ids: new Set(), names: new Set() };
  const c = getClient();
  if (c) {
    try {
      const { data, error } = await bounded(Promise.resolve(c.from(TABLE).select('interest_id, name').eq('kind', 'interest')));
      // Block by id when we have one (a shared display name must not hide other valid interests); name only for id-less rows.
      if (!error && Array.isArray(data)) for (const r of data) { if (r.interest_id) out.ids.add(String(r.interest_id)); else if (r.name) out.names.add(norm(r.name)); }
    } catch (e) { console.error('[interest-blocklist] read', e.message); }
  }
  _cache = out;
  return out;
}

export function isBlocked(blocked, { id, name }) {
  if (id && blocked.ids.has(String(id))) return true;
  return !id && blocked.names.has(norm(name));
}

export async function filterBlocked(list) {
  const b = await getBlocked();
  return list.filter((x) => !isBlocked(b, x));
}
