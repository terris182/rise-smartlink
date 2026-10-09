// In-memory fake of the Spotify Web API endpoints the curator uses.
// Installs itself as globalThis.fetch; any request to a host other than the
// fake Spotify hosts throws, so a test can never reach the real API.
const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

export function trackId(n) {
  // 22-char base62 id, deterministic per name
  return (n.replace(/[^A-Za-z0-9]/g, '') + 'x'.repeat(22)).slice(0, 22);
}
export const uri = (n) => `spotify:track:${trackId(n)}`;

export function trackItem(n, { addedAt = '2020-01-01T00:00:00Z' } = {}) {
  return { is_local: false, added_at: addedAt, track: { id: trackId(n), uri: uri(n), name: n, type: 'track' } };
}
export const nullItem = () => ({ is_local: false, added_at: null, track: null });
export const localItem = (n) => ({ is_local: true, added_at: null, track: { id: null, uri: `spotify:local:${n}`, name: n, type: 'track' } });
export const episodeItem = (n) => ({ is_local: false, added_at: null, track: { id: trackId(n), uri: `spotify:episode:${trackId(n)}`, name: n, type: 'episode' } });

export class FakeSpotify {
  constructor() {
    this.playlists = new Map(); // id -> { items, snap }
    this.energy = new Map(); // trackId -> energy
    this.names = new Map(); // trackId -> name
    this.log = []; // every request { method, path, body }
    this.mutations = []; // non-GET requests to playlist endpoints
    this.moveSnapshots = []; // [{ sent, returned }] for reorder PUTs
    this.dropMoves = false; // when true, move PUTs return 200 but do nothing
    this.onRequest = null; // async hook(req) before each request is handled
    this.realFetch = globalThis.fetch;
  }

  install() {
    globalThis.fetch = (input, init) => this.handle(String(input), init || {});
    return this;
  }
  uninstall() {
    globalThis.fetch = this.realFetch;
  }

  setPlaylist(id, items) {
    this.playlists.set(id, { items: items.map((x) => structuredClone(x)), snap: 1 });
    for (const it of items) if (it.track?.id) this.names.set(it.track.id, it.track.name);
  }
  setEnergy(name, e) {
    this.energy.set(trackId(name), e);
    this.names.set(trackId(name), name);
  }
  items(id) {
    return this.playlists.get(id).items;
  }
  uris(id) {
    return this.items(id).map((it) => (it.track && it.track.uri) || null);
  }
  playableUris(id) {
    return this.items(id)
      .filter((it) => it.track && !it.is_local && it.track.type === 'track' && it.track.id)
      .map((it) => it.track.uri);
  }
  bump(p) {
    p.snap += 1;
    return `snap-${p.snap}`;
  }

  async handle(url, init) {
    const method = (init.method || 'GET').toUpperCase();
    if (url === TOKEN_URL) return json({ access_token: 'fake-token', expires_in: 3600 });
    if (!url.startsWith(API)) throw new Error(`FakeSpotify: refusing non-fake request to ${url}`);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const u = new URL(url);
    const path = u.pathname.replace('/v1', '');
    const req = { method, path, body, url };
    this.log.push(req);
    if (this.onRequest) await this.onRequest(req, this);

    let m;
    if ((m = path.match(/^\/playlists\/([^/]+)\/tracks$/))) {
      const p = this.playlists.get(m[1]);
      if (!p) return json({ error: 'not found' }, 404);
      if (method === 'GET') {
        const offset = parseInt(u.searchParams.get('offset') || '0', 10);
        const limit = parseInt(u.searchParams.get('limit') || '100', 10);
        const page = p.items.slice(offset, offset + limit);
        let next = null;
        if (offset + limit < p.items.length) {
          const n = new URL(url);
          n.searchParams.set('offset', String(offset + limit));
          next = n.toString();
        }
        return json({ items: structuredClone(page), next });
      }
      this.mutations.push(req);
      if (method === 'POST') {
        for (const x of body.uris) p.items.push(itemFor(x, this.names));
        return json({ snapshot_id: this.bump(p) }, 201);
      }
      if (method === 'DELETE') {
        const drop = new Set(body.tracks.map((t) => t.uri));
        p.items = p.items.filter((it) => !(it.track && drop.has(it.track.uri)));
        return json({ snapshot_id: this.bump(p) });
      }
      if (method === 'PUT' && body.uris) {
        p.items = body.uris.map((x) => itemFor(x, this.names));
        return json({ snapshot_id: this.bump(p) }, 201);
      }
      if (method === 'PUT' && body.range_start != null) {
        const { range_start: s, insert_before: b, range_length: len = 1 } = body;
        if (s < 0 || s + len > p.items.length || b < 0 || b > p.items.length) return json({ error: 'bad range' }, 400);
        if (!this.dropMoves) {
          const moved = p.items.splice(s, len);
          const at = b > s ? b - len : b;
          p.items.splice(at, 0, ...moved);
        }
        const returned = this.bump(p);
        this.moveSnapshots.push({ sent: body.snapshot_id, returned });
        return json({ snapshot_id: returned });
      }
    }
    if ((m = path.match(/^\/playlists\/([^/]+)$/)) && method === 'GET') {
      const p = this.playlists.get(m[1]);
      if (!p) return json({ error: 'not found' }, 404);
      return json({ id: m[1], name: m[1], snapshot_id: `snap-${p.snap}`, tracks: { total: p.items.length } });
    }
    if (path === '/audio-features' && method === 'GET') {
      const ids = (u.searchParams.get('ids') || '').split(',').filter(Boolean);
      return json({ audio_features: ids.map((id) => (this.energy.has(id) ? { id, energy: this.energy.get(id) } : null)) });
    }
    if ((m = path.match(/^\/tracks\/([^/]+)$/)) && method === 'GET') {
      return json({ id: m[1], name: this.names.get(m[1]) || m[1], uri: `spotify:track:${m[1]}` });
    }
    throw new Error(`FakeSpotify: unhandled ${method} ${path}`);
  }
}

function itemFor(u, names) {
  const id = u.split(':').pop();
  return { is_local: false, added_at: new Date().toISOString(), track: { id, uri: u, name: names.get(id) || id, type: 'track' } };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
