/**
 * Smart link persistent store using Vercel KV (Redis).
 * Falls back to in-memory Map when KV is not configured (local dev).
 *
 * Each link has:
 * - slug: URL path (e.g., "vex-verity/tragedies")
 * - title: Song/release title
 * - artist: Artist name
 * - coverUrl: Cover art image URL (auto-fetched from Spotify oEmbed)
 * - spotifyUrl: Spotify link
 * - appleMusicUrl: (optional) Apple Music link
 * - genre: (optional) Genre string (used in CAPI custom_data for retargeting)
 * - subgenre: (optional) Subgenre string (used in CAPI custom_data for retargeting)
 * - fbPixelId: Facebook Pixel ID (falls back to env)
 * - fbAccessToken: Facebook CAPI access token (falls back to env)
 * - bgColor: (optional) Background color override
 * - presave: (optional) Enable pre-save mode
 * - presaveReleaseDate: (optional) Release date for pre-save (YYYY-MM-DD)
 * - presaveReleaseTime: (optional) Release time for pre-save (HH:MM, Eastern Time)
 * - spotifyArtistId: (optional) Spotify artist ID for pre-save
 * - spotifyTrackUri: (optional) Spotify track URI for pre-save
 * - contestEnabled: (optional) Enable contest/giveaway
 * - contestUrl: (optional) Contest URL redirect
 * - contestPrizeText: (optional) Prize text for contest banner
 * - createdAt: ISO date string
 */

import { kv } from '@vercel/kv';

// Key prefix for all smart links in KV
const PREFIX = 'link:';

// Check if KV is configured (has the required env vars)
const kvAvailable = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// In-memory fallback for local dev
const memStore = new Map();

// Seed data for local dev fallback
if (!kvAvailable) {
  memStore.set('tragedies', {
    slug: 'tragedies',
    title: 'Tragedies',
    artist: 'Vex Verity',
    coverUrl: '',
    spotifyUrl: 'https://open.spotify.com/track/4DYYlTuhtc21yJBgUs3dNy?si=7f324a4ec0cc4052',
    genre: 'Electronica',
    fbPixelId: process.env.FB_PIXEL_ID || '507044563387858',
    fbAccessToken: process.env.FB_ACCESS_TOKEN || '',
  });
}

/**
 * Get a link by slug.
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getLink(slug) {
  if (!kvAvailable) return memStore.get(slug) || null;

  try {
    const link = await kv.get(`${PREFIX}${slug}`);
    return link || null;
  } catch (err) {
    console.error('[links] KV get error:', err);
    return null;
  }
}

/**
 * Update a link by slug (partial update).
 * @param {string} slug
 * @param {object} updates
 * @returns {Promise<object|null>}
 */
export async function updateLink(slug, updates) {
  if (!kvAvailable) {
    const existing = memStore.get(slug);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    memStore.set(slug, updated);
    return updated;
  }

  try {
    const existing = await kv.get(`${PREFIX}${slug}`);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    await kv.set(`${PREFIX}${slug}`, updated);
    return updated;
  } catch (err) {
    console.error('[links] KV update error:', err);
    return null;
  }
}

/**
 * Create a new link.
 * @param {object} data
 * @returns {Promise<object>}
 */
export async function createLink(data) {
  const link = {
    slug: data.slug,
    title: data.title,
    artist: data.artist,
    coverUrl: data.coverUrl || '',
    spotifyUrl: data.spotifyUrl,
    appleMusicUrl: data.appleMusicUrl || '',
    genre: data.genre || '',
    subgenre: data.subgenre || '',
    fbPixelId: data.fbPixelId || process.env.FB_PIXEL_ID || '507044563387858',
    fbAccessToken: data.fbAccessToken || process.env.FB_ACCESS_TOKEN || '',
    bgColor: data.bgColor || '',
    // Pre-save fields
    presave: data.presave || false,
    presaveReleaseDate: data.presaveReleaseDate || '',
    presaveReleaseTime: data.presaveReleaseTime || '',
    spotifyArtistId: data.spotifyArtistId || '',
    spotifyTrackUri: data.spotifyTrackUri || '',
    // Contest fields
    contestEnabled: data.contestEnabled || false,
    contestUrl: data.contestUrl || '',
    contestPrizeText: data.contestPrizeText || '',
    createdAt: new Date().toISOString(),
  };

  if (!kvAvailable) {
    memStore.set(link.slug, link);
    return link;
  }

  try {
    await kv.set(`${PREFIX}${link.slug}`, link);
    return link;
  } catch (err) {
    console.error('[links] KV create error:', err);
    throw err;
  }
}

/**
 * Get all links (for admin/debug).
 * @returns {Promise<object[]>}
 */
export async function getAllLinks() {
  if (!kvAvailable) return Array.from(memStore.values());

  try {
    const keys = await kv.keys(`${PREFIX}*`);
    if (keys.length === 0) return [];
    const links = await Promise.all(keys.map((key) => kv.get(key)));
    return links.filter(Boolean);
  } catch (err) {
    console.error('[links] KV getAll error:', err);
    return [];
  }
}
