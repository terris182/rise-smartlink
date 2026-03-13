import { NextResponse } from 'next/server';
import { createLink, getLink } from '@/lib/links';

/**
 * POST /api/create-link
 * Creates a new smart link page.
 *
 * Body: {
 *   slug: string,           // URL path e.g. "my-new-song"
 *   title: string,          // Song title
 *   artist: string,         // Artist name
 *   coverUrl: string,       // Cover art image URL
 *   spotifyUrl: string,     // Spotify track/album URL
 *   appleMusicUrl?: string, // Apple Music URL (optional)
 *   soundcloudUrl?: string, // SoundCloud URL (optional)
 *   genre?: string,         // Genre (optional)
 *   fbPixelId?: string,     // FB Pixel ID (optional, falls back to env)
 *   fbAccessToken?: string, // FB CAPI token (optional, falls back to env)
 *   bgColor?: string,       // Background color hex (optional)
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();

    // Validate required fields
    const required = ['slug', 'title', 'artist', 'coverUrl', 'spotifyUrl'];
    for (const field of required) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Sanitize slug
    const slug = body.slug
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Check if slug already exists
    if (getLink(slug)) {
      return NextResponse.json(
        { error: `Slug "${slug}" already exists` },
        { status: 409 }
      );
    }

    const link = createLink({ ...body, slug });

    return NextResponse.json({
      success: true,
      link,
      url: `/${slug}`,
    });
  } catch (err) {
    console.error('[/api/create-link] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
