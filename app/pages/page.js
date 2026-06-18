import { fetchSpotifyTrackMeta, extractTrackId } from '@/lib/spotify-api';
import PagesClient from './PagesClient';

export const dynamic = 'force-dynamic';

function parseSpotifyUrl(u) {
  if (!u) return null;
  try {
    const urlMatch = u.match(/spotify\.com\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(track|artist|album|playlist)\/([a-zA-Z0-9]+)/);
    if (urlMatch) return { type: urlMatch[1], id: urlMatch[2] };
    const uriMatch = u.match(/spotify:(track|artist|album|playlist):([a-zA-Z0-9]+)/);
    if (uriMatch) return { type: uriMatch[1], id: uriMatch[2] };
  } catch {}
  return null;
}

async function getClientCredToken() {
  let auth = process.env.SPOTIFY_BASIC_TOKEN;
  if (!auth && process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  }
  if (!auth) return null;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    next: { revalidate: 3000 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

export default async function PagesPage({ searchParams }) {
  const u = searchParams?.u || null;
  let trackId = null, trackUri = null, title = null, artistName = null;
  let artistId = null, coverUrl = null;

  if (u) {
    const parsed = parseSpotifyUrl(u);
    if (parsed?.type === 'track') {
      trackId = parsed.id;
      trackUri = `spotify:track:${trackId}`;
      try {
        const token = await getClientCredToken();
        if (token) {
          const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
            headers: { Authorization: `Bearer ${token}` },
            next: { revalidate: 3600 },
          });
          if (res.ok) {
            const td = await res.json();
            title = td.name || null;
            artistName = td.artists?.[0]?.name || null;
            artistId = td.artists?.[0]?.id || null;
            coverUrl = td.album?.images?.[0]?.url || null;
          }
        }
        if (!title) {
          const meta = await fetchSpotifyTrackMeta(u);
          if (meta) { title = meta.title; artistName = meta.artist; }
        }
      } catch (e) {
        console.error('[pages] metadata fetch error', e.message);
      }
    }
  }

  return (
    <PagesClient
      trackId={trackId}
      trackUri={trackUri}
      title={title}
      artistName={artistName}
      artistId={artistId}
      coverUrl={coverUrl}
      rawU={u}
    />
  );
}
