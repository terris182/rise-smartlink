/**
 * Songlink/Odesli API helper.
 * Converts a Spotify URL to matching links on other platforms (Apple Music, etc.)
 * Also extracts artist name and title from entity metadata (more reliable than
 * Spotify oEmbed which doesn't always include author_name).
 *
 * Free tier: 10 requests/minute, no API key required.
 * API docs: https://linktree.notion.site/API-d0ebebeb8d1f4c4e8a862f6dc0bbed76
 */

const ODESLI_API = 'https://api.song.link/v1-alpha.1/links';

/**
 * Fetch cross-platform links and metadata for a given music URL.
 *
 * @param {string} url - A Spotify (or other platform) URL
 * @returns {Promise<{appleMusicUrl?: string, artistName?: string, title?: string, ...} | null>}
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

    const result = {};

    // Extract platform links
    if (data.linksByPlatform?.appleMusic?.url) {
      result.appleMusicUrl = data.linksByPlatform.appleMusic.url;
    }
    if (data.linksByPlatform?.spotify?.url) {
      result.spotifyUrl = data.linksByPlatform.spotify.url;
    }
    if (data.linksByPlatform?.youtube?.url) {
      result.youtubeUrl = data.linksByPlatform.youtube.url;
    }
    if (data.linksByPlatform?.youtubeMusic?.url) {
      result.youtubeMusicUrl = data.linksByPlatform.youtubeMusic.url;
    }

    // Extract artist name and title from entity metadata.
    // The entityUniqueId field tells us which entity to look up.
    // Try Spotify entity first, then any available entity.
    const entities = data.entitiesByUniqueId || {};
    const spotifyEntityId = data.linksByPlatform?.spotify?.entityUniqueId;
    const entity = (spotifyEntityId && entities[spotifyEntityId])
      || Object.values(entities)[0];

    if (entity) {
      if (entity.artistName) result.artistName = entity.artistName;
      if (entity.title) result.title = entity.title;
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch (err) {
    console.error('[Songlink] Error:', err.message);
    return null;
  }
}
