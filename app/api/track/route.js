import { NextResponse } from 'next/server';
import { sendFBEvent } from '@/lib/fb-capi';

/**
 * POST /api/track
 * Called from the client to fire server-side FB Conversions API events.
 * The client sends minimal data; the server adds IP + user agent automatically.
 * Access token is read from env vars (never sent from the client).
 *
 * Body: {
 *   eventName: string,        // e.g. "PageView", "SmartLinkVisit", "LinkClick"
 *   eventId: string,          // unique ID for dedup with browser pixel
 *   sourceUrl: string,        // the page URL
 *   pixelId: string,          // FB pixel ID (or uses env default)
 *   fbc?: string,             // _fbc cookie value
 *   fbp?: string,             // _fbp cookie value
 *   externalId?: string,      // hashed external user ID
 *   customData?: object,      // any custom data (artist_name, title, genre, etc.)
 * }
 */
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
      },
      customData,
    });

    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error('[/api/track] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
