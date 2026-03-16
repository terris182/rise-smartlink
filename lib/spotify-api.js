/**
 * Spotify Web API helper (client credentials flow).
 * Used to fetch track metadata including ISRC codes, which are needed
 * for cross-platform resolution when Songlink doesn't have Apple Music.
 *
 * This does NOT require user authentication — it uses the client_credentials
 * grant type which only needs a client_id and client_secret.
 *
 * Environment variables:
 * - SPOTIFY_CLIENT_ID
 * - SPOTIFY_CLIENT_SECRET
 */

let cachedToken = null;
let tokenExpiry = 0;

/**
 * Get a Spotify access token using client credentials flow.
 * Caches the token until it expires.
 */
async function getAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('[Spotify API] Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET');
    return null;
  }

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
      console.error(`[Spotify API] Token request failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000);
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
export async function fetchSpotifyTrackMeta(spotifyUrl) {
  const trackId = extractTrackId(spotifyUrl);
  if (!trackId) return null;

  const token = await getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

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
