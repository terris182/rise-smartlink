/**
 * Smart song suggestions for the five fan page playlists (WHI-1335).
 *
 * Per page, three source groups, in this order on the page:
 *   1. viral:     Spotify's viral/internet playlists (Viral Hits, big on the
 *                 internet), filtered to the page's genres via artist genres.
 *                 Labelled "Viral now" with the playlist name. Note: TikTok
 *                 shut its public Creative Center song chart and the Billboard
 *                 TikTok Top 50 was discontinued (2025), so this is the
 *                 closest live signal we can read without a paid data vendor.
 *   2. editorial: Spotify-owned editorial playlists that match the genre.
 *   3. sounds:    "The Sound of <genre>" playlists by thesoundsofspotify
 *                 (Every Noise at Once), the genre's core tracks.
 *
 * Playlist ids were resolved live on 2026-09-20 via /search with an owner
 * check (spotify / thesoundsofspotify). If one 404s it is skipped, not fatal.
 * Results are cached per key in Supabase (fanpage_suggestions) for 24h.
 */
import { createClient } from '@supabase/supabase-js';
import { spotifyCallForKey } from './fanpages';

const API = 'https://api.spotify.com/v1';
const TABLE = 'fanpage_suggestions';
const TTL_MS = 24 * 60 * 60 * 1000;

const VIRAL_PLAYLISTS = [
  { name: 'Viral Hits', id: '37i9dQZF1DX2L0iB23Enbq' },
  { name: 'big on the internet', id: '37i9dQZF1DX5Vy6DFOcx00' },
];

