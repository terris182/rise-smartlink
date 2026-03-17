/**
 * Cross-platform Apple Music resolver.
 *
 * When Songlink and iTunes Search both fail, this module uses alternative
 * strategies to find the Apple Music URL:
 *
 * 1. Deezer text search (free, no auth) → get ISRC → Deezer ISRC → Songlink
 * 2. Apple Music AMP API search (uses Apple's public web player token)
 * 3. Deezer ISRC lookup → Songlink with Deezer URL
 * 4. iTunes Search with ISRC as search term
 *
 * The key discovery: Deezer's search API indexes tracks faster than
 * iTunes Search or Songlink, and returns ISRCs for free. Apple Music's
 * internal AMP API (used by the web player) has better indexing than
 * the public iTunes Search API.
 */

import { fetchCrossPlatformLinks } from './songlink.js';

const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ─── Deezer APIs (free, no auth) ───

/**
 * Search Deezer by artist + title text query.
 * Returns track info including ISRC, Deezer URL, artist, title.
 * This is MORE reliable than iTunes Search for newly released tracks.
 */
export async function deezerSearch(artist, title) {
  if (!artist || !title) return null;

  try {
    const query = `${artist} ${title}`;
    const params = new URLSearchParams({ q: query });
    const res = await fetch(`https://api.deezer.com/search?${params}`);
    if (!res.ok) return null;

    const data = await res.json();
    const results = data?.data || [];
    if (results.length === 0) return null;

    const targetArtist = normalise(artist);
    const targetTitle = normalise(title);

    // Try exact match first
    for (const r of results) {
      const rArtist = normalise(r.artist?.name || '');
      const rTitle = normalise(r.title_short || r.title || '');
      if (rTitle === targetTitle &&
        (rArtist === targetArtist || rArtist.includes(targetArtist) || targetArtist.includes(rArtist))) {
        console.log(`[Deezer Search] Exact match: "${r.title}" by ${r.artist?.name}, ISRC: ${r.isrc}`);
        return {
          deezerUrl: r.link || null,
          isrc: r.isrc || null,
          title: r.title || null,
          artist: r.artist?.name || null,
        };
      }
    }

    // Looser match
    for (const r of results) {
      const rArtist = normalise(r.artist?.name || '');
      const rTitle = normalise(r.title_short || r.title || '');
      if ((rTitle.includes(targetTitle) || targetTitle.includes(rTitle)) &&
        (rArtist.includes(targetArtist) || targetArtist.includes(rArtist))) {
        console.log(`[Deezer Search] Loose match: "${r.title}" by ${r.artist?.name}, ISRC: ${r.isrc}`);
        return {
          deezerUrl: r.link || null,
          isrc: r.isrc || null,
          title: r.title || null,
          artist: r.artist?.name || null,
        };
      }
    }

    console.log(`[Deezer Search] No match for "${query}" (${results.length} results)`);
    return null;
  } catch (err) {
    console.error('[Deezer Search] Error:', err.message);
    return null;
  }
}

/**
 * Look up a track on Deezer by ISRC code.
 */
