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

  // Step 1: Spotify Web API (run FIRST to get artist/title/ISRC)
  const basicToken = process.env.SPOTIFY_BASIC_TOKEN;
  results.spotifyEnv = {
    hasBasicToken: !!basicToken,
    basicTokenPrefix: basicToken ? basicToken.slice(0, 8) + '...' : 'missing',
    hasClientId: !!process.env.SPOTIFY_CLIENT_ID,
    hasClientSecret: !!process.env.SPOTIFY_CLIENT_SECRET,
  };

  // Direct token exchange test to surface the exact error
  if (basicToken) {
    try {
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const tokenBody = await tokenRes.text();
      results.spotifyTokenTest = {
        status: tokenRes.status,
        response: tokenBody.length > 200 ? tokenBody.slice(0, 200) + '...' : tokenBody,
      };
    } catch (err) {
      results.spotifyTokenTest = { error: err.message };
    }
  }

  try {
    results.spotifyApi = await fetchSpotifyTrackMeta(spotifyUrl);
  } catch (err) {
    results.spotifyApiError = err.message;
  }

  // Step 2: Spotify oEmbed (backup for title/artist)
  try {
    results.spotifyOembed = await fetchSpotifyMeta(spotifyUrl);
  } catch (err) {
    results.spotifyOembedError = err.message;
  }

  // Step 3: Songlink
  try {
    results.songlink = await fetchCrossPlatformLinks(spotifyUrl);
  } catch (err) {
    results.songlinkError = err.message;
  }

  // Resolve artist/title from best available source
  const resolvedArtist = artist
    || results.spotifyApi?.artist
    || results.songlink?.artistName
    || results.spotifyOembed?.artist
    || '';
  const resolvedTitle = title
    || results.spotifyApi?.title
    || results.songlink?.title
    || results.spotifyOembed?.title
    || '';
  const isrc = results.spotifyApi?.isrc || null;

  results.resolvedArtist = resolvedArtist;
  results.resolvedTitle = resolvedTitle;
  results.isrc = isrc;

  // Step 4: iTunes Search
  try {
    results.itunesUrl = await searchAppleMusicUrl(resolvedArtist, resolvedTitle);
  } catch (err) {
    results.itunesError = err.message;
  }

  // Step 5: Deezer text search
  try {
    results.deezerSearch = await deezerSearch(resolvedArtist, resolvedTitle);
  } catch (err) {
    results.deezerError = err.message;
  }

  // Step 6: Apple Music AMP API text search
  results.appleAmpEnv = {
    hasToken: !!process.env.APPLE_MUSIC_TOKEN,
    tokenPrefix: process.env.APPLE_MUSIC_TOKEN ? process.env.APPLE_MUSIC_TOKEN.slice(0, 20) + '...' : 'missing',
  };
  try {
    results.appleAmpUrl = await appleMusicAmpSearch(resolvedArtist, resolvedTitle);
  } catch (err) {
    results.appleAmpError = err.message;
  }

  // Step 7: Apple Music AMP API by ISRC
  const resolvedIsrc = isrc || results.deezerSearch?.isrc;
  if (resolvedIsrc) {
    results.resolvedIsrc = resolvedIsrc;
    try {
      results.appleAmpIsrcUrl = await appleMusicIsrcLookup(resolvedIsrc);
    } catch (err) {
      results.appleAmpIsrcError = err.message;
    }
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
