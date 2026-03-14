import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getLink, updateLink } from '@/lib/links';

/**
 * PUT /api/update-link
 * Updates an existing smart link landing page by its slug/URL.
 * Designed to be called from Bubble.io workflows.
 *
 * Body: {
 *   slug: string,              // The URL path to update (e.g., "vex-verity/tragedies")
 *                               // Can also pass the full URL — slug will be extracted
 *   title?: string,            // Updated headline text
 *   artist?: string,           // Updated artist name
 *   spotifyUrl?: string,       // Updated Spotify URL
 *   appleMusicUrl?: string,    // Updated Apple Music URL
 *   soundcloudUrl?: string,    // Updated SoundCloud URL
 *   coverUrl?: string,         // Updated cover art URL
 *   genre?: string,            // Updated genre
 *   subgenre?: string,         // Updated subgenre
 *   bgColor?: string,          // Updated background color
 *   fbPixelId?: string,        // Updated Facebook Pixel ID
 *   fbAccessToken?: string,    // Updated Facebook CAPI token
 * }
 *
 * Response: {
 *   success: true,
 *   link: { ...updatedLinkData }
 * }
 */
export async function PUT(request) {
  try {
    const body = await request.json();

    if (!body.slug) {
      return NextResponse.json(
        { error: 'Missing required field: slug (the URL path to update)' },
        { status: 400 }
      );
    }

    // Extract slug from full URL if provided (e.g., "https://gudmuzik.com/artist/song" → "artist/song")
    let slug = body.slug;
    try {
      const url = new URL(slug);
      slug = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    } catch {
      // Not a full URL — use as-is, just trim slashes
      slug = slug.replace(/^\//, '').replace(/\/$/, '');
    }

    const existing = await getLink(slug);
    if (!existing) {
      return NextResponse.json(
        { error: `Link not found: ${slug}` },
        { status: 404 }
      );
    }

    // Build updates object — only include fields that were provided
    const allowedFields = [
      'title', 'artist', 'spotifyUrl', 'appleMusicUrl', 'soundcloudUrl',
      'coverUrl', 'genre', 'subgenre', 'bgColor', 'fbPixelId', 'fbAccessToken',
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No updatable fields provided' },
        { status: 400 }
      );
    }

    const updated = await updateLink(slug, updates);

    // Purge cached page so the updated data is served immediately
    try {
      revalidatePath(`/${slug}`);
    } catch (e) {
      console.warn('[/api/update-link] revalidatePath warning:', e.message);
    }

    // Strip sensitive fields from response
    const { fbAccessToken, ...safeLink } = updated;

    return NextResponse.json({
      success: true,
      link: safeLink,
    });
  } catch (err) {
    console.error('[/api/update-link] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Also support POST for Bubble compatibility (Bubble's API Connector defaults to POST)
export async function POST(request) {
  return PUT(request);
}
