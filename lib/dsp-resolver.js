/**
 * Other-DSP resolver (WHI-2080): YouTube, Amazon Music and Deezer links for a smart link.
 *
 * Shared by the three resolution sites (page.js resolveLink, create-link POST,
 * links/route.js resolveFields). Callers gate on wantsOtherDsps(link): the link must carry includeOtherDsps === true and not be
 * spotifyOnly. Existing links never get the flag, so they stay exactly as they are.
 *
 * Rules:
 * - Never overwrites a non-empty existing value, only fills empty ones.
 * - Every outbound call is capped at 4 s, so a page render cannot hang.
 * - Never throws. A failed lookup leaves that field empty.
 * - The YouTube key is read from YOUTUBE_API_KEY and is never logged.
 */
import { deezerSearch, deezerIsrcLookup } from './isrc-resolver.js';
import { parseSpotifyTrackId } from './link-match.js';

export const DSP_TIMEOUT_MS = 4000;

// A lookup that found nothing is not retried on every render (YouTube search costs quota).
const MISS_TTL_MS = 30 * 60 * 1000;
const misses = new Map();
// metadata and page both resolve the same link in one request: share the work.
const inflight = new Map();

let warnedNoYoutubeKey = false;
let warnedYoutubeFailure = false;

function withTimeout(promise, ms = DSP_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function norm(s) {
  return decodeEntities(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Pick the best YouTube search item for a song.
 * First result whose title contains the song title, preferring a channel named after the
 * artist or an auto-generated "- Topic" channel. Falls back to the first result.
 */
export function pickYoutubeVideo(items, artist, title) {
  const list = (items || []).filter((i) => i?.id?.videoId);
  if (list.length === 0) return null;
  const t = norm(title);
  const a = norm(artist);
  const titleMatches = list.filter((i) => norm(i.snippet?.title).includes(t));
  const preferred = titleMatches.find((i) => {
    const ch = norm(i.snippet?.channelTitle);
    return (a && ch.includes(a)) || ch.includes('topic');
  });
  return (preferred || titleMatches[0] || list[0]).id.videoId;
}

async function lookupYoutube(artist, title) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    if (!warnedNoYoutubeKey) {
      warnedNoYoutubeKey = true;
      console.warn('[dsp-resolver] YOUTUBE_API_KEY is not set, skipping YouTube lookup');
    }
    return '';
  }
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10',
      maxResults: '5',
      q: `${artist} ${title}`,
      key,
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      signal: AbortSignal.timeout(DSP_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (!warnedYoutubeFailure) {
        warnedYoutubeFailure = true;
        console.warn(`[dsp-resolver] YouTube search failed with HTTP ${res.status}`);
      }
      return '';
    }
    const data = await res.json();
    const id = pickYoutubeVideo(data?.items, artist, title);
    return id ? `https://www.youtube.com/watch?v=${id}` : '';
  } catch (err) {
    if (!warnedYoutubeFailure) {
      warnedYoutubeFailure = true;
      console.warn('[dsp-resolver] YouTube search error:', err?.name || 'error');
    }
    return '';
  }
}

async function lookupDeezer(artist, title, isrc) {
  try {
    if (isrc) {
      const byIsrc = await withTimeout(deezerIsrcLookup(isrc));
      if (byIsrc?.deezerUrl) return byIsrc.deezerUrl;
    }
    if (artist && title) {
      const bySearch = await withTimeout(deezerSearch(artist, title));
      if (bySearch?.deezerUrl) return bySearch.deezerUrl;
    }
  } catch (err) {
    console.warn('[dsp-resolver] Deezer lookup error:', err?.name || 'error');
  }
  return '';
}

/** Amazon has no public lookup, so this is a search link for the exact song. */
export function amazonSearchUrl(artist, title) {
  return `https://music.amazon.com/search/${encodeURIComponent(`${artist} ${title}`)}`;
}

// ── YouTube quota guard (round 3): search.list costs 100 of 10,000 units/day ──
export const YOUTUBE_RECHECK_MS = 24 * 60 * 60 * 1000;

/**
 * True when a YouTube lookup may run at render time: the link has no YouTube url and was never
 * checked, or was last checked 24 h or more ago. A checked-at in the future (clock skew, bad
 * client value) beyond 5 minutes counts as due, so it can never block lookups for good.
 */
export function youtubeDue(link, now = Date.now()) {
  if (link?.youtubeUrl && isAllowedDspUrl('youtubeUrl', link.youtubeUrl)) return false;
  const t = Date.parse(link?.youtubeCheckedAt || '');
  if (!Number.isFinite(t)) return true;
  if (t > now + 5 * 60 * 1000) return true;
  return now - t >= YOUTUBE_RECHECK_MS;
}

