/**
 * Spotify user-auth helper for the auto-curator (refresh-token flow).
 *
 * Unlike lib/spotify-api.js (client_credentials, app-only), this acts AS the
 * "tout" Spotify user (music@jack.tv) so it can read private playlists and
 * write/reorder playlist contents. It uses a long-lived refresh token to mint
 * short-lived access tokens on demand.
 *
 * IMPORTANT: The energy-based curation depends on GET /v1/audio-features, which
 * Spotify deprecated for new apps on 2026-11-27. Access is tied to the Spotify
 * APP (client_id), not the domain — so we MUST keep using the ontout "Tout
 * Connect" client_id that retained extended access. Do not swap in a new app.
 *
 * Required env vars (set in Vercel — never hardcode secrets):
 * - SPOTIFY_CURATOR_CLIENT_ID
 * - SPOTIFY_CURATOR_CLIENT_SECRET
 * - SPOTIFY_CURATOR_REFRESH_TOKEN
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

let cachedToken = null;
let tokenExpiry = 0;

export function curatorConfigured() {
  return !!(
    process.env.SPOTIFY_CURATOR_CLIENT_ID &&
    process.env.SPOTIFY_CURATOR_CLIENT_SECRET &&
    process.env.SPOTIFY_CURATOR_REFRESH_TOKEN
  );
}

/**
 * Get a user access token via the refresh_token grant. Cached until ~60s
 * before expiry.
 */
