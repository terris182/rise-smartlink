/**
 * iTunes Search API helper.
 * Fallback for finding Apple Music URLs when Songlink/Odesli doesn't have them.
 *
 * The iTunes Search API is free, requires no authentication, and returns
 * Apple Music track URLs (trackViewUrl) for matching songs.
 *
 * Rate limit: ~20 calls per minute (Apple doesn't publish exact limits).
 * Docs: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/
 */

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

/**
 * Search iTunes for a track by artist and title.
 * Returns the Apple Music URL if a matching track is found, or null.
 *
 * @param {string} artist - Artist name
 * @param {string} title - Track title
 * @returns {Promise<string|null>} Apple Music URL or null
 */
export async function searchAppleMusicUrl(artist, title) {
  if (!artist || !title) return null;

  try {
    const query = `${artist} ${title}`;
    const params = new URLSearchParams({
      term: query,
      media: 'music',
      entity: 'song',
      limit: '5',
    });

    const res = await fetch(`${ITUNES_SEARCH_URL}?${params}`, {
      next: { revalidate: 86400 }, // cache 24h
    });

    if (!res.ok) {
      console.warn(`[iTunes] API returned ${res.status} for "${query}"`);
      return null;
    }

    const data = await res.json();

    if (!data.results || data.results.length === 0) {
      console.log(`[iTunes] No results for "${query}"`);
      return null;
    }

    // Try to find an exact or close match by comparing artist + title
    const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetArtist = normalise(artist);
    const targetTitle = normalise(title);

    // First pass: exact match on both artist and title
    for (const result of data.results) {
      const rArtist = normalise(result.artistName || '');
      const rTitle = normalise(result.trackName || '');
      if (rArtist === targetArtist && rTitle === targetTitle) {
        console.log(`[iTunes] Exact match: "${result.trackName}" by ${result.artistName}`);
        return result.trackViewUrl || null;
      }
    }

    // Second pass: title matches and artist is contained (handles "feat." variations)
    for (const result of data.results) {
      const rArtist = normalise(result.artistName || '');
      const rTitle = normalise(result.trackName || '');
      if (rTitle === targetTitle && (rArtist.includes(targetArtist) || targetArtist.includes(rArtist))) {
        console.log(`[iTunes] Close match: "${result.trackName}" by ${result.artistName}`);
        return result.trackViewUrl || null;
      }
    }

    console.log(`[iTunes] No matching track found for "${query}" (${data.results.length} results checked)`);
    return null;
  } catch (err) {
    console.error('[iTunes] Error:', err.message);
    return null;
  }
}
