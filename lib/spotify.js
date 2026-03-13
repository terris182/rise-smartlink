/**
 * Spotify oEmbed helper.
 * Fetches cover art, title, and artist from a Spotify track URL
 * without requiring any API keys or authentication.
 */

const OEMBED_URL = 'https://open.spotify.com/oembed';

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

  try {
    const url = `${OEMBED_URL}?url=${encodeURIComponent(spotifyUrl)}`;
    const res = await fetch(url, { next: { revalidate: 86400 } }); // cache 24h
    if (!res.ok) return null;

    const data = await res.json();
    const thumb300 = data.thumbnail_url || '';

    // Upgrade to 640x640 by swapping the size prefix
    const thumb640 = thumb300.replace('ab67616d00001e02', 'ab67616d0000b273');

    return {
      title: data.title || '',
      thumbnailUrl: thumb640 || thumb300,
      thumbnailSmall: thumb300,
    };
  } catch (err) {
    console.error('[Spotify oEmbed] Error:', err.message);
    return null;
  }
}
