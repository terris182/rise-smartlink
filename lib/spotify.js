/**
 * Spotify oEmbed helper.
 * Fetches cover art, title, and artist from a Spotify track URL
 * without requiring any API keys or authentication.
 */

import { createTtlCache, cached } from './ttl-cache.js';

const OEMBED_URL = 'https://open.spotify.com/oembed';
// WHI-2392: pages are force-dynamic so Next's fetch revalidate is ignored; cache here.
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
export const oembedCache = createTtlCache({ max: 500 });

/**
 * Fetch metadata from a Spotify URL using the oEmbed API.
 * Returns { title, thumbnail_url } or null on failure.
 *
 * The thumbnail_url from oEmbed is 300x300. To get 640x640,
 * replace the size prefix in the image hash:
 *   ab67616d00001e02 → 300×300
 *   ab67616d0000b273 → 640×640
 */
export async function fetchSpotifyMeta(spotifyUrl) {
  if (!spotifyUrl) return null;
  return cached(oembedCache, spotifyUrl, () => fetchSpotifyMetaUncached(spotifyUrl),
    (v) => (v ? HIT_TTL_MS : MISS_TTL_MS));
}

async function fetchSpotifyMetaUncached(spotifyUrl) {

  try {
    const url = `${OEMBED_URL}?url=${encodeURIComponent(spotifyUrl)}`;
    const res = await fetch(url, { next: { revalidate: 86400 } }); // cache 24h
    if (!res.ok) return null;

    const data = await res.json();
    const thumb300 = data.thumbnail_url || '';

    // Upgrade to 640x640 by swapping the size prefix
    const thumb640 = thumb300.replace('ab67616d00001e02', 'ab67616d0000b273');

    // oEmbed returns author_name as the artist (separate from title)
    return {
      title: data.title || '',
      artist: data.author_name || '',
      thumbnailUrl: thumb640 || thumb300,
      thumbnailSmall: thumb300,
    };
  } catch (err) {
    console.error('[Spotify oEmbed] Error:', err.message);
    return null;
  }
}
