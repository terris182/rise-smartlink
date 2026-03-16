import { NextResponse } from 'next/server';
import { getAllLinks, getLink, updateLink, createLink } from '@/lib/links';
import { fetchSpotifyMeta } from '@/lib/spotify';
import { fetchSpotifyTrackMeta } from '@/lib/spotify-api';
import { fetchCrossPlatformLinks } from '@/lib/songlink';
import { searchAppleMusicUrl } from '@/lib/itunes';
import { resolveAppleMusicByIsrc } from '@/lib/isrc-resolver';

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
 * PUT /api/links
 * Update an existing link by slug.
 * Body: { slug: string, ...fields to update }
 */
export async function PUT(request) {
  try {
    const body = await request.json();
    const { slug, ...updates } = body;

    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
    }

    const existing = await getLink(slug);
    if (!existing) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }

    // If spotifyUrl changed and appleMusicUrl not provided, auto-resolve
    if (updates.spotifyUrl && updates.spotifyUrl !== existing.spotifyUrl && !updates.appleMusicUrl) {
      const crossLinks = await fetchCrossPlatformLinks(updates.spotifyUrl);
      if (crossLinks?.appleMusicUrl) {
        updates.appleMusicUrl = crossLinks.appleMusicUrl;
      }
      // Also refresh cover art
      const meta = await fetchSpotifyMeta(updates.spotifyUrl);
      if (meta?.thumbnailUrl && !updates.coverUrl) {
        updates.coverUrl = meta.thumbnailUrl;
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
