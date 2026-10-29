/**
 * Spotify Web API helper (client credentials flow).
 * Used to fetch track metadata including ISRC codes, which are needed
 * for cross-platform resolution when Songlink doesn't have Apple Music.
 *
 * This does NOT require user authentication — it uses the client_credentials
 * grant type which only needs a client_id and client_secret.
 *
 * Environment variables (set in Vercel dashboard) — use ONE of these options:
 *
 * Option A (recommended): Single token
 * - SPOTIFY_BASIC_TOKEN — base64-encoded "client_id:client_secret" string
 *   (this is the "client grant token" from Spotify)
 *
 * Option B: Separate credentials
 * - SPOTIFY_CLIENT_ID — from Spotify Developer app
 * - SPOTIFY_CLIENT_SECRET — from Spotify Developer app
 */

import { createTtlCache, cached } from './ttl-cache.js';

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Get a Spotify access token using client credentials flow.
 * Caches the token until it expires.
 *
 * Supports either a pre-encoded SPOTIFY_BASIC_TOKEN (base64 of client_id:client_secret)
 * or separate SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET env vars.
 */
async function getAccessToken({ force = false } = {}) {
  if (force) { cachedToken = null; tokenExpiry = 0; }
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  // Build the Basic auth string from whichever env vars are available
  let auth = process.env.SPOTIFY_BASIC_TOKEN;

  if (!auth) {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (clientId && clientSecret) {
      auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    }
  }

  if (!auth) {
    console.warn('[Spotify API] Missing credentials: set SPOTIFY_BASIC_TOKEN or both SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET');
    return null;
  }

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[Spotify API] Token request failed: ${res.status} — ${body}`);
      return null;
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);
    console.log('[Spotify API] Got access token, expires in', data.expires_in, 'seconds');
    return cachedToken;
  } catch (err) {
    console.error('[Spotify API] Token error:', err.message);
    return null;
  }
}

/**
 * Extract the Spotify track ID from a Spotify URL.
 * Handles both open.spotify.com and spotify: URI formats.
 *
 * @param {string} spotifyUrl
 * @returns {string|null} Track ID or null
 */
export function extractTrackId(spotifyUrl) {
  if (!spotifyUrl) return null;

  // Match open.spotify.com/track/{id} or /intl-xx/track/{id}
  const urlMatch = spotifyUrl.match(/spotify\.com\/(?:intl-[a-z]{2}\/)?track\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  // Match spotify:track:{id}
  const uriMatch = spotifyUrl.match(/spotify:track:([a-zA-Z0-9]+)/);
  if (uriMatch) return uriMatch[1];

  return null;
}

/**
 * Fetch track metadata from Spotify Web API.
 * Returns the ISRC, artist name, title, and other metadata.
 *
 * @param {string} spotifyUrl - Spotify track URL
 * @returns {Promise<{isrc: string, artist: string, title: string, album: string} | null>}
 */
// WHI-2392: track metadata rarely changes; without this a link with no Apple Music URL
// called Spotify on every view (twice, because metadata and page both resolve the link).
const TRACK_HIT_TTL_MS = 6 * 60 * 60 * 1000;
const TRACK_MISS_TTL_MS = 5 * 60 * 1000;
export const trackCache = createTtlCache({ max: 500 });

export async function fetchSpotifyTrackMeta(spotifyUrl) {
  const trackId = extractTrackId(spotifyUrl);
  if (!trackId) return null;
  return cached(trackCache, trackId, () => fetchTrackUncached(trackId),
    (v) => (v ? TRACK_HIT_TTL_MS : TRACK_MISS_TTL_MS));
}

/**
 * WHI-2392: a warm serverless instance can hold a token Spotify no longer accepts
 * (the cached copy outlives it), which showed as 401 on /drucker/wake-me-up while a
 * fresh token works. On 401 drop the cached token, get a new one and retry once.
 */
async function fetchTrackUncached(trackId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getAccessToken({ force: attempt > 0 });
    if (!token) return null;
    try {
      const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        cache: 'no-store',
      });
      if (res.status === 401 && attempt === 0) {
        console.warn('[Spotify API] Track fetch 401, refreshing token and retrying once');
        continue;
      }
      if (!res.ok) {
        console.warn(`[Spotify API] Track fetch failed: ${res.status}`);
        return null;
      }
      const data = await res.json();
      return {
        isrc: data.external_ids?.isrc || null,
        artist: data.artists?.[0]?.name || null,
        title: data.name || null,
        album: data.album?.name || null,
        albumId: data.album?.id || null,
      };
    } catch (err) {
      console.error('[Spotify API] Track fetch error:', err.message);
      return null;
    }
  }
  return null;
}
