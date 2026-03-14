import { NextResponse } from 'next/server';
import { sendFBEvent } from '@/lib/fb-capi';

/**
 * POST /api/track
 * Called from the client to fire server-side FB Conversions API events.
 * The client sends minimal data; the server adds IP, user agent, geo, and device info automatically.
 * Access token is read from env vars (never sent from the client).
 *
 * Body: {
 *   eventName: string,        // e.g. "PageView", "SmartLinkVisit", "SmartLinkClick"
 *   eventId: string,          // unique ID for dedup with browser pixel
 *   sourceUrl: string,        // the page URL
 *   pixelId: string,          // FB pixel ID (or uses env default)
 *   fbc?: string,             // _fbc cookie value
 *   fbp?: string,             // _fbp cookie value
 *   externalId?: string,      // hashed external user ID
 *   customData?: object,      // any custom data (artist_name, title, genre, subgenre, platform, etc.)
 * }
 *
 * Server-enriched data (added automatically from request headers):
 * - IP address (x-forwarded-for)
 * - User agent
 * - Geo: country, region, city (from Vercel x-vercel-ip-* headers)
 * - Device type: parsed from user-agent (mobile/desktop/tablet)
 * - OS: parsed from user-agent
 * - UTM params: extracted from sourceUrl
 */

/**
 * Parse device type and OS from user-agent string
 */
function parseDevice(ua) {
  if (!ua) return { deviceType: 'unknown', os: 'unknown' };

  const uaLower = ua.toLowerCase();
  let os = 'unknown';
  let deviceType = 'desktop';

  // Detect OS
  if (/iphone|ipad|ipod/.test(uaLower)) {
    os = 'iOS';
    deviceType = /ipad/.test(uaLower) ? 'tablet' : 'mobile';
  } else if (/android/.test(uaLower)) {
    os = 'Android';
    deviceType = /tablet|sm-t|gt-p|nexus\s?(7|9|10)/.test(uaLower) ? 'tablet' : 'mobile';
  } else if (/macintosh|mac os x/.test(uaLower)) {
    os = 'macOS';
  } else if (/windows/.test(uaLower)) {
    os = 'Windows';
  } else if (/linux/.test(uaLower)) {
    os = 'Linux';
  } else if (/cros/.test(uaLower)) {
    os = 'ChromeOS';
  }

  return { deviceType, os };
}

/**
 * Extract UTM parameters from a URL
 */
function extractUTMs(url) {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    const utms = {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const val = parsed.searchParams.get(key);
      if (val) utms[key] = val;
    }
    return utms;
  } catch {
    return {};
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      eventName,
      eventId,
      sourceUrl,
      pixelId,
      fbc,
      fbp,
      externalId,
      customData = {},
    } = body;

    // Use env vars for credentials (never trust client-sent tokens)
    const resolvedPixelId = pixelId || process.env.FB_PIXEL_ID;
    const accessToken = process.env.FB_ACCESS_TOKEN;

    if (!eventName || !resolvedPixelId || !accessToken) {
      return NextResponse.json(
        { error: 'Missing required fields or FB credentials not configured' },
        { status: 400 }
      );
    }

    // Extract IP and User-Agent from the request headers
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      '0.0.0.0';
    const userAgent = request.headers.get('user-agent') || '';

    // Extract Vercel geo headers (free on all Vercel plans)
    const country = request.headers.get('x-vercel-ip-country') || '';
    const region = request.headers.get('x-vercel-ip-country-region') || '';
    const city = request.headers.get('x-vercel-ip-city') || '';

    // Parse device info from user-agent
    const { deviceType, os } = parseDevice(userAgent);

    // Extract UTM params from the source URL
    const utms = extractUTMs(sourceUrl);

    // Build enriched custom data for CAPI
    // Genre/subgenre go into content_category for FB retargeting audiences
    const enrichedCustomData = {
      ...customData,
    };

    // FB CAPI standard fields for content categorization
    if (customData.genre) {
      enrichedCustomData.content_category = customData.subgenre
        ? `${customData.genre} > ${customData.subgenre}`
        : customData.genre;
    }

    // Add geo data
    if (country) enrichedCustomData.geo_country = country;
    if (region) enrichedCustomData.geo_region = region;
    if (city) enrichedCustomData.geo_city = city;

    // Add device data
    enrichedCustomData.device_type = deviceType;
    enrichedCustomData.device_os = os;

    // Add UTM data
    if (Object.keys(utms).length > 0) {
      Object.assign(enrichedCustomData, utms);
    }

    const result = await sendFBEvent({
      pixelId: resolvedPixelId,
      accessToken,
      eventName,
      eventId,
      sourceUrl,
      userData: {
        ip,
        userAgent,
        fbc: fbc || undefined,
        fbp: fbp || undefined,
        externalId: externalId || undefined,
        // Pass geo to user_data for FB matching (hashed automatically by fb-capi.js)
        city: city || undefined,
        state: region || undefined,
        country: country || undefined,
      },
      customData: enrichedCustomData,
    });

    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error('[/api/track] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
