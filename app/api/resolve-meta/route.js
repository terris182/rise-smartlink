import { NextResponse } from 'next/server';
import { fetchSpotifyMeta } from '@/lib/spotify';
import { fetchSpotifyTrackMeta } from '@/lib/spotify-api';
import { fetchCrossPlatformLinks } from '@/lib/songlink';
import { searchAppleMusicUrl } from '@/lib/itunes';
import { resolveAppleMusicByIsrc, deezerSearch } from '@/lib/isrc-resolver';

/**
 * POST /api/resolve-meta
 * Preview endpoint — resolves metadata from a Spotify URL WITHOUT creating a link.
 * Used by the dashboard CreateView to auto-fill fields when a Spotify URL is pasted.
 *
 * Body: { spotifyUrl: string }
 *
 * Response: {
 *   title?: string,
 *   artist?: string,
 *   coverUrl?: string,
 *   appleMusicUrl?: string,
 *   resolvedVia?: string[],  // which strategies succeeded
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.spotifyUrl) {
      return NextResponse.json(
        { error: 'Missing required field: spotifyUrl' },
        { status: 400 }
      );
    }

    const result = { resolvedVia: [] };
    let spotifyIsrc = null;

    // ── Step 1: Songlink (primary — gives Apple Music URL directly) ──
    try {
      const crossLinks = await fetchCrossPlatformLinks(body.spotifyUrl);
      if (crossLinks) {
        if (crossLinks.artistName) { result.artist = crossLinks.artistName; }
        if (crossLinks.title) { result.title = crossLinks.title; }
        if (crossLinks.appleMusicUrl) {
          result.appleMusicUrl = crossLinks.appleMusicUrl;
          result.resolvedVia.push('songlink');
        }
      }
    } catch (err) {
      console.error('[resolve-meta] Songlink error:', err.message);
    }

    // ── Step 2: Spotify Web API (provides artist/title/ISRC) ──
    try {
      const spotifyMeta = await fetchSpotifyTrackMeta(body.spotifyUrl);
      if (spotifyMeta) {
        spotifyIsrc = spotifyMeta.isrc;
        if (!result.artist && spotifyMeta.artist) result.artist = spotifyMeta.artist;
        if (!result.title && spotifyMeta.title) result.title = spotifyMeta.title;
        result.resolvedVia.push('spotify-api');
      }
    } catch (err) {
      console.error('[resolve-meta] Spotify API error:', err.message);
    }

    // ── Step 3: Spotify oEmbed (cover art + backup title/artist) ──
    try {
      const meta = await fetchSpotifyMeta(body.spotifyUrl);
      if (meta) {
        if (meta.thumbnailUrl) result.coverUrl = meta.thumbnailUrl;
        if (!result.artist && meta.artist) result.artist = meta.artist;
        if (!result.title && meta.title) result.title = meta.title;
        result.resolvedVia.push('spotify-oembed');
      }
    } catch (err) {
      console.error('[resolve-meta] Spotify oEmbed error:', err.message);
    }

    // ── Step 4: iTunes Search (needs artist + title) ──
    if (!result.appleMusicUrl && result.artist && result.title) {
      try {
        const itunesUrl = await searchAppleMusicUrl(result.artist, result.title);
        if (itunesUrl) {
          result.appleMusicUrl = itunesUrl;
          result.resolvedVia.push('itunes-search');
        }
      } catch (err) {
        console.error('[resolve-meta] iTunes search error:', err.message);
      }
    }

    // ── Step 5: ISRC-based resolution (most reliable for new tracks) ──
    if (!result.appleMusicUrl && (spotifyIsrc || (result.artist && result.title))) {
      try {
        let isrc = spotifyIsrc;
        if (!isrc && result.artist && result.title) {
          const deezerResult = await deezerSearch(result.artist, result.title);
          if (deezerResult?.isrc) {
            isrc = deezerResult.isrc;
          }
        }
        if (isrc) {
          // resolveAppleMusicByIsrc already includes AMP text search as Strategy B,
          // so no need for a separate Step 6 call to appleMusicAmpSearch
          const isrcUrl = await resolveAppleMusicByIsrc(isrc, result.artist, result.title);
          if (isrcUrl) {
            result.appleMusicUrl = isrcUrl;
            result.resolvedVia.push('isrc-resolution');
          }
        }
      } catch (err) {
        console.error('[resolve-meta] ISRC resolution error:', err.message);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[/api/resolve-meta] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
