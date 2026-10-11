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

function missed(field, key) {
  const at = misses.get(`${field}|${key}`);
  if (at && Date.now() - at < MISS_TTL_MS) return true;
  misses.delete(`${field}|${key}`);
  return false;
}

async function resolveOnce({ artist, title, isrc, existing }) {
  const have = existing || {};
  const out = {
    youtubeUrl: have.youtubeUrl || '',
    amazonMusicUrl: have.amazonMusicUrl || '',
    deezerUrl: have.deezerUrl || '',
  };
  if (!artist || !title) return out;
  const key = `${norm(artist)}|${norm(title)}`;

  const tasks = [];
  if (!out.amazonMusicUrl) out.amazonMusicUrl = amazonSearchUrl(artist, title);
  if (!out.youtubeUrl && !missed('yt', key)) {
    tasks.push(
      lookupYoutube(artist, title).then((u) => {
        if (u) out.youtubeUrl = u;
        else if (process.env.YOUTUBE_API_KEY) misses.set(`yt|${key}`, Date.now());
      })
    );
  }
  if (!out.deezerUrl && !missed('dz', key)) {
    tasks.push(
      lookupDeezer(artist, title, isrc).then((u) => {
        if (u) out.deezerUrl = u;
        else misses.set(`dz|${key}`, Date.now());
      })
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
export async function resolveOtherDsps({ artist, title, isrc, spotifyUrl, existing } = {}) {
  const have = existing || {};
  const passthrough = {
    youtubeUrl: have.youtubeUrl || '',
    amazonMusicUrl: have.amazonMusicUrl || '',
    deezerUrl: have.deezerUrl || '',
  };
  try {
    if (spotifyUrl && !parseSpotifyTrackId(spotifyUrl)) return passthrough;
    const flight = `${parseSpotifyTrackId(spotifyUrl) || ''}|${isrc || ''}|${norm(artist)}|${norm(title)}|${passthrough.youtubeUrl}|${passthrough.amazonMusicUrl}|${passthrough.deezerUrl}`;
    if (!inflight.has(flight)) {
      const p = resolveOnce({ artist, title, isrc, existing: have })
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
    if (resolved?.[k] && !existing?.[k]) updates[k] = resolved[k];
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
  return {
    youtubeUrl: on ? (link.youtubeUrl || '') : '',
    amazonMusicUrl: on ? (link.amazonMusicUrl || '') : '',
    deezerUrl: on ? (link.deezerUrl || '') : '',
  };
}
