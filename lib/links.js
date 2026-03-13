/**
 * In-memory link store (for demo/dev).
 * In production, replace with a database (Vercel KV, Postgres, etc.)
 *
 * Each link has:
 * - slug: URL path (e.g., "tragedies")
 * - title: Song/release title
 * - artist: Artist name
 * - coverUrl: Cover art image URL
 * - spotifyUrl: Spotify link
 * - appleMusicUrl: (optional) Apple Music link
 * - soundcloudUrl: (optional) SoundCloud link
 * - genre: (optional) Genre string
 * - fbPixelId: Facebook Pixel ID (falls back to env)
 * - fbAccessToken: Facebook CAPI access token (falls back to env)
 * - bgColor: (optional) Background color override
 */

// In-memory store - replace with DB in production
const links = new Map();

// Seed with example data
links.set('tragedies', {
  slug: 'tragedies',
  title: 'Tragedies',
  artist: 'Vex Verity',
  coverUrl: 'https://i.scdn.co/image/ab67616d0000b273a6b0e3b1ccb7e67c2e37d8c4',
  spotifyUrl: 'https://open.spotify.com/track/4DYYlTuhtc21yJBgUs3dNy?si=7f324a4ec0cc4052',
  genre: 'Electronica',
  fbPixelId: process.env.FB_PIXEL_ID || '',
  fbAccessToken: process.env.FB_ACCESS_TOKEN || '',
});

export function getLink(slug) {
  return links.get(slug) || null;
}

export function createLink(data) {
  const link = {
    slug: data.slug,
    title: data.title,
    artist: data.artist,
    coverUrl: data.coverUrl,
    spotifyUrl: data.spotifyUrl,
    appleMusicUrl: data.appleMusicUrl || '',
    soundcloudUrl: data.soundcloudUrl || '',
    genre: data.genre || '',
    fbPixelId: data.fbPixelId || process.env.FB_PIXEL_ID || '',
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
