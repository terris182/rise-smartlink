import { NextResponse } from 'next/server';
import { searchAppleMusicUrl } from '@/lib/itunes';
import { fetchCrossPlatformLinks } from '@/lib/songlink';
import { fetchSpotifyMeta } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

/**
 * GET /api/debug?artist=Vex+Verity&title=Irreverent&spotifyUrl=...
 * Tests all three resolvers and returns their raw results.
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

  // Test iTunes Search — raw API call to see what we get
  try {
    const query = `${artist} ${title}`;
    const params = new URLSearchParams({
      term: query,
      media: 'music',
      entity: 'song',
      limit: '5',
    });
    const itunesRes = await fetch(`https://itunes.apple.com/search?${params}`);
    const itunesRaw = await itunesRes.json();
    results.itunesRaw = {
      status: itunesRes.status,
      resultCount: itunesRaw.resultCount,
      results: (itunesRaw.results || []).map(r => ({
        trackName: r.trackName,
        artistName: r.artistName,
        trackViewUrl: r.trackViewUrl,
        collectionName: r.collectionName,
      })),
    };

    // Also run through the search function
    const itunesUrl = await searchAppleMusicUrl(artist, title);
    results.itunesMatchedUrl = itunesUrl;
  } catch (err) {
    results.itunesError = err.message;
    results.itunesStack = err.stack;
  }

  // Test with just artist name
  try {
    const params2 = new URLSearchParams({
      term: artist,
      media: 'music',
      entity: 'song',
      limit: '5',
    });
    const res2 = await fetch(`https://itunes.apple.com/search?${params2}`);
    const raw2 = await res2.json();
    results.itunesArtistOnly = {
      resultCount: raw2.resultCount,
      results: (raw2.results || []).slice(0, 3).map(r => ({
        trackName: r.trackName,
        artistName: r.artistName,
        trackViewUrl: r.trackViewUrl,
      })),
    };
  } catch (err) {
    results.itunesArtistOnlyError = err.message;
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
