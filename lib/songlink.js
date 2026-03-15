/**
 * Songlink/Odesli API helper.
 * Converts a Spotify URL to matching links on other platforms (Apple Music, etc.)
 * Free tier: 10 requests/minute, no API key required.
 *
 * API docs: https://linktree.notion.site/API-d0ebebeb8d1f4c4e8a862f6dc0bbed76
 */

const ODESLI_API = 'https://api.song.link/v1-alpha.1/links';

/**
 * Fetch cross-platform links for a given music URL (typically Spotify).
 * Returns an object with platform URLs, or null on failure.
 *
 * @param {string} url - A Spotify (or other platform) URL
 * @returns {Promise<{appleMusicUrl?: string, spotifyUrl?: string, youtubeUrl?: string} | null>}
 */
export async function fetchCrossPlatformLinks(url) {
  if (!url) return null;

  try {
    const apiUrl = `${ODESLI_API}?url=${encodeURIComponent(url)}&userCountry=US`;
    const res = await fetch(apiUrl, {
      next: { revalidate: 86400 }, // cache for 24h in Next.js
    });

    if (!res.ok) {
      console.warn(`[Songlink] API returned ${res.status} for ${url}`);
      return null;
    }

    const data = await res.json();

    // data.linksByPlatform contains: { appleMusic: { url, entityUniqueId }, spotify: { ... }, ... }
    const links = {};

    if (data.linksByPlatform?.appleMusic?.url) {
      links.appleMusicUrl = data.linksByPlatform.appleMusic.url;
    }
    if (data.linksByPlatform?.spotify?.url) {
      links.spotifyUrl = data.linksByPlatform.spotify.url;
    }
    if (data.linksByPlatform?.youtube?.url) {
      links.youtubeUrl = data.linksByPlatform.youtube.url;
    }
    if (data.linksByPlatform?.youtubeMusic?.url) {
      links.youtubeMusicUrl = data.linksByPlatform.youtubeMusic.url;
    }

    return Object.keys(links).length > 0 ? links : null;
  } catch (err) {
    console.error('[Songlink] Error:', err.message);
    return null;
  }
}
