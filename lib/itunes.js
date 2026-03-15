/**
 * iTunes Search API helper.
 * Fallback for finding Apple Music URLs when Songlink/Odesli doesn't have them.
 *
 * The iTunes Search API is free, requires no authentication, and returns
 * Apple Music track URLs (trackViewUrl) for matching songs.
 *
 * This module uses multiple search strategies to maximize match rate:
 * 1. Combined "artist title" search (most precise)
 * 2. Title-only search (catches tracks where artist name differs)
 * 3. Cleaned query (removes feat., parenthetical text, etc.)
 * 4. Album-level search (finds the album, then matches the track)
 *
 * Rate limit: ~20 calls per minute (Apple doesn't publish exact limits).
 * Docs: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/
 */

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';

/**
 * Normalize a string for fuzzy matching.
 */
function normalise(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Clean a search term by removing common noise (feat., parenthetical text, etc.)
 */
function cleanTerm(s) {
  return s
    .replace(/\(feat\.?[^)]*\)/gi, '')
    .replace(/\[feat\.?[^]]*\]/gi, '')
    .replace(/feat\.?\s+.*/gi, '')
    .replace(/ft\.?\s+.*/gi, '')
    .replace(/\(.*?(remix|version|edit|mix|deluxe|remaster).*?\)/gi, '')
    .replace(/\[.*?(remix|version|edit|mix|deluxe|remaster).*?\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Run a single iTunes search query and return raw results.
 */
async function itunesSearch(term, { entity = 'song', limit = 10 } = {}) {
  const params = new URLSearchParams({
    term,
    media: 'music',
    entity,
    limit: String(limit),
  });

  const res = await fetch(`${ITUNES_SEARCH_URL}?${params}`, {
    next: { revalidate: 86400 },
  });

  if (!res.ok) {
    console.warn(`[iTunes] API returned ${res.status} for "${term}"`);
    return [];
  }

  const data = await res.json();
  return data.results || [];
}

/**
 * Try to match a track from iTunes results against artist + title.
 * Returns the trackViewUrl if found, null otherwise.
 *
 * Uses progressive matching:
 * 1. Exact match on both artist and title
 * 2. Title matches + artist is contained (handles "feat." variations)
 * 3. Title matches only (for compilation/various artist releases)
 */
function matchTrack(results, artist, title) {
  if (!results || results.length === 0) return null;

  const targetArtist = normalise(artist);
  const targetTitle = normalise(title);
  const cleanedTitle = normalise(cleanTerm(title));

  // Pass 1: exact match on both
  for (const r of results) {
    const rArtist = normalise(r.artistName || '');
    const rTitle = normalise(r.trackName || '');
    if (rArtist === targetArtist && (rTitle === targetTitle || rTitle === cleanedTitle)) {
      console.log(`[iTunes] Exact match: "${r.trackName}" by ${r.artistName}`);
      return r.trackViewUrl || null;
    }
  }

  // Pass 2: title matches + artist is contained (handles feat. variations)
  for (const r of results) {
    const rArtist = normalise(r.artistName || '');
    const rTitle = normalise(r.trackName || '');
    if (
      (rTitle === targetTitle || rTitle === cleanedTitle) &&
      (rArtist.includes(targetArtist) || targetArtist.includes(rArtist))
    ) {
      console.log(`[iTunes] Close match: "${r.trackName}" by ${r.artistName}`);
      return r.trackViewUrl || null;
    }
  }

  // Pass 3: artist matches + title is contained (handles subtitle variations)
  for (const r of results) {
    const rArtist = normalise(r.artistName || '');
    const rTitle = normalise(r.trackName || '');
    if (
      (rArtist === targetArtist || rArtist.includes(targetArtist) || targetArtist.includes(rArtist)) &&
      (rTitle.includes(targetTitle) || targetTitle.includes(rTitle))
    ) {
      console.log(`[iTunes] Partial match: "${r.trackName}" by ${r.artistName}`);
      return r.trackViewUrl || null;
    }
  }

  return null;
}

/**
 * Search iTunes for a track by artist and title using multiple strategies.
 * Returns the Apple Music URL if a matching track is found, or null.
 *
 * Strategies (tried in order, stops at first match):
 * 1. "{artist} {title}" — most precise combined query
 * 2. "{title}" only — catches cases where artist name doesn't match iTunes
 * 3. Cleaned "{artist} {cleanTitle}" — removes feat., remix tags, etc.
 * 4. "{artist}" only — searches artist catalog, matches title from results
 *
 * @param {string} artist - Artist name
 * @param {string} title - Track title
 * @returns {Promise<string|null>} Apple Music URL or null
 */
export async function searchAppleMusicUrl(artist, title) {
  if (!artist || !title) return null;

  try {
    // Strategy 1: Combined "artist title" search
    const combinedResults = await itunesSearch(`${artist} ${title}`);
    const match1 = matchTrack(combinedResults, artist, title);
    if (match1) return match1;

    // Strategy 2: Title-only search (wider net)
    const titleResults = await itunesSearch(title);
    const match2 = matchTrack(titleResults, artist, title);
    if (match2) return match2;

    // Strategy 3: Cleaned query (remove feat., remix, etc.)
    const cleanedArtist = cleanTerm(artist);
    const cleanedTitle = cleanTerm(title);
    if (cleanedArtist !== artist || cleanedTitle !== title) {
      const cleanedResults = await itunesSearch(`${cleanedArtist} ${cleanedTitle}`);
      const match3 = matchTrack(cleanedResults, artist, title);
      if (match3) return match3;
    }

    // Strategy 4: Artist-only search, match title from results
    const artistResults = await itunesSearch(artist, { limit: 25 });
    const match4 = matchTrack(artistResults, artist, title);
    if (match4) return match4;

    // Strategy 5: Album search — find albums by artist, then look up album tracks
    const albumResults = await itunesSearch(artist, { entity: 'album', limit: 10 });
    for (const album of albumResults) {
      if (!album.collectionId) continue;
      const albumArtist = normalise(album.artistName || '');
      const targetArtist = normalise(artist);
      if (!albumArtist.includes(targetArtist) && !targetArtist.includes(albumArtist)) continue;

      // Look up tracks in this album
      try {
        const lookupUrl = `https://itunes.apple.com/lookup?id=${album.collectionId}&entity=song`;
        const lookupRes = await fetch(lookupUrl, { next: { revalidate: 86400 } });
        if (lookupRes.ok) {
          const lookupData = await lookupRes.json();
          const tracks = (lookupData.results || []).filter(r => r.wrapperType === 'track');
          const match5 = matchTrack(tracks, artist, title);
          if (match5) return match5;
        }
      } catch (err) {
        console.warn(`[iTunes] Album lookup error for ${album.collectionId}:`, err.message);
      }
    }

    console.log(`[iTunes] No match found after all strategies for "${artist} - ${title}"`);
    return null;
  } catch (err) {
    console.error('[iTunes] Error:', err.message);
    return null;
  }
}
