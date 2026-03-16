import { NextResponse } from 'next/server';
import { searchAppleMusicUrl } from '@/lib/itunes';
import { fetchCrossPlatformLinks } from '@/lib/songlink';
import { fetchSpotifyMeta } from '@/lib/spotify';
import { fetchSpotifyTrackMeta } from '@/lib/spotify-api';
import { resolveAppleMusicByIsrc } from '@/lib/isrc-resolver';

export const dynamic = 'force-dynamic';

/**
 * GET /api/debug?spotifyUrl=...
 * Tests the full resolution chain and returns results from each step.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const spotifyUrl = searchParams.get('spotifyUrl') || 'https://open.spotify.com/track/4XohrQVxLoX7l1dRWeywag';
  const artist = searchParams.get('artist') || '';
  const title = searchParams.get('title') || '';

  const results = { spotifyUrl };

  // Step 1: Songlink
  try {
    const songlink = await fetchCrossPlatformLinks(spotifyUrl);
    results.songlink = songlink;
  } catch (err) {
    results.songlinkError = err.message;
  }

  // Use Songlink artist/title as defaults
  const resolvedArtist = artist || results.songlink?.artistName || '';
  const resolvedTitle = title || results.songlink?.title || '';
  results.resolvedArtist = resolvedArtist;
  results.resolvedTitle = resolvedTitle;

  // Step 2: iTunes Search (multi-strategy)
  try {
    const itunesUrl = await searchAppleMusicUrl(resolvedArtist, resolvedTitle);
    results.itunesMatchedUrl = itunesUrl;
  } catch (err) {
    results.itunesError = err.message;
  }

  // Step 3: Spotify Web API (ISRC)
  try {
    const spotifyMeta = await fetchSpotifyTrackMeta(spotifyUrl);
    results.spotifyApi = spotifyMeta;
  } catch (err) {
    results.spotifyApiError = err.message;
  }

  // Step 4: ISRC-based resolution (Deezer → Songlink, iTunes ISRC, Apple Media)
  if (results.spotifyApi?.isrc) {
    try {
      const isrcUrl = await resolveAppleMusicByIsrc(
        results.spotifyApi.isrc,
        resolvedArtist || results.spotifyApi.artist,
        resolvedTitle || results.spotifyApi.title
      );
      results.isrcResolvedUrl = isrcUrl;
    } catch (err) {
      results.isrcError = err.message;
    }
  }

  // Step 5: Spotify oEmbed (cover art)
  try {
    const meta = await fetchSpotifyMeta(spotifyUrl);
    results.spotifyOembed = meta;
  } catch (err) {
    results.spotifyOembedError = err.message;
  }

  // Summary: which method would have resolved Apple Music?
  results.finalAppleMusicUrl =
    results.songlink?.appleMusicUrl ||
    results.itunesMatchedUrl ||
    results.isrcResolvedUrl ||
    null;

  return NextResponse.json(results);
}
