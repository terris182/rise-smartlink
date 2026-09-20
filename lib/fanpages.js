/**
 * Fan page playlists (WHI-1335): the five TikTok fan pages each own a free
 * Spotify account whose single playlist feeds the video pipeline.
 *
 * Token shape (decision 1A, 2026-09-20): the Mac mini is the source of truth
 * for the five refresh tokens (~/.whitley/secrets/fanpage_spotify_<key>.json)
 * and does the 5-month reauth. After every exchange it pushes the row into the
 * curator Supabase project (table fanpage_spotify_tokens, service_role only).
 * This site only READS that table. No token is ever sent to the browser, and
 * nothing here writes back to the table.
 *
 * Spotify app: the same ontout "Tout Connect" client the curator uses
 * (SPOTIFY_CURATOR_CLIENT_ID / SECRET). Do not swap in another app; the fan
 * page refresh tokens were issued against this client_id.
 */
import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const TABLE = 'fanpage_spotify_tokens';

export const FAN_PAGE_KEYS = [
  'rnbrapradio',
  'frontporchsounds',
  'risemusicfinds',
  'altsceneradio',
  'chillbeatsradio',
];

// TikTok handle per key (from ~/.claude/skills/tiktok-flowstage). Display only.
export const FAN_PAGE_LABELS = {
  rnbrapradio: 'Night Shift (nightshiftrnb)',
  frontporchsounds: 'Porch Nights (porchlight.kate)',
  risemusicfinds: "Alex's Finds (alex.finds.music)",
  altsceneradio: 'Basement Show (altsceneradio)',
  chillbeatsradio: 'Headphones On (chillbeatsradio)',
};

const supabaseUrl = process.env.SUPABASE_CURATOR_URL;
const supabaseKey = process.env.SUPABASE_CURATOR_SERVICE_ROLE_KEY;
let _client = null;
function getClient() {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Fan pages not configured: SUPABASE_CURATOR_URL / SUPABASE_CURATOR_SERVICE_ROLE_KEY missing');
  }
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseKey, {
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    });
  }
  return _client;
}

export function isKnownKey(key) {
  return FAN_PAGE_KEYS.includes(key);
}

/** Public (token-free) view of every page row, for the page list. */
export async function listPages() {
  const { data, error } = await getClient()
    .from(TABLE)
    .select('key, spotify_user_id, display_name, playlist_id, playlist_name, next_reauth_due, obtained_at, synced_at');
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  const byKey = new Map((data || []).map((r) => [r.key, r]));
  return FAN_PAGE_KEYS.map((key) => {
    const r = byKey.get(key) || {};
    return {
      key,
      label: FAN_PAGE_LABELS[key],
      displayName: r.display_name || null,
      playlistId: r.playlist_id || null,
      playlistName: r.playlist_name || null,
      nextReauthDue: r.next_reauth_due || null,
      obtainedAt: r.obtained_at || null,
      syncedAt: r.synced_at || null,
      configured: !!(r.playlist_id && r.key),
    };
  });
}

async function loadRow(key) {
  if (!isKnownKey(key)) throw new Error(`Unknown fan page key: ${key}`);
  const { data, error } = await getClient().from(TABLE).select('*').eq('key', key).maybeSingle();
  if (error) throw new Error(`Supabase read failed: ${error.message}`);
  if (!data || !data.refresh_token) throw new Error(`No token on file for ${key}; run fanpage_spotify.py sync-supabase on the Mac`);
  if (!data.playlist_id) throw new Error(`No playlist_id on file for ${key}`);
  return data;
}

// Access tokens cached per key inside one lambda instance (~1h validity).
const tokenCache = new Map();

async function accessTokenFor(key) {
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiry - 60000) return cached.token;

  const clientId = process.env.SPOTIFY_CURATOR_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CURATOR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('SPOTIFY_CURATOR_CLIENT_ID / SECRET not configured');

  const row = await loadRow(key);
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    cache: 'no-store',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify token refresh failed for ${key} (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  tokenCache.set(key, { token: json.access_token, expiry: Date.now() + (json.expires_in || 3600) * 1000 });
  return json.access_token;
}

