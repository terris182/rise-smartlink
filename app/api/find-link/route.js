import { NextResponse } from 'next/server';
import { findLinkBySpotifyTrack, findLinkByDeal } from '@/lib/links';
import { parseSpotifyTrackId } from '@/lib/link-match';

/**
 * GET /api/find-link?spotifyUrl=...&artist=...
 * GET /api/find-link?dealId=...
 * Looks up the smart link already created for a song, without creating one.
 * Same auth posture as /api/get-link (public read, sensitive fields stripped).
 *
 * Query params:
 *   dealId?: string      // Checked first when present
 *   spotifyUrl?: string  // Spotify track URL or URI
 *   artist?: string      // Artist name or slug the link was created with
 *                        // (the index is keyed by track id + artist)
 *
 * Response (200): {
 *   success: true,
 *   link: { slug, title, artist, coverUrl, spotifyUrl, appleMusicUrl, ... },
 *   url: "https://gudmuzik.com/artist/song",
 *   matchedBy: "dealId" | "spotifyTrack"
 * }
 * Response (404): { error: "No existing link found" }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const dealId = (searchParams.get('dealId') || '').trim();
    const spotifyUrl = (searchParams.get('spotifyUrl') || '').trim();
    const artist = (searchParams.get('artist') || '').trim();

    if (!dealId && !spotifyUrl) {
      return NextResponse.json(
        { error: 'Missing required query param: spotifyUrl or dealId' },
        { status: 400 }
      );
    }

    let link = null;
    let matchedBy = null;

    if (dealId) {
      link = await findLinkByDeal(dealId);
      if (link) matchedBy = 'dealId';
    }

    if (!link && spotifyUrl) {
      const trackId = parseSpotifyTrackId(spotifyUrl);
      if (!trackId && !dealId) {
        return NextResponse.json(
          { error: 'spotifyUrl must be a Spotify track URL' },
          { status: 400 }
        );
      }
      if (trackId) {
        link = await findLinkBySpotifyTrack(trackId, artist);
        if (link) matchedBy = 'spotifyTrack';
      }
    }

    if (!link) {
      return NextResponse.json({ error: 'No existing link found' }, { status: 404 });
    }

    const host = request.headers.get('host') || 'gudmuzik.com';
    const protocol = host.includes('localhost') ? 'http' : 'https';

    // Strip sensitive fields from response (same as get-link)
    const { fbAccessToken, fbPixelId, ...safeLink } = link;

    return NextResponse.json({
      success: true,
      link: safeLink,
      url: `${protocol}://${host}/${link.slug}`,
      matchedBy,
    });
  } catch (err) {
    console.error('[/api/find-link] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
