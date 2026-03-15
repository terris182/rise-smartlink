import { NextResponse } from 'next/server';
import { createLink, getLink } from '@/lib/links';
import { fetchSpotifyMeta } from '@/lib/spotify';
import { fetchCrossPlatformLinks } from '@/lib/songlink';

/**
 * POST /api/create-link
 * Creates a new smart link page from a Spotify track or playlist URL.
 *
 * Required: spotifyUrl
 * Optional: title (headline), artist (subtext), slug, appleMusicUrl, genre, subgenre, bgColor
 *
 * - Auto-fetches artwork from Spotify oEmbed
 * - Auto-resolves Apple Music URL via Songlink/Odesli API
 * - Auto-generates slug from title if not provided
 * - Returns the full gudmuzik.com URL
 *
 * Body: {
 *   spotifyUrl: string,     // Spotify track/album/playlist URL (REQUIRED)
 *   title?: string,         // Headline text (auto-fetched from Spotify if omitted)
 *   artist?: string,        // Subtext (auto-fetched from Spotify if omitted)
 *   slug?: string,          // Custom URL path (auto-generated from title if omitted)
 *   appleMusicUrl?: string, // Apple Music URL (auto-resolved from Spotify if omitted)
 *   genre?: string,         // Genre for CAPI retargeting (optional)
 *   subgenre?: string,      // Subgenre for CAPI retargeting (optional)
 *   bgColor?: string,       // Background color hex (optional)
 * }
 *
 * Response: {
 *   success: true,
 *   link: { ...linkData },
 *   url: "https://gudmuzik.com/my-song"
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.spotifyUrl) {
      return NextResponse.json(
        { error: 'Missing required field: spotifyUrl' },
        { status: 400 }
      );
    }

    // Auto-fetch metadata from Spotify oEmbed (cover art) and Songlink (artist, Apple Music)
    let { title, artist, coverUrl, appleMusicUrl } = body;

    // Songlink/Odesli: most reliable source for artist name, title, and Apple Music URL
    if (!artist || !title || !appleMusicUrl) {
      try {
        const crossLinks = await fetchCrossPlatformLinks(body.spotifyUrl);
        if (crossLinks) {
          if (!artist && crossLinks.artistName) artist = crossLinks.artistName;
          if (!title && crossLinks.title) title = crossLinks.title;
          if (!appleMusicUrl && crossLinks.appleMusicUrl) appleMusicUrl = crossLinks.appleMusicUrl;
        }
      } catch (err) {
        console.error('[create-link] Songlink error:', err.message);
      }
    }

    // Spotify oEmbed: reliable for cover art (and fallback for title/artist)
    if (!coverUrl || !title || !artist) {
      const meta = await fetchSpotifyMeta(body.spotifyUrl);
      if (meta) {
        if (!coverUrl) coverUrl = meta.thumbnailUrl;
        if (!title) title = meta.title || '';
        if (!artist) artist = meta.artist || '';
      }
    }

    if (!title) title = 'Untitled';
    if (!artist) artist = '';

    // Generate slug as artist-name/song-name
    let slug = body.slug;
    if (!slug) {
      const sanitize = (str) =>
        str
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

      const artistSlug = artist ? sanitize(artist) : '';
      const titleSlug = sanitize(title);

      if (artistSlug && titleSlug) {
        slug = `${artistSlug}/${titleSlug}`;
      } else if (titleSlug) {
        slug = titleSlug;
      } else {
        slug = 'link-' + Math.random().toString(36).substring(2, 8);
      }
    } else {
      // Sanitize provided slug (allow forward slashes for artist/song format)
      slug = slug
        .toLowerCase()
        .replace(/[^a-z0-9/-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-/]|[-/]$/g, '');
    }

    // If slug exists, append sequential serial number (-1, -2, etc.)
    if (await getLink(slug)) {
      let serial = 1;
      while (await getLink(`${slug}-${serial}`)) {
        serial++;
      }
      slug = `${slug}-${serial}`;
    }

    const link = await createLink({
      ...body,
      slug,
      title,
      artist,
      coverUrl: coverUrl || '',
      appleMusicUrl: appleMusicUrl || '',
    });

    // Build the full URL using the request host or fallback to gudmuzik.com
    const host = request.headers.get('host') || 'gudmuzik.com';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const fullUrl = `${protocol}://${host}/${slug}`;

    // Strip sensitive fields from response
    const { fbAccessToken, ...safeLink } = link;

    return NextResponse.json({
      success: true,
      link: safeLink,
      url: fullUrl,
    });
  } catch (err) {
    console.error('[/api/create-link] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
