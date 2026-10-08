import { NextResponse } from 'next/server';
import { createLink, getLink, findLinkBySpotifyTrack, findLinkByDeal } from '@/lib/links';
import { parseSpotifyTrackId, isSlugVariant } from '@/lib/link-match';
import { fetchSpotifyMeta } from '@/lib/spotify';
import { fetchSpotifyTrackMeta } from '@/lib/spotify-api';
import { searchAppleMusicUrl } from '@/lib/itunes';
import { resolveAppleMusicByIsrc, deezerSearch } from '@/lib/isrc-resolver';
import { checkApiKey } from '@/lib/api-key';

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
 *   reuseExisting?: boolean,// Opt-in: return the existing link for the same song instead of minting a new slug
 *   dealId?: string,        // Optional deal id; indexed on create and matched first when reuseExisting is set
 * }
 *
 * Response: {
 *   success: true,
 *   link: { ...linkData },
 *   url: "https://gudmuzik.com/my-song",
 *   reused?: true           // Only present when reuseExisting returned an existing link
 * }
 *
 * Without reuseExisting the behavior is unchanged: a new slug is always minted
 * (with -1, -2 appended on collision).
 */
export async function POST(request) {
  try {
    const keyCheck = checkApiKey(request);
    if (!keyCheck.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Normalize junk values some API clients (e.g. Bubble) send for blank params
    const junk = (v) => v === null || v === undefined || v === '' || v === 'null' || v === 'undefined';
    for (const k of ['title', 'artist', 'coverUrl', 'appleMusicUrl', 'genre', 'subgenre', 'slug', 'bgColor', 'dealId']) {
      if (junk(body[k])) delete body[k];
    }

    // Validate required fields
    if (!body.spotifyUrl) {
      return NextResponse.json(
        { error: 'Missing required field: spotifyUrl' },
        { status: 400 }
      );
    }

    const host = request.headers.get('host') || 'gudmuzik.com';
    const protocol = host.includes('localhost') ? 'http' : 'https';

    // ── Opt-in reuse: hand back the link already built for this song ──
    const reuseExisting = body.reuseExisting === true || body.reuseExisting === 'true';
    const requestedTrackId = parseSpotifyTrackId(body.spotifyUrl);
    const reusedResponse = (existing) => {
      const { fbAccessToken, ...safeExisting } = existing;
      return NextResponse.json({
        success: true,
        link: safeExisting,
        url: `${protocol}://${host}/${existing.slug}`,
        reused: true,
      });
    };

    if (reuseExisting && body.dealId) {
      const byDeal = await findLinkByDeal(body.dealId);
      // Never hand back a deal's link for a different track
      if (byDeal && (!requestedTrackId || parseSpotifyTrackId(byDeal.spotifyUrl) === requestedTrackId)) {
        return reusedResponse(byDeal);
      }
    }

    // Auto-fetch metadata from multiple sources, in priority order
    let { title, artist, coverUrl, appleMusicUrl } = body;
    let spotifyIsrc = null;

    // Songlink/Odesli step removed 2026-08-26 (WHI-1174): official APIs only.

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

    if (reuseExisting && requestedTrackId) {
      const byTrack = await findLinkBySpotifyTrack(requestedTrackId, artist);
      if (byTrack) return reusedResponse(byTrack);
    }

    // spotifyOnly links (Active Listener campaigns) skip Apple Music resolution entirely
    const spotifyOnly = body.spotifyOnly === true || body.spotifyOnly === 'true';

    // ── Step 4: iTunes Search ──
    if (!spotifyOnly && !appleMusicUrl && artist && title) {
      try {
        const itunesUrl = await searchAppleMusicUrl(artist, title);
        if (itunesUrl) appleMusicUrl = itunesUrl;
      } catch (err) {
        console.error('[create-link] iTunes search error:', err.message);
      }
    }

    // ── Step 5: ISRC-based resolution ──
    if (!spotifyOnly && !appleMusicUrl && (spotifyIsrc || (artist && title))) {
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

    // Note: Step 6 (standalone AMP text search) removed — resolveAppleMusicByIsrc
    // already includes AMP text search as Strategy B internally.

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
    const baseExisting = await getLink(slug);
    if (baseExisting) {
      // Reuse fallback for links created before the reuse index existed:
      // if the slug or one of its -N variants already points at this track,
      // return that link (read only, nothing is written).
      if (reuseExisting && requestedTrackId && parseSpotifyTrackId(baseExisting.spotifyUrl) === requestedTrackId) {
        return reusedResponse(baseExisting);
      }
      let serial = 1;
      let variant;
      while ((variant = await getLink(`${slug}-${serial}`))) {
        if (
          reuseExisting && requestedTrackId &&
          isSlugVariant(variant.slug || `${slug}-${serial}`, slug) &&
          parseSpotifyTrackId(variant.spotifyUrl) === requestedTrackId
        ) {
          return reusedResponse(variant);
        }
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
