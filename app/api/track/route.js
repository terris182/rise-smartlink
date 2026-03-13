import { NextResponse } from 'next/server';
import { sendFBEvent } from '@/lib/fb-capi';

/**
 * POST /api/track
 * Called from the client to fire server-side FB Conversions API events.
 * The client sends minimal data; the server adds IP + user agent automatically.
 *
 * Body: {
 *   eventName: string,        // e.g. "PageView", "SmartLinkVisit", "LinkClick"
 *   eventId: string,          // unique ID for dedup with browser pixel
 *   sourceUrl: string,        // the page URL
 *   pixelId: string,          // FB pixel ID
 *   accessToken: string,      // FB CAPI access token
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
      accessToken,
      fbc,
      fbp,
      externalId,
      customData = {},
    } = body;

    if (!eventName || !pixelId || !accessToken) {
      return NextResponse.json(
        { error: 'Missing required fields: eventName, pixelId, accessToken' },
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
      pixelId,
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
