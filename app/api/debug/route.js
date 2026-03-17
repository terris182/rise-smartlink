import { NextResponse } from 'next/server';
import { searchAppleMusicUrl } from '@/lib/itunes';
import { fetchCrossPlatformLinks } from '@/lib/songlink';
import { fetchSpotifyMeta } from '@/lib/spotify';
import { fetchSpotifyTrackMeta } from '@/lib/spotify-api';
import { resolveAppleMusicByIsrc, deezerSearch, appleMusicAmpSearch, appleMusicIsrcLookup } from '@/lib/isrc-resolver';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const spotifyUrl = searchParams.get('spotifyUrl') || 'https://open.spotify.com/track/4XohrQVxLoX7l1dRWeywag';
  const artist = searchParams.get('artist') || '';
  const title = searchParams.get('title') || '';

  const results = { spotifyUrl };

  // Step 1: Songlink
  try {
    results.songlink = await fetchCrossPlatformLinks(spotifyUrl);
  } catch (err) {
    results.songlinkError = err.message;
  }

  const resolvedArtist = artist || results.songlink?.artistName || '';
  const resolvedTitle = title || results.songlink?.title || '';
  results.resolvedArtist = resolvedArtist;
  results.resolvedTitle = resolvedTitle;

  // Step 2: iTunes Search
  try {
    results.itunesUrl = await searchAppleMusicUrl(resolvedArtist, resolvedTitle);
  } catch (err) {
    results.itunesError = err.message;
  }

  // Step 3: Deezer text search
  try {
    results.deezerSearch = await deezerSearch(resolvedArtist, resolvedTitle);
  } catch (err) {
    results.deezerError = err.message;
  }

  // Step 4: Apple Music AMP API text search
  results.appleAmpEnv = { hasToken: !!process.env.APPLE_MUSIC_TOKEN };
  try {
    results.appleAmpUrl = await appleMusicAmpSearch(resolvedArtist, resolvedTitle);
  } catch (err) {
    results.appleAmpError = err.message;
  }

  // Step 5: Apple Music AMP API by ISRC (if Deezer gave us one)
  const isrc = results.deezerSearch?.isrc;
  if (isrc) {
    results.isrc = isrc;
    try {
      results.appleAmpIsrcUrl = await appleMusicIsrcLookup(isrc);
    } catch (err) {
      results.appleAmpIsrcError = err.message;
    }
  }

  // Step 6: Spotify Web API
  results.spotifyEnv = {
    hasBasicToken: !!process.env.SPOTIFY_BASIC_TOKEN,
    basicTokenPrefix: process.env.SPOTIFY_BASIC_TOKEN ? process.env.SPOTIFY_BASIC_TOKEN.slice(0, 8) + '...' : 'missing',
    hasClientId: !!process.env.SPOTIFY_CLIENT_ID,
    hasClientSecret: !!process.env.SPOTIFY_CLIENT_SECRET,
  };
  try {
    results.spotifyApi = await fetchSpotifyTrackMeta(spotifyUrl);
  } catch (err) {
    results.spotifyApiError = err.message;
  }

  // Step 7: Spotify oEmbed
  try {
    results.spotifyOembed = await fetchSpotifyMeta(spotifyUrl);
  } catch (err) {
    results.spotifyOembedError = err.message;
  }

  // Summary
  results.finalAppleMusicUrl =
    results.songlink?.appleMusicUrl ||
    results.itunesUrl ||
    results.appleAmpIsrcUrl ||
    results.appleAmpUrl ||
    null;

  return NextResponse.json(results);
}
