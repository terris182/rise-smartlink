import { NextResponse } from 'next/server';
import { getValidAccessToken, spotifyFetch } from '@/lib/spotify-pages';

export const dynamic = 'force-dynamic';

function copyRefreshedCookies(src, dest) {
  src.cookies.getAll().forEach((c) => dest.cookies.set(c));
}

async function safeJson(res) {
  try { return await res.json(); } catch { return {}; }
}

export async function POST(req) {
  const tmp = new NextResponse();
  const token = await getValidAccessToken(req, tmp);
  if (!token) {
    const out = NextResponse.json({ error: 'not_authed' }, { status: 401 });
    copyRefreshedCookies(tmp, out);
    return out;
  }

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const { action, ...params } = body;

  let result;
  try {
    switch (action) {
      case 'is_following': {
        const r = await spotifyFetch(token, `/me/following/contains?type=artist&ids=${params.artistId}`);
        const arr = await r.json();
        result = { following: arr[0] };
        break;
      }
      case 'follow_artist': {
        const r = await spotifyFetch(token, `/me/following?type=artist&ids=${params.artistId}`, { method: 'PUT' });
        result = { ok: r.ok };
        break;
      }
      case 'unfollow_artist': {
        const r = await spotifyFetch(token, `/me/following?type=artist&ids=${params.artistId}`, { method: 'DELETE' });
        result = { ok: r.ok };
        break;
      }
      case 'is_saved': {
        const r = await spotifyFetch(token, `/me/tracks/contains?ids=${params.trackId}`);
        const arr = await r.json();
        result = { saved: arr[0] };
        break;
      }
      case 'save_track': {
        const r = await spotifyFetch(token, `/me/tracks?ids=${params.trackId}`, { method: 'PUT' });
        result = { ok: r.ok };
        break;
      }
      case 'remove_saved': {
        const r = await spotifyFetch(token, `/me/tracks?ids=${params.trackId}`, { method: 'DELETE' });
        result = { ok: r.ok };
        break;
      }
      case 'my_playlists': {
        const meRes = await spotifyFetch(token, '/me');
        const me = await meRes.json();
        const userId = me.id;
        const r = await spotifyFetch(token, '/me/playlists?limit=50');
        const data = await r.json();
        const playlists = (data.items || [])
          .filter((p) => p.owner?.id === userId || p.collaborative)
          .map((p) => ({
            id: p.id,
            name: p.name,
            image: p.images?.[0]?.url || null,
            collaborative: p.collaborative,
            owner: p.owner?.id,
          }));
        result = { playlists, userId };
        break;
      }
      case 'add_to_playlist': {
        const r = await spotifyFetch(token, `/playlists/${params.playlistId}/tracks`, {
          method: 'POST',
          json: { uris: [params.uri] },
        });
        const data = await r.json();
        result = { ok: r.ok, snapshot_id: data.snapshot_id };
        break;
      }
      case 'create_playlist': {
        const r = await spotifyFetch(token, `/users/${params.userId}/playlists`, {
          method: 'POST',
          json: { name: params.name, public: !!params.isPublic, description: params.description || '' },
        });
        const data = await r.json();
        result = { id: data.id, name: data.name, external_url: data.external_urls?.spotify };
        break;
      }
      case 'upload_cover': {
        const r = await spotifyFetch(token, `/playlists/${params.playlistId}/images`, {
          method: 'PUT',
          raw: params.imageBase64,
          contentType: 'image/jpeg',
        });
        result = { ok: r.ok, status: r.status };
        break;
      }
      case 'top': {
        const type = params.type === 'tracks' ? 'tracks' : 'artists';
        const r = await spotifyFetch(token, `/me/top/${type}?limit=10&time_range=medium_term`);
        const data = await r.json();
        result = { items: data.items };
        break;
      }
      case 'recently_played': {
        const r = await spotifyFetch(token, '/me/player/recently-played?limit=10');
        const data = await r.json();
        result = { items: data.items };
        break;
      }
      case 'now_playing': {
        const r = await spotifyFetch(token, '/me/player/currently-playing');
        if (r.status === 204) { result = { playing: false }; break; }
        const data = await safeJson(r);
        result = { playing: true, item: data.item, progress_ms: data.progress_ms, is_playing: data.is_playing };
        break;
      }
      case 'playback_state': {
        const r = await spotifyFetch(token, '/me/player');
        if (r.status === 204) { result = { active: false }; break; }
        const data = await safeJson(r);
        result = { active: true, device: data.device, is_playing: data.is_playing };
        break;
      }
      case 'transfer': {
        const r = await spotifyFetch(token, '/me/player', {
          method: 'PUT',
          json: { device_ids: [params.deviceId], play: false },
        });
        result = { ok: r.ok };
        break;
      }
      case 'play': {
        const qs = params.deviceId ? `?device_id=${params.deviceId}` : '';
        const r = await spotifyFetch(token, `/me/player/play${qs}`, {
          method: 'PUT',
          json: { uris: params.uris, position_ms: params.position_ms || 0 },
        });
        result = { ok: r.ok };
        break;
      }
      case 'pause': {
        const r = await spotifyFetch(token, '/me/player/pause', { method: 'PUT' });
        result = { ok: r.ok };
        break;
      }
      case 'next': {
        const r = await spotifyFetch(token, '/me/player/next', { method: 'POST' });
        result = { ok: r.ok };
        break;
      }
      case 'previous': {
        const r = await spotifyFetch(token, '/me/player/previous', { method: 'POST' });
        result = { ok: r.ok };
        break;
      }
      case 'seek': {
        const r = await spotifyFetch(token, `/me/player/seek?position_ms=${params.position_ms}`, { method: 'PUT' });
        result = { ok: r.ok };
        break;
      }
      case 'volume': {
        const r = await spotifyFetch(token, `/me/player/volume?volume_percent=${params.percent}`, { method: 'PUT' });
        result = { ok: r.ok };
        break;
      }
      case 'episode': {
        const r = await spotifyFetch(token, `/episodes/${params.episodeId}?market=from_token`);
        const data = await r.json();
        result = { resume_point: data.resume_point, name: data.name, duration_ms: data.duration_ms };
        break;
      }
      default:
        result = { error: `unknown_action: ${action}` };
    }
  } catch (e) {
    result = { error: String(e.message || e) };
  }

  const out = NextResponse.json(result);
  copyRefreshedCookies(tmp, out);
  return out;
}
