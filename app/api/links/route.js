import { NextResponse } from 'next/server';
import { getAllLinks, getLink, updateLink, createLink } from '@/lib/links';
import { fetchSpotifyMeta } from '@/lib/spotify';
import { fetchSpotifyTrackMeta } from '@/lib/spotify-api';
import { fetchCrossPlatformLinks } from '@/lib/songlink';
import { searchAppleMusicUrl } from '@/lib/itunes';
import { resolveAppleMusicByIsrc, appleMediaSearch } from '@/lib/isrc-resolver';

export const dynamic = 'force-dynamic';

/**
 * GET /api/links
 * Returns all smart links (for dashboard).
 */
export async function GET() {
  try {
    const links = await getAllLinks();
    const safeLinks = links.map(({ fbAccessToken, ...rest }) => rest);
    // Sort by createdAt descending
    safeLinks.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return NextResponse.json({ success: true, links: safeLinks });
  } catch (err) {
    console.error('[/api/links] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * Full resolution chain for a link's missing fields.
 * Called when resolve=true is passed, or when Spotify URL changes.
 */
async function resolveFields(link, updates) {
  const spotifyUrl = updates.spotifyUrl || link.spotifyUrl;
  const merged = { ...link, ...updates };
  const resolvedUpdates = {};

  // Songlink: artist, title, Apple Music
  if (spotifyUrl && (!merged.artist || !merged.title || !merged.appleMusicUrl)) {
    try {
      const crossLinks = await fetchCrossPlatformLinks(spotifyUrl);
      if (crossLinks) {
        if (!merged.artist && crossLinks.artistName) {
          resolvedUpdates.artist = crossLinks.artistName;
          merged.artist = crossLinks.artistName;
        }
        if (!merged.title && crossLinks.title) {
          resolvedUpdates.title = crossLinks.title;
          merged.title = crossLinks.title;
        }
        if (!merged.appleMusicUrl && crossLinks.appleMusicUrl) {
          resolvedUpdates.appleMusicUrl = crossLinks.appleMusicUrl;
          merged.appleMusicUrl = crossLinks.appleMusicUrl;
        }
      }
    } catch (err) {
      console.error('[resolveFields] Songlink error:', err.message);
    }
  }

  // iTunes Search (multi-strategy)
  if (!merged.appleMusicUrl && merged.artist && merged.title) {
    try {
      const itunesUrl = await searchAppleMusicUrl(merged.artist, merged.title);
      if (itunesUrl) {
        resolvedUpdates.appleMusicUrl = itunesUrl;
        merged.appleMusicUrl = itunesUrl;
      }
    } catch (err) {
      console.error('[resolveFields] iTunes error:', err.message);
    }
  }

  // Apple Media Services
  if (!merged.appleMusicUrl && merged.artist && merged.title) {
    try {
      const appleUrl = await appleMediaSearch(merged.artist, merged.title);
      if (appleUrl) {
        resolvedUpdates.appleMusicUrl = appleUrl;
        merged.appleMusicUrl = appleUrl;
      }
    } catch (err) {
      console.error('[resolveFields] Apple Media error:', err.message);
    }
  }

  // ISRC-based resolution
  if (!merged.appleMusicUrl && spotifyUrl) {
    try {
      const spotifyMeta = await fetchSpotifyTrackMeta(spotifyUrl);
      if (spotifyMeta?.isrc) {
        const isrcUrl = await resolveAppleMusicByIsrc(
          spotifyMeta.isrc,
          merged.artist || spotifyMeta.artist,
          merged.title || spotifyMeta.title
        );
        if (isrcUrl) {
          resolvedUpdates.appleMusicUrl = isrcUrl;
          merged.appleMusicUrl = isrcUrl;
        }
        if (!merged.artist && spotifyMeta.artist) {
          resolvedUpdates.artist = spotifyMeta.artist;
        }
        if (!merged.title && spotifyMeta.title) {
          resolvedUpdates.title = spotifyMeta.title;
        }
      }
    } catch (err) {
      console.error('[resolveFields] ISRC error:', err.message);
    }
  }

  // Cover art from Spotify oEmbed
  if (!merged.coverUrl && spotifyUrl) {
    try {
      const meta = await fetchSpotifyMeta(spotifyUrl);
      if (meta?.thumbnailUrl) resolvedUpdates.coverUrl = meta.thumbnailUrl;
      if (!merged.artist && meta?.artist) resolvedUpdates.artist = meta.artist;
    } catch (err) {
      console.error('[resolveFields] Spotify oEmbed error:', err.message);
    }
  }

  return resolvedUpdates;
}

/**
 * PUT /api/links
 * Update an existing link by slug.
 * Body: { slug: string, resolve?: boolean, ...fields to update }
 *
 * If resolve=true, runs the full resolution chain to fill in missing fields
 * (Apple Music URL, artist, title, cover art).
 */
export async function PUT(request) {
  try {
    const body = await request.json();
    const { slug, resolve: shouldResolve, ...updates } = body;

    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
    }

    const existing = await getLink(slug);
    if (!existing) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }

    // Run full resolution if requested or if Spotify URL changed
    const spotifyChanged = updates.spotifyUrl && updates.spotifyUrl !== existing.spotifyUrl;
    if (shouldResolve || spotifyChanged) {
      const resolved = await resolveFields(existing, updates);
      // Merge resolved fields (don't overwrite explicit user values)
      for (const [key, value] of Object.entries(resolved)) {
        if (!updates[key]) {
          updates[key] = value;
        }
      }
    }

    const updated = await updateLink(slug, updates);
    const { fbAccessToken, ...safeLink } = updated;

    return NextResponse.json({ success: true, link: safeLink });
  } catch (err) {
    console.error('[/api/links] PUT Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
