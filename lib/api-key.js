import { timingSafeEqual, createHash } from 'crypto';

let warned = false;

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

/**
 * Opt-in shared-key check for server-to-server callers (e.g. Bubble).
 *
 * - SMARTLINK_API_KEY unset: allow everything (returns enforced: false).
 * - SMARTLINK_API_KEY set: require "Authorization: Bearer <key>" or "x-api-key: <key>".
 */
export function checkApiKey(request) {
  const expected = process.env.SMARTLINK_API_KEY;

  if (!expected) {
    if (!warned) {
      warned = true;
      console.warn('[api-key] SMARTLINK_API_KEY is not set; create-link and update-link are unauthenticated.');
    }
    return { ok: true, enforced: false };
  }

  let provided = request.headers.get('x-api-key');
  if (!provided) {
    const auth = request.headers.get('authorization') || '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) provided = match[1].trim();
  }
  if (!provided) return { ok: false, enforced: true };

  // Hash both sides so the compare is constant-time regardless of length.
  const ok = timingSafeEqual(digest(provided), digest(expected));
  return { ok, enforced: true };
}