// ── URL allowlist for the new fields (round 3) ──
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const DEEZER_HOSTS = new Set(['deezer.com', 'www.deezer.com', 'deezer.page.link']);
const AMAZON_MUSIC_HOST = /^music\.amazon\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2,3})$/;

function httpsHost(value) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** field is youtubeUrl, amazonMusicUrl or deezerUrl. Blank is not allowed here (callers handle blank). */
export function isAllowedDspUrl(field, value) {
  const host = httpsHost(value);
  if (!host) return false;
  if (field === 'youtubeUrl') return YOUTUBE_HOSTS.has(host);
  if (field === 'amazonMusicUrl') return AMAZON_MUSIC_HOST.test(host);
  if (field === 'deezerUrl') return DEEZER_HOSTS.has(host);
  return false;
}

/**
 * Validate client-supplied values for the new fields (create, update-link, links PUT).
 * Blank string clears a field. Returns { values, errors }; values holds only the keys that were present.
 */
export function validateDspInput(input = {}) {
  const values = {};
  const errors = [];
  for (const field of ['youtubeUrl', 'amazonMusicUrl', 'deezerUrl']) {
    const v = input[field];
    if (v === undefined) continue;
    if (v === '') { values[field] = ''; continue; }
    if (!isAllowedDspUrl(field, v)) {
      errors.push(`${field} must be an https link on an allowed ${field === 'youtubeUrl' ? 'YouTube' : field === 'amazonMusicUrl' ? 'Amazon Music' : 'Deezer'} domain`);
      continue;
    }
    values[field] = v.trim();
  }
  if (input.youtubeCheckedAt !== undefined) {
    const v = input.youtubeCheckedAt;
    if (v === '') values.youtubeCheckedAt = '';
    else if (typeof v === 'string' && Number.isFinite(Date.parse(v))) values.youtubeCheckedAt = new Date(v).toISOString();
    else errors.push('youtubeCheckedAt must be an ISO date string');
  }
  return { values, errors };
}

/**
 * Fields clients may never write on update (WHI-2080 round 4). youtubeCheckedAt is stamped only by the
 * resolver/persist path (and set server-side by create-link), so a client cannot suppress or force a lookup.
 */
export const SERVER_ONLY_UPDATE_FIELDS = ['youtubeCheckedAt'];

/** Copy of a client body with the server-only fields removed (the original is not changed). */
export function stripServerOnlyFields(body = {}) {
  const out = { ...body };
  for (const f of SERVER_ONLY_UPDATE_FIELDS) delete out[f];
  return out;
}

/** "A", "A and B", "A, B and C" (no Oxford comma). */
export function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The services a visitor will see on the page, in page order, as plain text. */
export function servicesText(link) {
  const names = [];
  if (link?.spotifyUrl) names.push('Spotify');
  if (link?.appleMusicUrl) names.push('Apple Music');
  const v = visibleOtherDsps(link);
  if (v.youtubeUrl) names.push('YouTube');
  if (v.amazonMusicUrl) names.push('Amazon Music');
  if (v.deezerUrl) names.push('Deezer');
  return joinNames(names);
}

/** Fields every API response should carry for the new services. */
export function dspResponseFields(link) {
  const v = visibleOtherDsps(link);
  return {
    youtubeUrl: v.youtubeUrl,
    amazonMusicUrl: v.amazonMusicUrl,
    deezerUrl: v.deezerUrl,
    youtubeCheckedAt: link?.youtubeCheckedAt || '',
    includeOtherDsps: wantsOtherDsps(link),
    servicesText: servicesText(link),
  };
}

function missed(field, key) {
  const at = misses.get(`${field}|${key}`);
  if (at && Date.now() - at < MISS_TTL_MS) return true;
  misses.delete(`${field}|${key}`);
  return false;
}

async function resolveOnce({ artist, title, isrc, existing, force }) {
  const have = existing || {};
  // A stored value that fails the allowlist counts as empty, so resolution can repair it.
  const good = (field) => (have[field] && isAllowedDspUrl(field, have[field]) ? have[field] : '');
  const out = {
    youtubeUrl: good('youtubeUrl'),
    amazonMusicUrl: good('amazonMusicUrl'),
    deezerUrl: good('deezerUrl'),
    youtubeCheckedAt: have.youtubeCheckedAt || '',
  };
  if (!artist || !title) return out;
  const key = `${norm(artist)}|${norm(title)}`;

  // Values the resolver finds must pass the same allowlist as client values; otherwise they stay blank.
  const accept = (field, url) => (url && isAllowedDspUrl(field, url) ? url : '');

  const tasks = [];
  if (!out.amazonMusicUrl) out.amazonMusicUrl = accept('amazonMusicUrl', amazonSearchUrl(artist, title));
  // YouTube search is quota-priced: runs at create / explicit resolve (force), or at render only when never checked or 24 h stale.
  if (!out.youtubeUrl && (force || youtubeDue(have)) && !missed('yt', key)) {
    // Stamped when the lookup starts, hit or miss, so a slow or failed call is not retried on every render.
    out.youtubeCheckedAt = new Date().toISOString();
    tasks.push(
      lookupYoutube(artist, title).then((u) => {
        const ok = accept('youtubeUrl', u);
        if (ok) out.youtubeUrl = ok;
        else if (process.env.YOUTUBE_API_KEY) misses.set(`yt|${key}`, Date.now());
      }).catch(() => {}) // a failed lookup keeps the stamp so renders do not retry at once
    );
  }
  if (!out.deezerUrl && !missed('dz', key)) {
    tasks.push(
      lookupDeezer(artist, title, isrc).then((u) => {
        const ok = accept('deezerUrl', u);
        if (ok) out.deezerUrl = ok;
        else misses.set(`dz|${key}`, Date.now());
      }).catch(() => {})
    );
  }
  // One shared deadline for the whole resolution, not one per lookup. Whatever finished is kept.
  await withTimeout(Promise.all(tasks));
  return out;
}

