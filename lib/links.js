/**
 * Smart link persistent store using Supabase (Postgres).
 * Falls back to Upstash KV for reads during migration (lazy-migrates found records).
 *
 * Table: smart_links (slug TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ)
 */

import { createClient } from '@supabase/supabase-js';
import { parseSpotifyTrackId, slugifyPart } from './link-match';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAvailable = !!(supabaseUrl && supabaseKey);

let _client = null;
function getClient() {
  if (!_client && supabaseAvailable) {
    _client = createClient(supabaseUrl, supabaseKey);
  }
  return _client;
}

// Upstash KV fallback (for migration period — safe to remove once Supabase is fully populated)
const kvUrl = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;
const kvAvailable = !!(kvUrl && kvToken);

async function kvGet(slug) {
  if (!kvAvailable) return null;
  try {
    const encoded = encodeURIComponent(`link:${slug}`);
    const resp = await fetch(`${kvUrl}/get/${encoded}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json?.result) return null;
    return typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
  } catch {
    return null;
  }
}

// ── Reuse index ──
// Secondary keys in the same KV store, written only when a new link is created:
//   linkidx:track:<spotifyTrackId>:<artistSlug> -> slug
//   linkidx:deal:<dealId>                       -> slug
// Written with NX so the first link for a song stays the canonical one and
// an existing entry is never repointed.
const memIndex = new Map();

function trackIndexKey(trackId, artistSlug) {
  return `linkidx:track:${trackId}:${slugifyPart(artistSlug)}`;
}

function dealIndexKey(dealId) {
  return `linkidx:deal:${String(dealId).trim()}`;
}

async function indexGet(key) {
  if (!kvAvailable) return memIndex.get(key) || null;
  try {
    const resp = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return typeof json?.result === 'string' && json.result ? json.result : null;
  } catch {
    return null;
  }
}

async function indexSetIfAbsent(key, slug) {
  if (!kvAvailable) {
    if (!memIndex.has(key)) memIndex.set(key, slug);
    return;
  }
  try {
    await fetch(kvUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${kvToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, slug, 'NX']),
    });
  } catch (err) {
    console.error('[links] index write error:', err.message);
  }
}

async function writeReuseIndex(link, dealId) {
  const trackId = parseSpotifyTrackId(link.spotifyUrl);
  const writes = [];
  if (trackId) writes.push(indexSetIfAbsent(trackIndexKey(trackId, link.artist), link.slug));
  if (dealId) writes.push(indexSetIfAbsent(dealIndexKey(dealId), link.slug));
  await Promise.all(writes);
}

/**
 * Existing link for a Spotify track id and artist (name or slug; it is
 * slugified either way), or null. The indexed link is re-read and its
 * spotifyUrl re-checked, so a stale index entry never returns the wrong song.
 */
export async function findLinkBySpotifyTrack(trackId, artistSlug) {
  if (!trackId) return null;
  const slug = await indexGet(trackIndexKey(trackId, artistSlug));
  if (!slug) return null;
  const link = await getLink(slug);
  if (!link || parseSpotifyTrackId(link.spotifyUrl) !== trackId) return null;
  return link;
}

/** Existing link created with this dealId, or null. */
export async function findLinkByDeal(dealId) {
  if (dealId === null || dealId === undefined || String(dealId).trim() === '') return null;
  const slug = await indexGet(dealIndexKey(dealId));
  if (!slug) return null;
  return getLink(slug);
}

// In-memory fallback for local dev
const memStore = new Map();

if (!supabaseAvailable) {
  memStore.set('tragedies', {
    slug: 'tragedies',
    title: 'Tragedies',
    artist: 'Vex Verity',
    coverUrl: '',
    spotifyUrl: 'https://open.spotify.com/track/4DYYlTuhtc21yJBgUs3dNy?si=7f324a4ec0cc4052',
    genre: 'Electronica',
    fbPixelId: process.env.FB_PIXEL_ID || '507044563387858',
    fbAccessToken: process.env.FB_ACCESS_TOKEN || '',
  });
}

export async function getLink(slug) {
  if (!supabaseAvailable) return memStore.get(slug) || null;
  try {
    const { data, error } = await getClient()
      .from('smart_links')
      .select('data')
      .eq('slug', slug)
      .single();
    if (!error && data?.data) return data.data;
  } catch (err) {
    console.error('[links] Supabase get error:', err);
  }

  // Fallback: try Upstash KV (migration bridge)
  const kvData = await kvGet(slug);
  if (kvData) {
    // Lazy-migrate to Supabase so next request hits Supabase
    try {
      await getClient()
        .from('smart_links')
        .upsert({ slug, data: kvData }, { onConflict: 'slug' });
    } catch {
      // non-fatal
    }
    return kvData;
  }

  return null;
}

export async function updateLink(slug, updates) {
  if (!supabaseAvailable) {
    const existing = memStore.get(slug);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    memStore.set(slug, updated);
    return updated;
  }
  try {
    const { data: row, error: getError } = await getClient()
      .from('smart_links')
      .select('data')
      .eq('slug', slug)
      .single();
    if (getError || !row) return null;
    const updated = { ...row.data, ...updates };
    const { error } = await getClient()
      .from('smart_links')
      .update({ data: updated })
      .eq('slug', slug);
    if (error) throw error;
    return updated;
  } catch (err) {
    console.error('[links] Supabase update error:', err);
    return null;
  }
}

/**
 * Create a new link. `data.dealId` is optional; it is not stored on the link
 * itself, only in the reuse index.
 */
export async function createLink(data) {
  const link = {
    slug: data.slug,
    title: data.title,
    artist: data.artist,
    coverUrl: data.coverUrl || '',
    spotifyUrl: data.spotifyUrl,
    appleMusicUrl: data.appleMusicUrl || '',
    genre: data.genre || '',
    subgenre: data.subgenre || '',
    fbPixelId: data.fbPixelId || process.env.FB_PIXEL_ID || '507044563387858',
    fbAccessToken: data.fbAccessToken || process.env.FB_ACCESS_TOKEN || '',
    bgColor: data.bgColor || '',
    spotifyOnly: data.spotifyOnly === true || data.spotifyOnly === 'true',
    presave: data.presave || false,
    presaveReleaseDate: data.presaveReleaseDate || '',
    presaveReleaseTime: data.presaveReleaseTime || '',
    spotifyArtistId: data.spotifyArtistId || '',
    spotifyTrackUri: data.spotifyTrackUri || '',
    contestEnabled: data.contestEnabled || false,
    contestUrl: data.contestUrl || '',
    contestPrizeText: data.contestPrizeText || '',
    createdAt: new Date().toISOString(),
  };

  if (!supabaseAvailable) {
    memStore.set(link.slug, link);
    await writeReuseIndex(link, data.dealId);
    return link;
  }

  try {
    const { error } = await getClient()
      .from('smart_links')
      .upsert({ slug: link.slug, data: link }, { onConflict: 'slug' });
    if (error) throw error;
    await writeReuseIndex(link, data.dealId);
    return link;
  } catch (err) {
    console.error('[links] Supabase create error:', err);
    throw err;
  }
}

export async function getAllLinks() {
  if (!supabaseAvailable) return Array.from(memStore.values());
  try {
    const { data, error } = await getClient()
      .from('smart_links')
      .select('data, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => row.data);
  } catch (err) {
    console.error('[links] Supabase getAll error:', err);
    return [];
  }
}
