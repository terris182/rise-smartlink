import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTtlCache } from '../lib/ttl-cache.js';
import { fetchSpotifyMeta, oembedCache } from '../lib/spotify.js';
import { fetchSpotifyTrackMeta, trackCache } from '../lib/spotify-api.js';

const realFetch = globalThis.fetch;
let calls;
beforeEach(() => { calls = []; oembedCache.clear(); trackCache.clear(); process.env.SPOTIFY_BASIC_TOKEN = 'x'; });
afterEach(() => { globalThis.fetch = realFetch; });

test('ttl cache expires entries', () => {
  let t = 0;
  const c = createTtlCache({ now: () => t });
  c.set('a', 1, 100);
  assert.equal(c.get('a'), 1);
  t = 101;
  assert.equal(c.get('a'), undefined);
});

test('playlist cover (oEmbed) is fetched once per URL, not per visit', async () => {
  globalThis.fetch = async (u) => { calls.push(String(u)); return { ok: true, json: async () => ({ title: 't', thumbnail_url: 'https://i/ab67616d00001e02x' }) }; };
  const u = 'https://open.spotify.com/playlist/abc';
  const a = await fetchSpotifyMeta(u);
  const b = await fetchSpotifyMeta(u);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
});

test('a failed oEmbed lookup is remembered briefly (no hammering)', async () => {
  globalThis.fetch = async (u) => { calls.push(String(u)); return { ok: false }; };
  const u = 'https://open.spotify.com/playlist/zzz';
  await fetchSpotifyMeta(u); await fetchSpotifyMeta(u);
  assert.equal(calls.length, 1);
});

test('track lookup that gets 401 refreshes the token and retries once', async () => {
  let tokenCalls = 0, trackCalls = 0;
  globalThis.fetch = async (u, opts) => {
    if (String(u).includes('accounts.spotify.com')) { tokenCalls++; return { ok: true, json: async () => ({ access_token: 'tok' + tokenCalls, expires_in: 3600 }) }; }
    trackCalls++;
    if (opts.headers.Authorization === 'Bearer tok1') return { ok: false, status: 401 };
    return { ok: true, status: 200, json: async () => ({ external_ids: { isrc: 'I1' }, artists: [{ name: 'A' }], name: 'T', album: { name: 'Al', id: 'x' } }) };
  };
  const m = await fetchSpotifyTrackMeta('https://open.spotify.com/track/5NsLNt21kTY69aLtU9J1ga?si=gud');
  assert.equal(m.isrc, 'I1');
  assert.equal(trackCalls, 2);
  assert.ok(tokenCalls >= 2);
  await fetchSpotifyTrackMeta('https://open.spotify.com/track/5NsLNt21kTY69aLtU9J1ga');
  assert.equal(trackCalls, 2); // second visit served from cache
});

test('concurrent cold lookups share one call', async () => {
  const { cached, createTtlCache: mk } = await import('../lib/ttl-cache.js');
  const c = mk(); let n = 0;
  const load = async () => { n++; await new Promise((r) => setTimeout(r, 10)); return 'v'; };
  const r = await Promise.all([1, 2, 3].map(() => cached(c, 'k', load, () => 1000)));
  assert.deepEqual(r, ['v', 'v', 'v']);
  assert.equal(n, 1);
});
