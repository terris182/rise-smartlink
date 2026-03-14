import { NextResponse } from 'next/server';
import { getLink } from '@/lib/links';
import { fetchSpotifyMeta } from '@/lib/spotify';

/**
 * GET /api/get-link?slug=artist-name/song-name
 * Retrieves all info for a smart link by its slug or full URL.
 * Designed to be called from Bubble.io workflows.
 *
 * Query params:
 *   slug: string  // The URL path (e.g., "vex-verity/tragedies")
 *                  // Can also pass the full URL — slug will be extracted
 *
 * Response: {
 *   success: true,
 *   link: { slug, title, artist, coverUrl, spotifyUrl, appleMusicUrl,
 *           soundcloudUrl, genre, subgenre, bgColor, createdAt }
 * }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    let slug = searchParams.get('slug');

    if (!slug) {
      return NextResponse.json(
        { error: 'Missing required query param: slug' },
        { status: 400 }
      );
    }

    // Extract slug from full URL if provided
    try {
      const url = new URL(slug);
      slug = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    } catch {
      // Not a full URL — use as-is, just trim slashes
      slug = slug.replace(/^\//, '').replace(/\/$/, '');
    }

    const link = await getLink(slug);
    if (!link) {
      return NextResponse.json(
        { error: `Link not found: ${slug}` },
        { status: 404 }
      );
    }

    // If coverUrl is empty, try to resolve it from Spotify
    if (!link.coverUrl && link.spotifyUrl) {
      const meta = await fetchSpotifyMeta(link.spotifyUrl);
      if (meta?.thumbnailUrl) {
        link.coverUrl = meta.thumbnailUrl;
      }
    }

    // Strip sensitive fields from response
    const { fbAccessToken, fbPixelId, ...safeLink } = link;

    return NextResponse.json({
      success: true,
      link: safeLink,
    });
  } catch (err) {
    console.error('[/api/get-link] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Also support POST for Bubble compatibility
export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.slug) {
      return NextResponse.json(
        { error: 'Missing required field: slug' },
        { status: 400 }
      );
    }

    // Reuse GET logic by constructing a fake URL with the slug as a query param
    const fakeUrl = new URL(`http://localhost/api/get-link?slug=${encodeURIComponent(body.slug)}`);
    const fakeRequest = new Request(fakeUrl.toString(), { method: 'GET' });
    return GET(fakeRequest);
  } catch (err) {
    console.error('[/api/get-link] POST Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
