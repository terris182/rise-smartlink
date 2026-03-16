/**
 * ISRC-based Apple Music resolver.
 *
 * When Songlink (queried with Spotify URL) and iTunes Search both fail
 * to find an Apple Music URL, this module uses the track's ISRC code
 * as a universal identifier to find it through alternate paths:
 *
 * 1. Deezer ISRC lookup (free, no auth) → Deezer track URL → Songlink → Apple Music
 * 2. iTunes Search with ISRC as search term (ISRC sometimes in searchable metadata)
 * 3. Apple Media Services search (Apple's own search endpoint, better indexing)
 *
 * This is the approach services like Hypeddit and Feature.fm likely use
 * to achieve near-100% cross-platform resolution.
 */

import { fetchCrossPlatformLinks } from './songlink.js';

/**
 * Look up a track on Deezer by ISRC code.
 * Deezer's API supports ISRC lookup natively: /track/isrc:{code}
 *
 * @param {string} isrc - ISRC code (e.g. "USUG12408812")
 * @returns {Promise<{deezerUrl: string, title: string, artist: string} | null>}
 */
async function deezerIsrcLookup(isrc) {
  try {
    const res = await fetch(`https://api.deezer.com/track/isrc:${isrc}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.error) {
      console.log(`[Deezer] ISRC ${isrc} not found: ${data.error.message}`);
      return null;
    }

    return {
      deezerUrl: data.link || null,
      title: data.title || null,
      artist: data.artist?.name || null,
    };
  } catch (err) {
    console.error('[Deezer] ISRC lookup error:', err.message);
    return null;
  }
}

/**
 * Search iTunes with the ISRC code as the search term.
 * The iTunes Search API sometimes includes ISRC in searchable metadata,
 * allowing direct ISRC-based matching even though there's no explicit ISRC parameter.
 *
 * @param {string} isrc - ISRC code
 * @returns {Promise<string|null>} Apple Music URL or null
 */
async function itunesIsrcSearch(isrc) {
  try {
    const params = new URLSearchParams({
      term: isrc,
      media: 'music',
      entity: 'song',
      limit: '5',
    });

    const res = await fetch(`https://itunes.apple.com/search?${params}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.results || data.results.length === 0) return null;

    // Return the first result's trackViewUrl (ISRC search is very specific)
    const track = data.results[0];
    console.log(`[iTunes ISRC] Found: "${track.trackName}" by ${track.artistName}`);
    return track.trackViewUrl || null;
  } catch (err) {
    console.error('[iTunes ISRC] Search error:', err.message);
    return null;
  }
}

/**
 * Search Apple's media services API.
 * This is a public API used by Apple's embed tools with potentially
 * better/faster indexing than the older iTunes Search API.
 *
 * @param {string} artist - Artist name
 * @param {string} title - Track title
 * @returns {Promise<string|null>} Apple Music URL or null
 */
export async function appleMediaSearch(artist, title) {
  try {
    const query = `${artist} ${title}`;
    const params = new URLSearchParams({
      types: 'songs',
      term: query,
      l: 'en-US',
      platform: 'web',
      limit: '10',
    });

    const res = await fetch(
      `https://tools.applemediaservices.com/api/apple-media/music/US/search.json?${params}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Origin': 'https://tools.applemediaservices.com',
        },
      }
    );

    if (!res.ok) {
      console.warn(`[Apple Media] Search returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    const songs = data?.songs?.data || [];

    if (songs.length === 0) return null;

    // Normalize for matching
    const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetArtist = normalise(artist);
    const targetTitle = normalise(title);

    for (const song of songs) {
      const songArtist = normalise(song.attributes?.artistName || '');
      const songTitle = normalise(song.attributes?.name || '');

      if (songTitle === targetTitle &&
        (songArtist === targetArtist || songArtist.includes(targetArtist) || targetArtist.includes(songArtist))) {
        const url = song.attributes?.url;
        if (url) {
          console.log(`[Apple Media] Found: "${song.attributes.name}" by ${song.attributes.artistName}`);
          return url;
        }
      }
    }

    // Looser match: just title
    for (const song of songs) {
      const songTitle = normalise(song.attributes?.name || '');
      const songArtist = normalise(song.attributes?.artistName || '');
      if (songTitle === targetTitle || (songTitle.includes(targetTitle) && songArtist.includes(targetArtist))) {
        const url = song.attributes?.url;
        if (url) {
          console.log(`[Apple Media] Loose match: "${song.attributes.name}" by ${song.attributes.artistName}`);
          return url;
        }
      }
    }

    return null;
  } catch (err) {
    console.error('[Apple Media] Search error:', err.message);
    return null;
  }
}

/**
 * Resolve an Apple Music URL using ISRC code and supplemental search strategies.
 * This is the last-resort resolver after Songlink and iTunes Search have failed.
 *
 * @param {string} isrc - ISRC code from Spotify Web API
 * @param {string} artist - Artist name (for Apple Media search)
 * @param {string} title - Track title (for Apple Media search)
 * @returns {Promise<string|null>} Apple Music URL or null
 */
export async function resolveAppleMusicByIsrc(isrc, artist, title) {
  if (!isrc) return null;

  // Strategy A: Deezer ISRC lookup → Songlink with Deezer URL
  // This works because Songlink might have the Apple Music mapping indexed
  // via Deezer even if it didn't have it via Spotify
  const deezer = await deezerIsrcLookup(isrc);
  if (deezer?.deezerUrl) {
    console.log(`[ISRC] Deezer found: ${deezer.deezerUrl} — querying Songlink...`);
    const crossLinks = await fetchCrossPlatformLinks(deezer.deezerUrl);
    if (crossLinks?.appleMusicUrl) {
      console.log(`[ISRC] Apple Music resolved via Deezer→Songlink: ${crossLinks.appleMusicUrl}`);
      return crossLinks.appleMusicUrl;
    }
  }

  // Strategy B: iTunes Search with raw ISRC code
  const itunesUrl = await itunesIsrcSearch(isrc);
  if (itunesUrl) {
    console.log(`[ISRC] Apple Music resolved via iTunes ISRC search: ${itunesUrl}`);
    return itunesUrl;
  }

  // Strategy C: Apple Media Services search (potentially better indexing)
  if (artist && title) {
    const appleUrl = await appleMediaSearch(artist, title);
    if (appleUrl) {
      console.log(`[ISRC] Apple Music resolved via Apple Media Services: ${appleUrl}`);
      return appleUrl;
    }
  }

  console.log(`[ISRC] All ISRC-based strategies exhausted for ${isrc}`);
  return null;
}