async function spotifyCall(key, method, path, body) {
  const token = await accessTokenFor(key);
  const res = await fetch(`${API}${path}`, {
    method,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 200) || res.statusText;
    throw new Error(`Spotify ${method} ${path} failed (${res.status}): ${msg}`);
  }
  return json;
}

/** Exported for lib/fanpages-suggest.js: any Spotify GET under this page's token. */
export async function spotifyCallForKey(key, method, path, body) {
  return spotifyCall(key, method, path, body);
}

function shapeTrack(item, index) {
  const t = item?.track;
  if (!t) return null;
  return {
    position: index,
    uri: t.uri,
    id: t.id,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album?.name || '',
    cover: t.album?.images?.[t.album.images.length - 1]?.url || null,
    durationMs: t.duration_ms || 0,
    addedAt: item.added_at || null,
    url: t.external_urls?.spotify || null,
  };
}

/** Every track on the page's playlist, in playlist order. */
export async function listTracks(key) {
  const row = await loadRow(key);
  const tracks = [];
  // /items paths + limit 50 match fanpage_spotify.py (live-confirmed 2026-09-18/20).
  let path = `/playlists/${row.playlist_id}/items?limit=50&fields=items(added_at,track(id,uri,name,duration_ms,external_urls,artists(name),album(name,images))),next,total`;
  let total = 0;
  while (path) {
    const page = await spotifyCall(key, 'GET', path);
    total = page.total ?? total;
    for (const item of page.items || []) {
      const t = shapeTrack(item, tracks.length);
      if (t) tracks.push(t);
    }
    path = page.next ? page.next.replace(API, '') : null;
  }
  return { key, playlistId: row.playlist_id, playlistName: row.playlist_name, total, tracks };
}

export async function searchTracks(key, q, limit = 10) {
  const page = await spotifyCall(
    key,
    'GET',
    `/search?type=track&limit=${Math.min(Math.max(limit, 1), 20)}&q=${encodeURIComponent(q)}`
  );
  return (page?.tracks?.items || []).map((t, i) => shapeTrack({ track: t }, i)).filter(Boolean);
}

function normalizeUris(uris) {
  const out = [];
  for (const raw of uris || []) {
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    let m = s.match(/^spotify:track:([A-Za-z0-9]{22})$/);
    if (m) { out.push(`spotify:track:${m[1]}`); continue; }
    m = s.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})/);
    if (m) { out.push(`spotify:track:${m[1]}`); continue; }
    if (/^[A-Za-z0-9]{22}$/.test(s)) { out.push(`spotify:track:${s}`); continue; }
    throw new Error(`Not a Spotify track uri/url/id: ${s}`);
  }
  return Array.from(new Set(out));
}

export async function addTracks(key, uris) {
  const row = await loadRow(key);
  const clean = normalizeUris(uris);
  if (!clean.length) throw new Error('No tracks given');
  // New songs go to the TOP of the playlist (position 0), Terris's call
  // 2026-09-20. Chunk at 100; insert chunks in reverse so that across
  // multiple chunks the overall order is preserved with the first uri
  // ending up highest.
  const chunks = [];
  for (let i = 0; i < clean.length; i += 100) chunks.push(clean.slice(i, i + 100));
  for (let c = chunks.length - 1; c >= 0; c--) {
    await spotifyCall(key, 'POST', `/playlists/${row.playlist_id}/items`, { uris: chunks[c], position: 0 });
  }
  return { added: clean };
}

export async function removeTracks(key, uris) {
  const row = await loadRow(key);
  const clean = normalizeUris(uris);
  if (!clean.length) throw new Error('No tracks given');
  for (let i = 0; i < clean.length; i += 100) {
    // Live-confirmed 2026-09-18: the body key is "items" (Spotify rejects "uris" and "tracks" here).
    await spotifyCall(key, 'DELETE', `/playlists/${row.playlist_id}/items`, {
      items: clean.slice(i, i + 100).map((uri) => ({ uri })),
    });
  }
  return { removed: clean };
}
