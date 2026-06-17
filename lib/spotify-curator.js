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
  let url = `/playlists/${playlistId}/tracks?limit=100&fields=items(is_local,added_at,track(id,uri,name,type)),next`;
  while (url) {
    const res = await api(url);
    if (!res.ok) throw new Error(`getPlaylistTracks failed: ${res.status}`);
    const data = await res.json();
    for (const it of data.items || []) {
      const t = it.track;
      if (!t || it.is_local || t.type !== 'track' || !t.id || !t.uri) continue;
      out.push({ id: t.id, uri: t.uri, name: t.name || '', addedAt: it.added_at || null });
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
 * Dispatcher: run one curation pass for a job, choosing the mode.
 *  - mode 'insert' (default): ADD-ONLY. Existing target tracks never move; new
 *    submissions are slotted next to their closest-energy neighbour, below the
 *    protected top `excludeTopN`.
 *  - mode 'resort': full energy re-sort of the target, top `excludeTopN` pinned.
 */
export async function curateOnce(job) {
  if (job.mode === 'resort') return runResort(job);
  if (job.mode === 'refresh') return runRefresh(job);
  return runInsert(job);
}

function withEnergy(tracks, energy) {
  return tracks.map((t) => ({ ...t, e: energy.has(t.id) ? energy.get(t.id) : null }));
}

// Higher rank = belongs higher in the playlist. Missing energy always sinks.
function energyRank(e, direction) {
  if (e == null) return Number.NEGATIVE_INFINITY;
  return direction === 'asc' ? -e : e;
}

/**
 * ADD-ONLY curation (the "tout method"). Keeps the existing target order
 * untouched and inserts each new submission at the position whose energy
 * neighbour is the closest fit — never above the protected top `excludeTopN`.
 * Placement is constrained to the first `windowSize` positions (default 30;
 * lower-energy tracks get capped there — the "more forgiving toward 30"
 * behaviour) or searched throughout the whole playlist.
 */
export async function runInsert(job) {
  const direction = job.energyDirection === 'asc' ? 'asc' : 'desc';
  const excludeTopN = Math.max(0, Number.isFinite(+job.excludeTopN) ? +job.excludeTopN : 5);
  const placement = job.placementMode === 'throughout' ? 'throughout' : 'window';
  const windowSize = Math.max(excludeTopN, Number.isFinite(+job.windowSize) ? +job.windowSize : 30);

  const [sourceTracks, targetTracks] = await Promise.all([
    getPlaylistTracks(job.sourcePlaylistId),
    getPlaylistTracks(job.targetPlaylistId),
  ]);

  const floor = Math.min(excludeTopN, targetTracks.length);
  const pinnedIds = new Set(targetTracks.slice(0, floor).map((t) => t.id));

  // De-dupe submissions; skip any that are currently pinned in the protected top.
  const srcSeen = new Set();
  const toPlace = [];
  for (const t of sourceTracks) {
    if (srcSeen.has(t.id) || pinnedIds.has(t.id)) continue;
    srcSeen.add(t.id);
    toPlace.push(t);
  }

  if (toPlace.length === 0) {
    return { ok: true, mode: 'insert', added: 0, total: targetTracks.length, message: 'Nothing to add (submissions empty or already pinned in the protected top).' };
  }

  // A submission already in the playlist (below the protected top) is PULLED OUT
  // and re-curated by energy via the normal insert process — not skipped.
  const placeIds = new Set(toPlace.map((t) => t.id));
  const targetIds = new Set(targetTracks.map((t) => t.id));
  const base = targetTracks.filter((t, i) => i < floor || !placeIds.has(t.id));

  let addedNew = 0;
  let repositioned = 0;
  for (const t of toPlace) targetIds.has(t.id) ? (repositioned += 1) : (addedNew += 1);

  const energy = await getEnergyMap([...base, ...toPlace].map((t) => t.id));
  const working = withEnergy(base, energy);
  // Place higher-ranked tracks first so multiple adds nest correctly.
  const incoming = withEnergy(toPlace, energy)
    .sort((a, b) => energyRank(b.e, direction) - energyRank(a.e, direction));

  const placements = [];
  for (const nt of incoming) {
    const rank = energyRank(nt.e, direction);
    let idx = working.length;
    for (let i = floor; i < working.length; i++) {
      if (energyRank(working[i].e, direction) < rank) { idx = i; break; }
    }
    if (idx < floor) idx = floor;
    if (placement === 'window') {
      const cap = Math.min(windowSize, working.length);
      if (idx > cap) idx = cap; // forgiving cap — lands by ~position windowSize
    }
    working.splice(idx, 0, nt);
    placements.push({ name: nt.name, position: idx + 1 });
  }

  await setPlaylistTracks(job.targetPlaylistId, working.map((t) => t.uri));

  let removed = 0;
  if (job.removeFromSource && sourceTracks.length) {
    removed = await removeTracks(job.sourcePlaylistId, sourceTracks.map((t) => t.uri));
  }

  return {
    ok: true,
    mode: 'insert',
    added: addedNew,
    repositioned,
    total: working.length,
    removedFromSource: removed,
    excludeTopN,
    placement,
    placements: placements.slice(0, 25),
    message: `Curated ${incoming.length} submission(s) by energy: ${addedNew} new + ${repositioned} re-positioned (top ${excludeTopN} protected; ${placement === 'window' ? `within first ${windowSize}` : 'throughout'}). Target now ${working.length} tracks.`,
  };
}

/**
 * FULL ENERGY RE-SORT. Re-sorts the target by energy, keeping the top
 * `excludeTopN` tracks pinned in their current order. If a source playlist is
 * set, its new tracks are folded into the sortable pool.
 */
export async function runResort(job) {
  const direction = job.energyDirection === 'asc' ? 'asc' : 'desc';
  const pinN = Math.max(0, Number.isFinite(+job.excludeTopN) ? +job.excludeTopN : 3);

  const targetTracks = await getPlaylistTracks(job.targetPlaylistId);
  let sourceTracks = [];
  if (job.sourcePlaylistId) sourceTracks = await getPlaylistTracks(job.sourcePlaylistId);

  if (targetTracks.length === 0 && sourceTracks.length === 0) {
    return { ok: true, mode: 'resort', total: 0, message: 'Target playlist empty — nothing to re-sort.' };
  }

  const pinned = targetTracks.slice(0, pinN);
  const pinnedIds = new Set(pinned.map((t) => t.id));

  const poolMap = new Map();
  for (const t of targetTracks.slice(pinN)) if (!pinnedIds.has(t.id)) poolMap.set(t.id, t);
  let added = 0;
  for (const t of sourceTracks) {
    if (!pinnedIds.has(t.id) && !poolMap.has(t.id)) { poolMap.set(t.id, t); added += 1; }
  }
  const pool = [...poolMap.values()];

  const energy = await getEnergyMap([...pinned, ...pool].map((t) => t.id));
  const sortedPool = withEnergy(pool, energy)
    .sort((a, b) => energyRank(b.e, direction) - energyRank(a.e, direction));

  const finalUris = [...pinned, ...sortedPool].map((t) => t.uri);
  await setPlaylistTracks(job.targetPlaylistId, finalUris);

  let removed = 0;
  if (job.removeFromSource && sourceTracks.length) {
    removed = await removeTracks(job.sourcePlaylistId, sourceTracks.map((t) => t.uri));
  }

  return {
    ok: true,
    mode: 'resort',
    added,
    total: finalUris.length,
    pinned: pinned.length,
    removedFromSource: removed,
    message: `Re-sorted by energy (${direction === 'desc' ? 'high→low' : 'low→high'}); top ${pinned.length} pinned${added ? `; ${added} added from source` : ''}. ${finalUris.length} tracks total.`,
  };
}

/**
 * PLAYLIST REFRESH. Keeps the top `excludeTopN` pinned, then re-stacks the rest
 * by how recently each track was ADDED to the playlist — newest tier on top,
 * oldest sinking to the bottom — and energy-sorts within each tier:
 *   Tier 1: added ≤ 14 days ago
 *   Tier 2: added 14–28 days ago
 *   Tier 3: added 28–60 days ago (1–2 months)
 *   Tier 4: everything older (added long ago) → bottom
 * Optional source playlist folds in new tracks (treated as just-added → Tier 1).
 */
export async function runRefresh(job) {
  const direction = job.energyDirection === 'asc' ? 'asc' : 'desc';
  const pinN = Math.max(0, Number.isFinite(+job.excludeTopN) ? +job.excludeTopN : 3);

  const targetTracks = await getPlaylistTracks(job.targetPlaylistId);
  let sourceTracks = [];
  if (job.sourcePlaylistId) sourceTracks = await getPlaylistTracks(job.sourcePlaylistId);

  if (targetTracks.length === 0 && sourceTracks.length === 0) {
    return { ok: true, mode: 'refresh', total: 0, message: 'Target playlist empty — nothing to refresh.' };
  }

  const pinned = targetTracks.slice(0, pinN);
  const pinnedIds = new Set(pinned.map((t) => t.id));

  // Pool = remaining target tracks (keep their addedAt) + new source tracks (just-added).
  const poolMap = new Map();
  for (const t of targetTracks.slice(pinN)) if (!pinnedIds.has(t.id)) poolMap.set(t.id, t);
  const nowIso = new Date().toISOString();
  let added = 0;
  for (const t of sourceTracks) {
    if (!pinnedIds.has(t.id) && !poolMap.has(t.id)) { poolMap.set(t.id, { ...t, addedAt: nowIso }); added += 1; }
  }
  const pool = [...poolMap.values()];

  const energy = await getEnergyMap([...pinned, ...pool].map((t) => t.id));

  const DAY = 86400000;
  const now = Date.now();
  const ageDays = (t) => {
    const ts = t.addedAt ? Date.parse(t.addedAt) : NaN;
    return Number.isFinite(ts) ? (now - ts) / DAY : Infinity; // unknown add date = oldest
  };
  const tierOf = (t) => {
    const d = ageDays(t);
    if (d <= 14) return 0;
    if (d <= 28) return 1;
    if (d <= 60) return 2;
    return 3;
  };

  const tiers = [[], [], [], []];
  for (const t of withEnergy(pool, energy)) tiers[tierOf(t)].push(t);
  for (const tier of tiers) tier.sort((a, b) => energyRank(b.e, direction) - energyRank(a.e, direction));

  const ordered = [...pinned, ...tiers[0], ...tiers[1], ...tiers[2], ...tiers[3]];
  await setPlaylistTracks(job.targetPlaylistId, ordered.map((t) => t.uri));

  let removed = 0;
  if (job.removeFromSource && sourceTracks.length) {
    removed = await removeTracks(job.sourcePlaylistId, sourceTracks.map((t) => t.uri));
  }

  const counts = tiers.map((t) => t.length);
  return {
    ok: true,
    mode: 'refresh',
    added,
    total: ordered.length,
    pinned: pinned.length,
    removedFromSource: removed,
    tierCounts: { '≤2w': counts[0], '2-4w': counts[1], '1-2mo': counts[2], older: counts[3] },
    message: `Refreshed: top ${pinned.length} pinned; recency tiers ≤2w:${counts[0]}, 2-4w:${counts[1]}, 1-2mo:${counts[2]}, older:${counts[3]} (each energy-sorted, oldest at bottom)${added ? `; ${added} new added` : ''}. ${ordered.length} tracks.`,
  };
}