export const SUGGESTION_CONFIG = {
  rnbrapradio: {
    genres: ['r&b', 'rnb', 'rap', 'hip hop', 'hip-hop', 'trap', 'drill', 'soul'],
    editorial: [
      { name: 'RapCaviar', id: '37i9dQZF1DX0XUsuxWHRQd' },
      { name: 'RNB X', id: '37i9dQZF1DX4SBhb3fqCJd' },
      { name: 'Most Necessary', id: '37i9dQZF1DX2RxBh64BHjQ' },
      { name: 'R&B Rising', id: '37i9dQZF1DWUbo613Z2iWO' },
      { name: 'Fresh Finds Hip-Hop', id: '37i9dQZF1DWW4igXXl2Qkp' },
      { name: 'Fresh Finds R&B', id: '37i9dQZF1DWUFAJPVM3HTX' },
    ],
    sounds: [
      { name: 'The Sound of R&B', id: '1rLnwJimWCmjp3f0mEbnkY' },
      { name: 'The Sound of Hip Hop', id: '6MXkE0uYF4XwU4VTtyrpfP' },
      { name: 'The Sound of Rap', id: '6s5MoZzR70Qef7x4bVxDO1' },
      { name: 'The Sound of Trap', id: '60SHtDyagDjPnUpC7x1UD9' },
      { name: 'The Sound of Melodic Rap', id: '2V9SF7DMoOLEvxGVGT4uuU' },
      { name: 'The Sound of Alternative R&B', id: '0Hwb2a9DJdom4yoe5V41K9' },
    ],
  },
  frontporchsounds: {
    genres: ['country', 'folk', 'americana', 'bluegrass', 'singer-songwriter', 'stomp and holler'],
    editorial: [
      { name: 'Hot Country', id: '37i9dQZF1DX1lVhptIYRda' },
      { name: 'New Boots', id: '37i9dQZF1DX8S0uQvJ4gaa' },
      { name: 'Fresh Folk', id: '37i9dQZF1DXaUDcU6KDCj4' },
      { name: 'Indigo', id: '37i9dQZF1DWUgBy0IJPlHq' },
      { name: 'Fresh Finds Country', id: '37i9dQZF1DWYUfsq4hxHWP' },
      { name: 'Fresh Finds Folk', id: '37i9dQZF1DXdS3lvGe1GrT' },
    ],
    sounds: [
      { name: 'The Sound of Contemporary Country', id: '0VZfpqcbBUWC6kpP1vVrvA' },
      { name: 'The Sound of Modern Country Pop', id: '1AmdZJ5lBBbe6SX1MyAst9' },
      { name: 'The Sound of Indie Folk', id: '5Z5KHMrb3bNWGOZJ6y8gsL' },
      { name: 'The Sound of New Americana', id: '7uSlfH4blWi70SZAtqAWbe' },
      { name: 'The Sound of Stomp and Holler', id: '3zVZ3GsfiYp0vlVazHcDXI' },
      { name: 'The Sound of Folk Rock', id: '0TTsY3zQAYz6NppoHDR5MA' },
    ],
  },
  risemusicfinds: {
    genres: [], // broad: new and rising across pop, indie and hip hop; viral rows are not genre-filtered
    editorial: [
      { name: 'Fresh Finds', id: '37i9dQZF1DWWjGdmeTyeJ6' },
      { name: 'Fresh Finds Pop', id: '37i9dQZF1DX3u9TSHqpdJC' },
      { name: 'Fresh Finds Indie', id: '37i9dQZF1DWT0upuUFtT7o' },
      { name: 'Fresh Finds Hip-Hop', id: '37i9dQZF1DWW4igXXl2Qkp' },
      { name: 'New Music Friday', id: '37i9dQZF1DX4JAvHpjipBk' },
      { name: 'All New Indie', id: '37i9dQZF1DXdbXrPNafg9d' },
    ],
    sounds: [
      { name: 'The Sound of Indie Pop', id: '1aYiM4zLmBuFq0Fg6NQb6a' },
      { name: 'The Sound of Modern Indie Pop', id: '0FkLYgMF09lmzytexAraKv' },
      { name: 'The Sound of Bedroom Pop', id: '339zjWDksACL7sNs2UehlX' },
      { name: 'The Sound of Alt Z', id: '6TySxsLwRVYqEh7LZ6fyq8' },
      { name: 'The Sound of Pop', id: '6gS3HhOiI17QNojjPuPzqc' },
    ],
  },
  altsceneradio: {
    genres: ['alternative', 'indie rock', 'pop punk', 'emo', 'rock', 'shoegaze', 'grunge', 'punk', 'garage', 'post-punk', 'midwest'],
    editorial: [
      { name: 'ALT NOW', id: '37i9dQZF1DWVqJMsgEN0F4' },
      { name: 'the new alt', id: '37i9dQZF1DX82GYcclJ3Ug' },
      { name: 'New Noise', id: '37i9dQZF1DWT2jS7NwYPVI' },
      { name: "Pop Punk's Not Dead", id: '37i9dQZF1DX1ewVhAJ17m4' },
      { name: 'Fresh Finds Rock', id: '37i9dQZF1DX78toxP7mOaJ' },
      { name: 'All New Rock', id: '37i9dQZF1DWZryfp6NSvtz' },
    ],
    sounds: [
      { name: 'The Sound of Alternative Rock', id: '3dlw4x21qVajwZLPNHtS3u' },
      { name: 'The Sound of Modern Alternative Rock', id: '3PMlHfN3H3GmOcTgEcGwJT' },
      { name: 'The Sound of Indie Rock', id: '4XXr357Jej7eUBh7XPK8hb' },
      { name: 'The Sound of Pop Punk', id: '5prkai2xWcnqLxwORZSYbN' },
      { name: 'The Sound of Emo', id: '4eC7Sa1Xcy33lKn53gfiZb' },
      { name: 'The Sound of 5th Wave Emo', id: '5jJRdxN4pD29Uhj0ZIRFPf' },
    ],
  },
  chillbeatsradio: {
    genres: ['lo-fi', 'lofi', 'chill', 'electronic', 'edm', 'house', 'hyperpop', 'dance', 'techno', 'electro', 'chillwave', 'synth', 'dubstep', 'trance', 'drum and bass', 'garage'],
    editorial: [
      { name: 'mint', id: '37i9dQZF1DX4dyzvuaRJ0n' },
      { name: 'Dance Hits', id: '37i9dQZF1DX0BcQWzuB7ZO' },
      { name: 'Electronic Rising', id: '37i9dQZF1DX8AliSIsGeKd' },
      { name: 'hyperpop', id: '37i9dQZF1DX7HOk71GPfSw' },
      { name: 'Housewerk', id: '37i9dQZF1DXa8NOEUWPn9W' },
      { name: 'lofi beats', id: '37i9dQZF1DWWQRwui0ExPn' },
      { name: 'Chill Hits', id: '37i9dQZF1DX4WYpdgoIcn6' },
    ],
    sounds: [
      { name: 'The Sound of EDM', id: '3pDxuMpz94eDs7WFqudTbZ' },
      { name: 'The Sound of Electronica', id: '6I0NsYzfoj7yHXyvkZYoRx' },
      { name: 'The Sound of House', id: '6AzCASXpbvX5o3F8yaj1y0' },
      { name: 'The Sound of Hyperpop', id: '7DrJ92Lc9UaVB1rKM2UGsg' },
      { name: 'The Sound of Dance Pop', id: '2ZIRxkFuqNPMnlY7vL54uK' },
      { name: 'The Sound of Lo-Fi Beats', id: '5OzAgYmdiqJKWjGvX7cP4Q' },
      { name: 'The Sound of Chillwave', id: '5pDD5tz9aQULzowpuKMSep' },
    ],
  },
};

