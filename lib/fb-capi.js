import crypto from 'crypto';

/**
 * Facebook Conversions API helper
 * Sends server-side events to Facebook for reliable tracking
 * that doesn't get blocked by ad blockers or iOS privacy changes
 */

const FB_GRAPH_URL = 'https://graph.facebook.com/v19.0';

/**
 * Hash a value using SHA-256 (required by FB CAPI)
 */
function hashValue(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/**
 * Send an event to Facebook Conversions API
 * @param {Object} params
 * @param {string} params.pixelId - Facebook Pixel ID
 * @param {string} params.accessToken - Facebook Conversions API access token
 * @param {string} params.eventName - Event name (e.g., 'PageView', 'ViewContent', 'Lead')
 * @param {string} params.eventId - Unique event ID for deduplication with browser pixel
 * @param {string} params.sourceUrl - The URL where the event occurred
 * @param {Object} params.userData - User data for matching (ip, userAgent, fbc, fbp, etc.)
 * @param {Object} params.customData - Custom data to include with the event
 * @param {string} params.actionSource - Where the event came from ('website')
 */
export async function sendFBEvent({
  pixelId,
  accessToken,
  eventName,
  eventId,
  sourceUrl,
  userData = {},
  customData = {},
  actionSource = 'website',
}) {
  if (!pixelId || !accessToken) {
    console.warn('[FB CAPI] Missing pixelId or accessToken, skipping event');
    return null;
  }

  const eventTime = Math.floor(Date.now() / 1000);

  // Build user_data with hashing where required
  const user_data = {};
  if (userData.ip) user_data.client_ip_address = userData.ip;
  if (userData.userAgent) user_data.client_user_agent = userData.userAgent;
  if (userData.fbc) user_data.fbc = userData.fbc;
  if (userData.fbp) user_data.fbp = userData.fbp;
  if (userData.externalId) user_data.external_id = hashValue(userData.externalId);
  if (userData.email) user_data.em = [hashValue(userData.email)];
  if (userData.phone) user_data.ph = [hashValue(userData.phone)];
  if (userData.firstName) user_data.fn = hashValue(userData.firstName);
  if (userData.lastName) user_data.ln = hashValue(userData.lastName);
  if (userData.city) user_data.ct = hashValue(userData.city);
  if (userData.state) user_data.st = hashValue(userData.state);
  if (userData.zip) user_data.zp = hashValue(userData.zip);
  if (userData.country) user_data.country = hashValue(userData.country);

  const eventPayload = {
    event_name: eventName,
    event_time: eventTime,
    event_id: eventId,
    event_source_url: sourceUrl,
    action_source: actionSource,
    user_data,
  };

  if (Object.keys(customData).length > 0) {
    eventPayload.custom_data = customData;
  }

  const payload = {
    data: [eventPayload],
  };

  // Include test_event_code if set — enables events to show in
  // Events Manager → Test Events tab for debugging.
  // Set FB_TEST_EVENT_CODE env var in Vercel to the code shown on the Test Events page.
  const testCode = process.env.FB_TEST_EVENT_CODE;
  if (testCode) {
    payload.test_event_code = testCode;
  }

  try {
    const url = `${FB_GRAPH_URL}/${pixelId}/events?access_token=${accessToken}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[FB CAPI] Error:', JSON.stringify(result));
      return { error: result };
    }

    console.log(`[FB CAPI] ${eventName} sent successfully:`, result);
    return result;
  } catch (err) {
    console.error('[FB CAPI] Network error:', err.message);
    return { error: err.message };
  }
}