export async function getUserAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;

  if (!curatorConfigured()) {
    throw new Error(
      'Curator not configured: set SPOTIFY_CURATOR_CLIENT_ID, SPOTIFY_CURATOR_CLIENT_SECRET, SPOTIFY_CURATOR_REFRESH_TOKEN'
    );
  }

  const basic = Buffer.from(
    `${process.env.SPOTIFY_CURATOR_CLIENT_ID}:${process.env.SPOTIFY_CURATOR_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.SPOTIFY_CURATOR_REFRESH_TOKEN,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify token refresh failed: ${res.status} — ${body}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // expires_in is seconds; refresh responses may omit a new refresh_token (fine)
  tokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

/** Internal: authenticated fetch with one retry on 401 (token refresh). */
async function api(path, { method = 'GET', body, token, retry = true } = {}) {
  const accessToken = token || (await getUserAccessToken());
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401 && retry) {
    cachedToken = null;
    return api(path, { method, body, retry: false });
  }
  return res;
}

/** Current Spotify user (the connected "tout" account). */
export async function getMe() {
  const res = await api('/me');
  if (!res.ok) throw new Error(`getMe failed: ${res.status}`);
  return res.json();
}

/** List the connected user's playlists (id, name, trackCount, owner, image). */
export async function getMyPlaylists() {
  const out = [];
  let url = '/me/playlists?limit=50';
  while (url) {
    const res = await api(url);
    if (!res.ok) throw new Error(`getMyPlaylists failed: ${res.status}`);
    const data = await res.json();
    for (const p of data.items || []) {
      out.push({
        id: p.id,
        name: p.name,
        trackCount: p.tracks?.total ?? 0,
        owner: p.owner?.display_name || p.owner?.id || '',
        ownerId: p.owner?.id || '',
        collaborative: !!p.collaborative,
        image: p.images?.[0]?.url || '',
      });
    }
    url = data.next ? data.next.replace(API, '') : null;
  }
  return out;
}

/** Lightweight playlist metadata. */
export async function getPlaylistMeta(playlistId) {
  const res = await api(`/playlists/${playlistId}?fields=id,name,tracks(total),owner(id,display_name)`);
  if (!res.ok) throw new Error(`getPlaylistMeta failed: ${res.status}`);
  return res.json();
}

/**
 * Get all playable track items in a playlist, in order.
 * Skips local files and non-track items (e.g. podcast episodes).
 * Returns [{ id, uri, name }].
 */
export async function getPlaylistTracks(playlistId) {
  const out = [];
  let url = `/playlists/${playlistId}/tracks?limit=100&fields=items(is_local,track(id,uri,name,type)),next`;
  while (url) {
    const res = await api(url);
    if (!res.ok) throw new Error(`getPlaylistTracks failed: ${res.status}`);
    const data = await res.json();
    for (const it of data.items || []) {
      const t = it.track;
      if (!t || it.is_local || t.type !== 'track' || !t.id || !t.uri) continue;
      out.push({ id: t.id, uri: t.uri, name: t.name || '' });
    }
    url = data.next ? data.next.replace(API, '') : null;
  }
  return out;
}

/**
 * Fetch audio-feature "energy" for many track IDs.
 * Batches of 100 (Spotify max). Returns a Map<trackId, energy(0..1)>.
 * Tracks whose features are missing are simply absent from the map.
 */
export async function getEnergyMap(trackIds) {
  const map = new Map();
  const unique = [...new Set(trackIds)];
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const res = await api(`/audio-features?ids=${batch.join(',')}`);
    if (res.status === 403) {
      throw new Error(
        'audio-features returned 403 — this Spotify app has lost extended access. Energy sorting cannot run.'
      );
    }
    if (!res.ok) throw new Error(`audio-features failed: ${res.status}`);
    const data = await res.json();
    for (const f of data.audio_features || []) {
      if (f && typeof f.energy === 'number') map.set(f.id, f.energy);
    }
  }
  return map;
}

/**
 * Replace a playlist's entire contents with an ordered list of track URIs.
 * Spotify caps each write at 100 URIs, so we PUT the first 100 (replace) then
 * POST the rest in order (append). This guarantees the exact final ordering.
 */
export async function setPlaylistTracks(playlistId, orderedUris) {
  const first = orderedUris.slice(0, 100);
  const putRes = await api(`/playlists/${playlistId}/tracks`, {
    method: 'PUT',
    body: { uris: first },
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`setPlaylistTracks PUT failed: ${putRes.status} — ${t}`);
  }
  for (let i = 100; i < orderedUris.length; i += 100) {
    const batch = orderedUris.slice(i, i + 100);
    const postRes = await api(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: { uris: batch },
    });
    if (!postRes.ok) {
      const t = await postRes.text();
      throw new Error(`setPlaylistTracks POST failed: ${postRes.status} — ${t}`);
    }
  }
  return orderedUris.length;
}

/** Remove specific track URIs from a playlist (used to clear processed submissions). */
export async function removeTracks(playlistId, uris) {
  if (!uris.length) return 0;
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100).map((uri) => ({ uri }));
    const res = await api(`/playlists/${playlistId}/tracks`, {
      method: 'DELETE',
      body: { tracks: batch },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`removeTracks failed: ${res.status} — ${t}`);
    }
  }
  return uris.length;
}

/**
 * Run one curation pass for a job config:
 *   { sourcePlaylistId, targetPlaylistId, energyDirection: 'desc'|'asc', removeFromSource }
 *
 * Reads the submissions (source) + target playlists, fetches energy for every
 * track, merges them, sorts the whole target by energy (high->low by default so
 * each new song lands beside its energy-matched neighbors), and rewrites the
 * target playlist in that order. Optionally clears processed tracks from source.
 *
 * Returns a result summary used for the dashboard log.
 */
export async function curateOnce(job) {
  const direction = job.energyDirection === 'asc' ? 'asc' : 'desc';

  const [sourceTracks, targetTracks] = await Promise.all([
    getPlaylistTracks(job.sourcePlaylistId),
    getPlaylistTracks(job.targetPlaylistId),
  ]);

  // Union, deduped by track id: existing target first, then new submissions.
  const byId = new Map();
  for (const t of targetTracks) if (!byId.has(t.id)) byId.set(t.id, t);
  let addedCount = 0;
  for (const t of sourceTracks) {
    if (!byId.has(t.id)) {
      byId.set(t.id, t);
      addedCount += 1;
    }
  }
  const union = [...byId.values()];

  if (union.length === 0) {
    return { ok: true, added: 0, total: 0, missingEnergy: 0, message: 'Both playlists empty — nothing to curate.' };
  }

  const energy = await getEnergyMap(union.map((t) => t.id));

  // Sort by energy. Tracks with no energy data always sink to the bottom.
  const MISS = Number.NEGATIVE_INFINITY;
  const sorted = union
    .map((t) => ({ ...t, e: energy.has(t.id) ? energy.get(t.id) : null }))
    .sort((a, b) => {
      const ae = a.e == null ? MISS : a.e;
      const be = b.e == null ? MISS : b.e;
      if (ae === be) return 0;
      return direction === 'asc' ? ae - be : be - ae;
    });
  // For ascending order, missing-energy tracks would float to the top; push them down.
  if (direction === 'asc') {
    sorted.sort((a, b) => (a.e == null) - (b.e == null));
  }

  const orderedUris = sorted.map((t) => t.uri);
  await setPlaylistTracks(job.targetPlaylistId, orderedUris);

  let removed = 0;
  if (job.removeFromSource && sourceTracks.length) {
    removed = await removeTracks(job.sourcePlaylistId, sourceTracks.map((t) => t.uri));
  }

  const missingEnergy = sorted.filter((t) => t.e == null).length;
  return {
    ok: true,
    added: addedCount,
    total: orderedUris.length,
    removedFromSource: removed,
    missingEnergy,
    direction,
    message: `Added ${addedCount} new track(s); target re-sorted by energy (${direction === 'desc' ? 'high→low' : 'low→high'}), ${orderedUris.length} total${missingEnergy ? `, ${missingEnergy} without energy data placed last` : ''}.`,
  };
}