// Viral rows whose artist genre is a non-English-market scene are dropped
// for every page (these five pages post to a US audience).
const EXCLUDE_GENRES = ['latin', 'reggaeton', 'urbano', 'german', 'deutsch', 'french', 'italian', 'spanish', 'k-pop', 'j-pop', 'turkish', 'arab', 'brazil', 'sertanejo', 'funk carioca', 'corrido', 'regional mexican', 'polish', 'russian', 'bollywood', 'punjabi', 'desi'];

const PER_PLAYLIST = { viral: 100, editorial: 12, sounds: 12 };
const VIRAL_KEEP = 15;

const supabaseUrl = process.env.SUPABASE_CURATOR_URL;
const supabaseKey = process.env.SUPABASE_CURATOR_SERVICE_ROLE_KEY;
let _client = null;
function getClient() {
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_CURATOR_URL / SUPABASE_CURATOR_SERVICE_ROLE_KEY missing');
  if (!_client) {
    _client = createClient(supabaseUrl, supabaseKey, {
      global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    });
  }
  return _client;
}

function shape(item) {
  const t = item?.track;
  if (!t || !t.id || t.type === 'episode') return null;
  return {
    uri: t.uri,
    id: t.id,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).join(', '),
    artistIds: (t.artists || []).map((a) => a.id).filter(Boolean),
    album: t.album?.name || '',
    cover: t.album?.images?.[t.album.images.length - 1]?.url || null,
    popularity: t.popularity ?? null,
    previewUrl: t.preview_url || null,
    url: t.external_urls?.spotify || null,
  };
}

async function playlistTracks(key, playlistId, limit) {
  const out = [];
  let path = `/playlists/${playlistId}/items?limit=50&fields=items(track(id,uri,name,type,popularity,preview_url,external_urls,artists(id,name),album(name,images))),next`;
  try {
    while (path && out.length < limit) {
      const page = await spotifyCallForKey(key, 'GET', path);
      for (const item of page.items || []) {
        const t = shape(item);
        if (t) out.push(t);
        if (out.length >= limit) break;
      }
      path = page.next ? page.next.replace(API, '') : null;
    }
  } catch (err) {
    // A playlist that moved or 404s must not sink the whole build.
    return { tracks: out, error: err.message };
  }
  return { tracks: out, error: null };
}

async function artistGenres(key, artistIds) {
  const map = new Map();
  const ids = Array.from(new Set(artistIds)).filter(Boolean);
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const page = await spotifyCallForKey(key, 'GET', `/artists?ids=${ids.slice(i, i + 50).join(',')}`);
      for (const a of page.artists || []) if (a) map.set(a.id, a.genres || []);
    } catch {
      // leave unknown
    }
  }
  return map;
}

