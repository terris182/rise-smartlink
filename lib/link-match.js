/**
 * Pure helpers for matching smart links to the same song.
 * No I/O here so they can be unit tested with `node --test`.
 */

const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;

/**
 * Parse a Spotify URL or URI into { type, id }.
 * Handles open.spotify.com links (with or without an intl-xx path segment
 * or query string such as ?si=...), embed links, and spotify:type:id URIs.
 * Returns null when the input is not a recognizable Spotify resource.
 */
export function parseSpotifyResource(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();

  const uri = raw.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)$/);
  if (uri) return SPOTIFY_ID_RE.test(uri[2]) ? { type: uri[1], id: uri[2] } : null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const type = parts[i];
    if (type === 'track' || type === 'album' || type === 'playlist' || type === 'artist') {
      const id = parts[i + 1];
      return SPOTIFY_ID_RE.test(id) ? { type, id } : null;
    }
  }
  return null;
}

/**
 * Spotify track id from a track URL or URI, or null for anything else
 * (albums, playlists, artists, non-Spotify URLs).
 */
export function parseSpotifyTrackId(input) {
  const res = parseSpotifyResource(input);
  return res && res.type === 'track' ? res.id : null;
}

/** Same sanitizer create-link uses to build the artist part of a slug. */
export function slugifyPart(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Strip the collision serial create-link appends ("leela-1" -> "leela",
 * "artist/song-2" -> "artist/song"). Slugs without a serial are returned as is.
 */
export function slugBase(slug) {
  if (!slug) return '';
  return String(slug).replace(/-\d+$/, '');
}

/**
 * True when `candidate` is `base` itself or `base` plus a collision serial
 * ("leela", "leela-1", "leela-12" all match base "leela"; "leela-remix" does not).
 */
export function isSlugVariant(candidate, base) {
  if (!candidate || !base) return false;
  if (candidate === base) return true;
  if (!candidate.startsWith(`${base}-`)) return false;
  return /^\d+$/.test(candidate.slice(base.length + 1));
}

/**
 * True when two slugs share the same base once collision serials are removed.
 */
export function sameSlugBase(a, b) {
  if (!a || !b) return false;
  return slugBase(a) === slugBase(b);
}

/**
 * WHI-2266 ledger 2287 (Terris 2026-11-11): every Spotify link on gudmuzik opens with si=gud.
 * - open.spotify.com track/album/playlist/artist URLs: add si=gud when si is
 *   missing, replace any other si (Spotify share tokens, old si=gudmuzik) with
 *   gud, and keep only an artist tag Terris chose (ARTIST_SI_TAGS, si=vex for
 *   Vex Verity per the rise-smartlinks skill).
 * - spotify:type:id URIs and Spotify Web API hrefs
 *   (https://api.spotify.com/v1/tracks/<id>, which open raw JSON, not the app)
 *   become https://open.spotify.com/type/id?si=gud so the button opens the song.
 * - Anything else (other hosts, spotify.link short links, junk) is returned as is.
 * Other query params (context=...) and the path (intl-xx, trailing slash) are kept.
 */
export const DEFAULT_SPOTIFY_SI = 'gud';
// Artist-specific tags Terris asked for; every other si becomes gud
export const ARTIST_SI_TAGS = new Set(['vex']);
const API_TYPES = { tracks: 'track', albums: 'album', playlists: 'playlist', artists: 'artist' };

export function withSpotifySiTag(input) {
  if (!input || typeof input !== 'string') return input;
  const raw = input.trim();

  const uri = raw.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]{22})$/);
  if (uri) return `https://open.spotify.com/${uri[1]}/${uri[2]}?si=${DEFAULT_SPOTIFY_SI}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return input;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'api.spotify.com') {
    const m = url.pathname.match(/^\/v1\/(tracks|albums|playlists|artists)\/([A-Za-z0-9]{22})\/?$/);
    return m ? `https://open.spotify.com/${API_TYPES[m[1]]}/${m[2]}?si=${DEFAULT_SPOTIFY_SI}` : input;
  }
  if (host !== 'open.spotify.com') return input;
  if (!parseSpotifyResource(raw)) return input;

  // Look at every si param by its decoded name (si, s%69, duplicates) so exactly one survives
  const decodeKey = (p) => {
    const k = p.split('=')[0].replace(/\+/g, ' ');
    try { return decodeURIComponent(k); } catch { return k; }
  };
  const rawParams = url.search.replace(/^\?/, '').split('&').filter(Boolean);
  const siValues = url.searchParams.getAll('si');
  const siRaw = rawParams.filter((p) => decodeKey(p) === 'si');
  // Exact match only: si=VEX or si=Vex is not a tag Terris chose, so it becomes gud
  const customTag = siValues.find((v) => ARTIST_SI_TAGS.has(v));
  if (customTag && siRaw.length === 1 && siRaw[0] === `si=${customTag}`) return raw;

  // Rebuild the query by hand so other params keep their exact encoding
  const kept = rawParams.filter((p) => decodeKey(p) !== 'si');
  kept.push(`si=${customTag || DEFAULT_SPOTIFY_SI}`);
  return `${url.origin}${url.pathname}?${kept.join('&')}${url.hash}`;
}
