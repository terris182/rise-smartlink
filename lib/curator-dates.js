/**
 * Our own per-playlist "first added" date store, in Vercel KV. This is the
 * authoritative recency signal for Refresh mode — it never gets wiped by a
 * playlist rewrite (unlike Spotify's added_at). Re-submitting a song refreshes
 * its date to now. Falls back to an in-memory map for local dev.
 *
 * Shape: KV key `curator:dates:<playlistId>` -> { [trackId]: ISO8601 }
 */
import { kv } from '@vercel/kv';

const PREFIX = 'curator:dates:';
const kvAvailable = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const mem = new Map();

export async function getDates(playlistId) {
  if (!kvAvailable) return mem.get(playlistId) || {};
  try {
    return (await kv.get(`${PREFIX}${playlistId}`)) || {};
  } catch (err) {
    console.error('[curator-dates] get error:', err);
    return {};
  }
}

export async function saveDates(playlistId, map) {
  if (!kvAvailable) {
    mem.set(playlistId, map);
    return;
  }
  try {
    await kv.set(`${PREFIX}${playlistId}`, map);
  } catch (err) {
    console.error('[curator-dates] save error:', err);
  }
}