function matchesGenre(genres, keywords) {
  const g = genres.map((x) => x.toLowerCase());
  if (g.some((x) => EXCLUDE_GENRES.some((k) => x.includes(k)))) return false;
  if (!keywords.length) return true;
  return g.some((x) => keywords.some((k) => x.includes(k)));
}

export async function buildSuggestions(key) {
  const cfg = SUGGESTION_CONFIG[key];
  if (!cfg) throw new Error(`No suggestion config for ${key}`);
  const seen = new Set();
  const sections = [];
  const errors = [];

  // 1. viral, genre-filtered
  const viralRows = [];
  for (const pl of VIRAL_PLAYLISTS) {
    const { tracks, error } = await playlistTracks(key, pl.id, PER_PLAYLIST.viral);
    if (error) errors.push(`${pl.name}: ${error}`);
    tracks.forEach((t, i) => viralRows.push({ ...t, sourceName: pl.name, rank: i + 1 }));
  }
  const genreMap = await artistGenres(key, viralRows.flatMap((t) => t.artistIds));
  const viral = [];
  for (const t of viralRows) {
    if (seen.has(t.id)) continue;
    const genres = t.artistIds.flatMap((id) => genreMap.get(id) || []);
    if (!matchesGenre(genres, cfg.genres)) continue;
    seen.add(t.id);
    viral.push({ ...t, genres: Array.from(new Set(genres)).slice(0, 4) });
    if (viral.length >= VIRAL_KEEP) break;
  }
  sections.push({
    group: 'viral',
    title: 'Viral now',
    subtitle: cfg.genres.length
      ? "Spotify's Viral Hits and big on the internet, kept only where the artist's genre matches this page"
      : "Spotify's Viral Hits and big on the internet",
    tracks: viral.map(({ artistIds, ...t }) => t),
  });

  // 2. editorial
  for (const pl of cfg.editorial) {
    const { tracks, error } = await playlistTracks(key, pl.id, PER_PLAYLIST.editorial);
    if (error) errors.push(`${pl.name}: ${error}`);
    const rows = [];
    for (const t of tracks) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      rows.push({ ...t, sourceName: pl.name });
    }
    if (rows.length) {
      sections.push({
        group: 'editorial',
        title: pl.name,
        subtitle: 'Spotify editorial playlist',
        playlistId: pl.id,
        tracks: rows.map(({ artistIds, ...t }) => t),
      });
    }
  }

  // 3. The Sound of X
  for (const pl of cfg.sounds) {
    const { tracks, error } = await playlistTracks(key, pl.id, PER_PLAYLIST.sounds);
    if (error) errors.push(`${pl.name}: ${error}`);
    const rows = [];
    for (const t of tracks) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      rows.push({ ...t, sourceName: pl.name });
    }
    if (rows.length) {
      sections.push({
        group: 'sounds',
        title: pl.name,
        subtitle: 'The Sounds of Spotify (Every Noise at Once) genre playlist',
        playlistId: pl.id,
        tracks: rows.map(({ artistIds, ...t }) => t),
      });
    }
  }

  return {
    key,
    builtAt: new Date().toISOString(),
    genres: cfg.genres,
    sections,
    errors,
  };
}

export async function getSuggestions(key, { refresh = false } = {}) {
  const client = getClient();
  if (!refresh) {
    const { data } = await client.from(TABLE).select('payload, refreshed_at').eq('key', key).maybeSingle();
    if (data && data.payload && Date.now() - new Date(data.refreshed_at).getTime() < TTL_MS) {
      return { ...data.payload, cached: true, refreshedAt: data.refreshed_at };
    }
  }
  const payload = await buildSuggestions(key);
  const refreshedAt = new Date().toISOString();
  const { error } = await client.from(TABLE).upsert({ key, payload, refreshed_at: refreshedAt }, { onConflict: 'key' });
  if (error) payload.errors.push(`cache write failed: ${error.message}`);
  return { ...payload, cached: false, refreshedAt };
}
