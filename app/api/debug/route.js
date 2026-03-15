import { NextResponse } from 'next/server';
import { searchAppleMusicUrl } from '@/lib/itunes';
import { fetchCrossPlatformLinks } from '@/lib/songlink';
import { fetchSpotifyMeta } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

/**
 * GET /api/debug?artist=Vex+Verity&title=Irreverent&spotifyUrl=...
 * Tests all three resolvers and returns their results.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const artist = searchParams.get('artist') || 'Vex Verity';
  const title = searchParams.get('title') || 'Irreverent';
  const spotifyUrl = searchParams.get('spotifyUrl') || 'https://open.spotify.com/track/4XohrQVxLoX7l1dRWeywag';

  const results = {};

  // Test Songlink
  try {
    const songlink = await fetchCrossPlatformLinks(spotifyUrl);
    results.songlink = songlink;
  } catch (err) {
    results.songlinkError = err.message;
  }

  // Test iTunes Search
  try {
    const itunesUrl = await searchAppleMusicUrl(artist, title);
    results.itunesUrl = itunesUrl;
  } catch (err) {
    results.itunesError = err.message;
  }

  // Test Spotify oEmbed
  try {
    const meta = await fetchSpotifyMeta(spotifyUrl);
    results.spotifyMeta = meta;
  } catch (err) {
    results.spotifyError = err.message;
  }

  return NextResponse.json(results);
}