async function deezerIsrcLookup(isrc) {
  try {
    const res = await fetch(`https://api.deezer.com/track/isrc:${isrc}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.error) return null;

    return {
      deezerUrl: data.link || null,
      title: data.title || null,
      artist: data.artist?.name || null,
    };
  } catch (err) {
    console.error('[Deezer ISRC] Error:', err.message);
    return null;
  }
}

// ─── Apple Music AMP API ───

/**
 * Search Apple Music using their internal AMP API.
 * This is the same API that music.apple.com uses in the web player.
 * It requires a bearer token — we use a long-lived public web player token.
 *
 * The token is set as APPLE_MUSIC_TOKEN env var.
 * To get a new token: visit music.apple.com, open DevTools console, run:
 *   MusicKit.getInstance().developerToken
 *
 * These tokens typically last ~84 days.
 *
 * @param {string} artist - Artist name
 * @param {string} title - Track title
 * @returns {Promise<string|null>} Apple Music URL or null
 */
export async function appleMusicAmpSearch(artist, title) {
  const token = process.env.APPLE_MUSIC_TOKEN;
  if (!token) {
    console.log('[Apple AMP] No APPLE_MUSIC_TOKEN env var set');
    return null;
  }

  try {
    const query = `${artist} ${title}`;
    const params = new URLSearchParams({
      term: query,
      types: 'songs',
      limit: '10',
      l: 'en-US',
    });

    const res = await fetch(
      `https://amp-api.music.apple.com/v1/catalog/us/search?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Origin': 'https://music.apple.com',
        },
      }
    );

    if (!res.ok) {
      console.warn(`[Apple AMP] Search returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    const songs = data?.results?.songs?.data || [];
    if (songs.length === 0) return null;

    const targetArtist = normalise(artist);
    const targetTitle = normalise(title);

    // Exact match
    for (const song of songs) {
      const songArtist = normalise(song.attributes?.artistName || '');
      const songTitle = normalise(song.attributes?.name || '');
      if (songTitle === targetTitle &&
        (songArtist === targetArtist || songArtist.includes(targetArtist) || targetArtist.includes(songArtist))) {
        const url = song.attributes?.url;
        if (url) {
          console.log(`[Apple AMP] Found: "${song.attributes.name}" by ${song.attributes.artistName}`);
          return url;
        }
      }
    }

    // Loose match
    for (const song of songs) {
      const songArtist = normalise(song.attributes?.artistName || '');
      const songTitle = normalise(song.attributes?.name || '');
      if ((songTitle.includes(targetTitle) || targetTitle.includes(songTitle)) &&
        (songArtist.includes(targetArtist) || targetArtist.includes(songArtist))) {
        const url = song.attributes?.url;
        if (url) {
          console.log(`[Apple AMP] Loose match: "${song.attributes.name}" by ${song.attributes.artistName}`);
          return url;
        }
      }
    }

    return null;
  } catch (err) {
    console.error('[Apple AMP] Search error:', err.message);
    return null;
  }
}

/**
 * Search Apple Music AMP API by ISRC (most precise method).
 *
 * @param {string} isrc - ISRC code
 * @returns {Promise<string|null>} Apple Music URL or null
 */
export async function appleMusicIsrcLookup(isrc) {
  const token = process.env.APPLE_MUSIC_TOKEN;
  if (!token || !isrc) return null;

  try {
    const res = await fetch(
      `https://amp-api.music.apple.com/v1/catalog/us/songs?filter[isrc]=${isrc}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Origin': 'https://music.apple.com',
        },
      }
    );

    if (!res.ok) {
      console.warn(`[Apple AMP ISRC] Lookup returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    const songs = data?.data || [];
    if (songs.length === 0) return null;

    const url = songs[0].attributes?.url;
    if (url) {
      console.log(`[Apple AMP ISRC] Found: "${songs[0].attributes.name}" by ${songs[0].attributes.artistName}`);
      return url;
    }

    return null;
  } catch (err) {
    console.error('[Apple AMP ISRC] Error:', err.message);
    return null;
  }
}

// ─── iTunes ISRC Search ───

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

    const track = data.results[0];
    console.log(`[iTunes ISRC] Found: "${track.trackName}" by ${track.artistName}`);
    return track.trackViewUrl || null;
  } catch (err) {
    console.error('[iTunes ISRC] Error:', err.message);
    return null;
  }
}

// ─── Main resolver ───

/**
 * Resolve an Apple Music URL using all available strategies.
 *
 * @param {string} isrc - ISRC code (from Spotify API or Deezer)
 * @param {string} artist - Artist name
 * @param {string} title - Track title
 * @returns {Promise<string|null>} Apple Music URL or null
 */
export async function resolveAppleMusicByIsrc(isrc, artist, title) {
  // Strategy A: Apple Music AMP API by ISRC (most precise, if token available)
  if (isrc) {
    const ampIsrcUrl = await appleMusicIsrcLookup(isrc);
    if (ampIsrcUrl) return ampIsrcUrl;
  }

  // Strategy B: Apple Music AMP API text search
  if (artist && title) {
    const ampUrl = await appleMusicAmpSearch(artist, title);
    if (ampUrl) return ampUrl;
  }

  // Strategy C: Deezer ISRC → Songlink with Deezer URL
  if (isrc) {
    const deezer = await deezerIsrcLookup(isrc);
    if (deezer?.deezerUrl) {
      console.log(`[ISRC] Deezer found: ${deezer.deezerUrl} — querying Songlink...`);
      const crossLinks = await fetchCrossPlatformLinks(deezer.deezerUrl);
      if (crossLinks?.appleMusicUrl) {
        console.log(`[ISRC] Apple Music via Deezer→Songlink: ${crossLinks.appleMusicUrl}`);
        return crossLinks.appleMusicUrl;
      }
    }
  }

  // Strategy D: iTunes Search with raw ISRC
  if (isrc) {
    const itunesUrl = await itunesIsrcSearch(isrc);
    if (itunesUrl) return itunesUrl;
  }

  console.log(`[ISRC] All strategies exhausted for ISRC=${isrc}, "${artist} - ${title}"`);
  return null;
}