/**
 * Resolve YouTube, Amazon Music and Deezer links.
 * Returns { youtubeUrl, amazonMusicUrl, deezerUrl }; fields already set on `existing` are returned unchanged.
 * Playlist and album Spotify URLs are skipped (a text search for a playlist name finds the wrong thing).
 */
export async function resolveOtherDsps({ artist, title, isrc, spotifyUrl, existing, force = false } = {}) {
  const have = existing || {};
  const passthrough = {
    youtubeUrl: have.youtubeUrl || '',
    amazonMusicUrl: have.amazonMusicUrl || '',
    deezerUrl: have.deezerUrl || '',
    youtubeCheckedAt: have.youtubeCheckedAt || '',
  };
  try {
    if (spotifyUrl && !parseSpotifyTrackId(spotifyUrl)) return passthrough;
    const flight = `${parseSpotifyTrackId(spotifyUrl) || ''}|${isrc || ''}|${norm(artist)}|${norm(title)}|${passthrough.youtubeUrl}|${passthrough.amazonMusicUrl}|${passthrough.deezerUrl}|${passthrough.youtubeCheckedAt}|${force ? 1 : 0}`;
    if (!inflight.has(flight)) {
      const p = resolveOnce({ artist, title, isrc, existing: have, force })
        .catch(() => passthrough)
        .finally(() => inflight.delete(flight));
      inflight.set(flight, p);
    }
    return await inflight.get(flight);
  } catch {
    return passthrough;
  }
}

/** The fields that resolution newly filled in, ready to persist. */
export function dspUpdates(existing, resolved) {
  const updates = {};
  for (const k of ['youtubeUrl', 'amazonMusicUrl', 'deezerUrl']) {
    const have = existing?.[k] && isAllowedDspUrl(k, existing[k]);
    if (resolved?.[k] && !have && isAllowedDspUrl(k, resolved[k])) updates[k] = resolved[k];
  }
  if (resolved?.youtubeCheckedAt && resolved.youtubeCheckedAt !== (existing?.youtubeCheckedAt || '')) {
    updates.youtubeCheckedAt = resolved.youtubeCheckedAt;
  }
  return updates;
}

const isTrue = (v) => v === true || v === 'true';
const isFalse = (v) => v === false || v === 'false';

/**
 * includeOtherDsps for a new link. Rise's Bubble connector may send booleans or the text
 * "true"/"false". Explicit includeOtherDsps wins; an explicit spotifyOnly false also opts in.
 * A missing spotifyOnly is legacy behaviour: false.
 */
export function includeOtherDspsFromBody(body = {}) {
  const explicit = parseIncludeFlag(body.includeOtherDsps);
  if (explicit !== undefined) return explicit;
  return isFalse(body.spotifyOnly);
}

/** Normalise an explicit includeOtherDsps value from update-link. Returns undefined if not a flag. */
export function parseIncludeFlag(v) {
  if (isTrue(v)) return true;
  if (isFalse(v)) return false;
  return undefined;
}

/** True when YouTube/Amazon/Deezer should be resolved and shown. spotifyOnly always wins. */
export function wantsOtherDsps(link) {
  return !!link && link.includeOtherDsps === true && !isTrue(link.spotifyOnly);
}

/** The three URLs a client may see: blank unless the link opted in. */
export function visibleOtherDsps(link) {
  const on = wantsOtherDsps(link);
  // A stored value outside the allowlist is never rendered (it becomes an href on the page).
  const pick = (field) => (on && link[field] && isAllowedDspUrl(field, link[field]) ? link[field] : '');
  return {
    youtubeUrl: pick('youtubeUrl'),
    amazonMusicUrl: pick('amazonMusicUrl'),
    deezerUrl: pick('deezerUrl'),
  };
}
