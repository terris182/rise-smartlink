// lib/spotify-pages.js
// User-authorized Spotify OAuth for gudmuzik.com/pages. ISOLATED from the
// app-level client-credentials token (lib/spotify-api.js) and the curator
// refresh-token app (lib/spotify-curator.js). Uses its OWN Spotify app
// ("Gudmuzik") via env: SPOTIFY_PAGES_CLIENT_ID, SPOTIFY_PAGES_CLIENT_SECRET.
import crypto from 'crypto';

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

export const PAGES_SCOPES = [
  'ugc-image-upload',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-follow-modify',
  'user-follow-read',
  'user-read-playback-position',
  'user-top-read',
  'user-read-recently-played',
  'user-library-modify',
  'user-library-read',
  'user-read-email',
  'user-read-private',
];

export const COOKIES = {
  access: 'sp_access', refresh: 'sp_refresh', expiry: 'sp_expiry',
  pkce: 'sp_pkce', state: 'sp_state', ret: 'sp_return',
};

export function pagesConfigured() {
  return !!(process.env.SPOTIFY_PAGES_CLIENT_ID && process.env.SPOTIFY_PAGES_CLIENT_SECRET);
}
function basicAuth() {
  return Buffer.from(
    `${process.env.SPOTIFY_PAGES_CLIENT_ID}:${process.env.SPOTIFY_PAGES_CLIENT_SECRET}`
  ).toString('base64');
}
export function randomString(len = 64) {
  return crypto.randomBytes(96).toString('base64url').slice(0, len);
}
export function codeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
export function originFromRequest(req) {
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  return `${proto}://${host}`;
}
export function redirectUri(origin) { return `${origin}/pages`; }

export function buildAuthorizeUrl({ origin, state, verifier }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_PAGES_CLIENT_ID,
    scope: PAGES_SCOPES.join(' '),
    redirect_uri: redirectUri(origin),
    state,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge(verifier),
    show_dialog: 'true',
  });
  return `${ACCOUNTS}/authorize?${params.toString()}`;
}
export async function exchangeCode({ code, verifier, origin }) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code,
      redirect_uri: redirectUri(origin), code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} — ${await res.text()}`);
  return res.json();
}
export async function refreshAccessToken(refreshToken) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} — ${await res.text()}`);
  return res.json();
}

export function setAuthCookies(res, { access, refresh, expiry }) {
  const base = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };
  if (access) res.cookies.set(COOKIES.access, access, { ...base, maxAge: 3600 });
  if (refresh) res.cookies.set(COOKIES.refresh, refresh, { ...base, maxAge: 60 * 60 * 24 * 30 });
  if (expiry) res.cookies.set(COOKIES.expiry, String(expiry), { ...base, maxAge: 60 * 60 * 24 * 30 });
}
export function clearAuthCookies(res) {
  for (const k of [COOKIES.access, COOKIES.refresh, COOKIES.expiry]) {
    res.cookies.set(k, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  }
}
// Returns a valid access token (refreshing if needed) or null. Sets refreshed cookies on `res`.
export async function getValidAccessToken(req, res) {
  const access = req.cookies.get(COOKIES.access)?.value;
  const refresh = req.cookies.get(COOKIES.refresh)?.value;
  const expiry = Number(req.cookies.get(COOKIES.expiry)?.value || 0);
  if (access && Date.now() < expiry - 60000) return access;
  if (!refresh) return null;
  const data = await refreshAccessToken(refresh);
  const newExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  setAuthCookies(res, { access: data.access_token, refresh: data.refresh_token || refresh, expiry: newExpiry });
  return data.access_token;
}
export async function spotifyFetch(accessToken, path, { method = 'GET', json, raw, contentType } = {}) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (raw !== undefined) { if (contentType) headers['Content-Type'] = contentType; body = raw; }
  return fetch(`${API}${path}`, { method, headers, body });
}
