/**
 * In-memory link store (for demo/dev).
 * In production, replace with a database (Vercel KV, Postgres, etc.)
 *
 * Each link has:
 * - slug: URL path (e.g., "tragedies")
 * - title: Song/release title
 * - artist: Artist name
 * - coverUrl: Cover art image URL (auto-fetched from Spotify oEmbed)
 * - spotifyUrl: Spotify link
 * - appleMusicUrl: (optional) Apple Music link
 * - soundcloudUrl: (optional) SoundCloud link
 * - genre: (optional) Genre string (used in CAPI custom_data for retargeting)
 * - subgenre: (optional) Subgenre string (used in CAPI custom_data for retargeting)
 * - fbPixelId: Facebook Pixel ID (falls back to env)
 * - fbAccessToken: Facebook CAPI access token (falls back to env)
 * - bgColor: (optional) Background color override
 */

// In-memory store - replace with DB in production
const links = new Map();

// Seed with example data (coverUrl will be resolved on first page load)
links.set('tragedies', {
  slug: 'tragedies',
  title: 'Tragedies',
  artist: 'Vex Verity',
  coverUrl: '', // Will be auto-fetched from Spotify oEmbed
  spotifyUrl: 'https://open.spotify.com/track/4DYYlTuhtc21yJBgUs3dNy?si=7f324a4ec0cc4052',
  genre: 'Electronica',
  fbPixelId: process.env.FB_PIXEL_ID || '507044563387858',
  fbAccessToken: process.env.FB_ACCESS_TOKEN || '',
});

export function getLink(slug) {
  return links.get(slug) || null;
}

export function updateLink(slug, updates) {
  const existing = links.get(slug);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  links.set(slug, updated);
  return updated;
}

export function createLink(data) {
  const link = {
    slug: data.slug,
    title: data.title,
    artist: data.artist,
    coverUrl: data.coverUrl || '',
    spotifyUrl: data.spotifyUrl,
    appleMusicUrl: data.appleMusicUrl || '',
    soundcloudUrl: data.soundcloudUrl || '',
    genre: data.genre || '',
    subgenre: data.subgenre || '',
    fbPixelId: data.fbPixelId || process.env.FB_PIXEL_ID || '507044563387858',
    fbAccessToken: data.fbAccessToken || process.env.FB_ACCESS_TOKEN || '',
    bgColor: data.bgColor || '',
    createdAt: new Date().toISOString(),
  };
  links.set(link.slug, link);
  return link;
}

export function getAllLinks() {
  return Array.from(links.values());
}
