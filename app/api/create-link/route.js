import { NextResponse } from 'next/server';
import { createLink, getLink } from '@/lib/links';
import { fetchSpotifyMeta } from '@/lib/spotify';
import { fetchSpotifyTrackMeta } from '@/lib/spotify-api';
import { fetchCrossPlatformLinks } from '@/lib/songlink';
import { searchAppleMusicUrl } from '@/lib/itunes';
import { resolveAppleMusicByIsrc, deezerSearch, appleMusicAmpSearch } from '@/lib/isrc-resolver';

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

    // Auto-fetch metadata from multiple sources, in priority order
    let { title, artist, coverUrl, appleMusicUrl } = body;
    let spotifyIsrc = null;

    // ── Step 1: Songlink (primary — gives Apple Music URL directly) ──
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

    // ── Step 2: Spotify Web API (early — provides artist/title/ISRC) ──
    if (!artist || !title || !appleMusicUrl) {
      try {
        const spotifyMeta = await fetchSpotifyTrackMeta(body.spotifyUrl);
        if (spotifyMeta) {
          spotifyIsrc = spotifyMeta.isrc;
          if (!artist && spotifyMeta.artist) artist = spotifyMeta.artist;
          if (!title && spotifyMeta.title) title = spotifyMeta.title;
          console.log(`[create-link] Spotify API: "${spotifyMeta.title}" by ${spotifyMeta.artist}, ISRC: ${spotifyMeta.isrc}`);
        }
      } catch (err) {
        console.error('[create-link] Spotify API error:', err.message);
      }
    }

    // ── Step 3: Spotify oEmbed (cover art + backup title/artist) ──
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

    // ── Step 4: iTunes Search ──
    if (!appleMusicUrl && artist && title) {
      try {
        const itunesUrl = await searchAppleMusicUrl(artist, title);
        if (itunesUrl) appleMusicUrl = itunesUrl;
      } catch (err) {
        console.error('[create-link] iTunes search error:', err.message);
      }
    }

    // ── Step 5: ISRC-based resolution ──
    if (!appleMusicUrl && (spotifyIsrc || (artist && title))) {
      try {
        let isrc = spotifyIsrc;
        if (!isrc && artist && title) {
          const deezerResult = await deezerSearch(artist, title);
          if (deezerResult?.isrc) {
            isrc = deezerResult.isrc;
            console.log(`[create-link] Deezer found ISRC: ${isrc}`);
          }
        }
        if (isrc) {
          const isrcUrl = await resolveAppleMusicByIsrc(isrc, artist, title);
          if (isrcUrl) appleMusicUrl = isrcUrl;
        }
      } catch (err) {
        console.error('[create-link] ISRC resolution error:', err.message);
      }
    }

    // ── Step 6: Apple Music AMP text search (last resort) ──
    if (!appleMusicUrl && artist && title) {
      try {
        const ampUrl = await appleMusicAmpSearch(artist, title);
        if (ampUrl) appleMusicUrl = ampUrl;
      } catch (err) {
        console.error('[create-link] Apple AMP error:', err.message);
      }
    }

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
