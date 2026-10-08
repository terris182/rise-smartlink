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
