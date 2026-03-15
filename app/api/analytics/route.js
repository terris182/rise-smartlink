import { NextResponse } from 'next/server';
import { getAnalytics, getAllAnalytics } from '@/lib/analytics';
import { getLink, getAllLinks } from '@/lib/links';

/**
 * GET /api/analytics?slug=artist/song
 * Returns analytics for a specific slug, or all slugs if no slug provided.
 *
 * Query params:
 *   slug (optional) — specific link slug to get detailed analytics for
 *
 * Without slug: returns overview of all links with visit/click counts
 * With slug: returns detailed analytics including platforms, countries, daily
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get('slug');

    if (slug) {
      // Detailed analytics for one slug
      const [analytics, link] = await Promise.all([
        getAnalytics(slug),
        getLink(slug),
      ]);

      if (!link) {
        return NextResponse.json({ error: 'Link not found' }, { status: 404 });
      }

      // Strip sensitive fields
      const { fbAccessToken, ...safeLink } = link;

      return NextResponse.json({
        success: true,
        link: safeLink,
        analytics,
      });
    }

    // Overview: all links with analytics summary
    const [allAnalytics, allLinks] = await Promise.all([
      getAllAnalytics(),
      getAllLinks(),
    ]);

    // Merge link info with analytics
    const overview = allLinks.map((link) => {
      const { fbAccessToken, ...safeLink } = link;
      const stats = allAnalytics[link.slug] || { visits: 0, clicks: 0 };
      return {
        ...safeLink,
        visits: stats.visits || 0,
        clicks: stats.clicks || 0,
        ctr: stats.visits > 0 ? ((stats.clicks / stats.visits) * 100).toFixed(1) : '0.0',
        lastEvent: stats.lastEvent || null,
      };
    });

    // Sort by most recent activity
    overview.sort((a, b) => (b.lastEvent || 0) - (a.lastEvent || 0));

    return NextResponse.json({
      success: true,
      links: overview,
      totalLinks: overview.length,
      totalVisits: overview.reduce((sum, l) => sum + l.visits, 0),
      totalClicks: overview.reduce((sum, l) => sum + l.clicks, 0),
    });
  } catch (err) {
    console.error('[/api/analytics] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
