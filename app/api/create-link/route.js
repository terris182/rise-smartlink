import { NextResponse } from 'next/server';
import { createLink, getLink } from '@/lib/links';
import { fetchSpotifyMeta } from '@/lib/spotify';

/**
 * POST /api/create-link
 * Creates a new smart link page.
 *
 * Only requires: slug, spotifyUrl
 * Title, artist, and coverUrl are auto-fetched from Spotify oEmbed if not provided.
 *
 * Body: {
 *   slug: string,           // URL path e.g. "my-new-song"
 *   spotifyUrl: string,     // Spotify track/album URL (REQUIRED)
 *   title?: string,         // Song title (auto-fetched from Spotify if omitted)
 *   artist?: string,        // Artist name (auto-fetched from Spotify if omitted)
 *   coverUrl?: string,      // Cover art URL (auto-fetched from Spotify if omitted)
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
    if (!body.slug) {
      return NextResponse.json({ error: 'Missing required field: slug' }, { status: 400 });
    }
    if (!body.spotifyUrl) {
      return NextResponse.json({ error: 'Missing required field: spotifyUrl' }, { status: 400 });
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

    // Auto-fetch metadata from Spotify oEmbed if title/artist/cover not provided
    let { title, artist, coverUrl } = body;
    if (!title || !artist || !coverUrl) {
      const meta = await fetchSpotifyMeta(body.spotifyUrl);
      if (meta) {
        if (!coverUrl) coverUrl = meta.thumbnailUrl;
        // oEmbed title format: "Track Name" (no artist separation available)
        if (!title) title = meta.title || body.slug;
      }
    }

    if (!title) title = body.slug;
    if (!artist) artist = '';

    const link = createLink({ ...body, slug, title, artist, coverUrl });

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
