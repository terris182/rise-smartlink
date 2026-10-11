// Run: npm test   (node --test, no network: fetch is stubbed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickYoutubeVideo,
  amazonSearchUrl,
  resolveOtherDsps,
  dspUpdates,
} from '../lib/dsp-resolver.js';

const item = (id, title, channelTitle) => ({ id: { videoId: id }, snippet: { title, channelTitle } });
const TRACK_URL = 'https://open.spotify.com/track/3Ugf6njTxvXKNgEYXd9SkG';

test('YouTube pick prefers a title match on an artist or Topic channel', () => {
  const items = [
    item('aaa', 'Lovely Bones (Lyrics)', 'Some Lyric Channel'),
    item('bbb', 'Lovely Bones', 'No One Mind - Topic'),
    item('ccc', 'Other song', 'No One Mind'),
  ];
  assert.equal(pickYoutubeVideo(items, 'No One Mind', 'Lovely Bones'), 'bbb');
});

test('YouTube pick falls back to the first title match, then the first result', () => {
  const items = [item('aaa', 'Unrelated', 'x'), item('bbb', 'Lovely Bones live', 'y')];
  assert.equal(pickYoutubeVideo(items, 'Nobody', 'Lovely Bones'), 'bbb');
  assert.equal(pickYoutubeVideo(items, 'Nobody', 'Zzz'), 'aaa');
  assert.equal(pickYoutubeVideo([], 'a', 'b'), null);
});

test('YouTube pick decodes HTML entities in titles', () => {
  const items = [item('aaa', 'Rock &amp; Roll', 'z')];
  assert.equal(pickYoutubeVideo(items, 'q', 'Rock & Roll'), 'aaa');
});

test('Amazon link is a search for the exact song', () => {
  assert.equal(amazonSearchUrl('A B', 'C&D'), 'https://music.amazon.com/search/A%20B%20C%26D');
});

test('existing values are never overwritten and nothing throws without a key', async () => {
  const realFetch = globalThis.fetch;
  delete process.env.YOUTUBE_API_KEY;
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  try {
    const existing = { youtubeUrl: 'https://youtu.be/keep', amazonMusicUrl: 'https://music.amazon.com/keep' };
    const out = await resolveOtherDsps({ artist: 'Aaa', title: 'Bbb', spotifyUrl: TRACK_URL, existing });
    assert.equal(out.youtubeUrl, 'https://youtu.be/keep');
    assert.equal(out.amazonMusicUrl, 'https://music.amazon.com/keep');
    assert.equal(out.deezerUrl, '');
    assert.deepEqual(dspUpdates(existing, out), {});
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fills empties from YouTube and Deezer, and playlists are skipped', async () => {
  const realFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = 'test-key';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('googleapis.com/youtube')) {
      return { ok: true, status: 200, json: async () => ({ items: [item('vid1', 'Song Two', 'Art Two - Topic')] }) };
    }
    if (u.includes('api.deezer.com/search')) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: [{ title: 'Song Two', title_short: 'Song Two', artist: { name: 'Art Two' }, link: 'https://www.deezer.com/track/9', isrc: 'X' }] }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const out = await resolveOtherDsps({ artist: 'Art Two', title: 'Song Two', spotifyUrl: TRACK_URL, existing: {} });
    assert.equal(out.youtubeUrl, 'https://www.youtube.com/watch?v=vid1');
    assert.equal(out.deezerUrl, 'https://www.deezer.com/track/9');
    assert.equal(out.amazonMusicUrl, 'https://music.amazon.com/search/Art%20Two%20Song%20Two');

    const playlist = await resolveOtherDsps({
      artist: 'Art Two', title: 'Song Two',
      spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', existing: {},
    });
    assert.deepEqual(playlist, { youtubeUrl: '', amazonMusicUrl: '', deezerUrl: '', youtubeCheckedAt: '' });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.YOUTUBE_API_KEY;
  }
});

// ── Round 2: only links created for Active Listener opt in ──
import {
  includeOtherDspsFromBody,
  parseIncludeFlag,
  wantsOtherDsps,
  visibleOtherDsps,
} from '../lib/dsp-resolver.js';

test('(a) create with spotifyOnly false opts in', () => {
  assert.equal(includeOtherDspsFromBody({ spotifyOnly: false }), true);
});

test('(b) create with spotifyOnly "false" (Bubble text) opts in', () => {
  assert.equal(includeOtherDspsFromBody({ spotifyOnly: 'false' }), true);
});

test('(c) create with no spotifyOnly stays legacy (no opt in)', () => {
  assert.equal(includeOtherDspsFromBody({}), false);
  assert.equal(includeOtherDspsFromBody({ spotifyOnly: undefined }), false);
  assert.equal(includeOtherDspsFromBody({ spotifyOnly: 'junk' }), false);
});

test('explicit includeOtherDsps true (boolean or text) opts in; update flag parses', () => {
  assert.equal(includeOtherDspsFromBody({ includeOtherDsps: true }), true);
  assert.equal(includeOtherDspsFromBody({ includeOtherDsps: 'true' }), true);
  assert.equal(includeOtherDspsFromBody({ includeOtherDsps: 'false' }), false);
  assert.equal(includeOtherDspsFromBody({ includeOtherDsps: false, spotifyOnly: false }), false);
  assert.equal(parseIncludeFlag('true'), true);
  assert.equal(parseIncludeFlag(false), false);
  assert.equal(parseIncludeFlag('false'), false);
  assert.equal(parseIncludeFlag('maybe'), undefined);
});

test('(d) spotifyOnly true shows nothing but Spotify, even with the flag and stored urls', () => {
  const link = {
    spotifyOnly: true, includeOtherDsps: true,
    youtubeUrl: 'https://youtu.be/x', amazonMusicUrl: 'https://music.amazon.com/x', deezerUrl: 'https://www.deezer.com/track/1',
  };
  assert.equal(wantsOtherDsps(link), false);
  assert.deepEqual(visibleOtherDsps(link), { youtubeUrl: '', amazonMusicUrl: '', deezerUrl: '' });
});

test('(e) stored DSP urls without the flag are not rendered or resolved', () => {
  const link = {
    spotifyOnly: false,
    youtubeUrl: 'https://youtu.be/x', amazonMusicUrl: 'https://music.amazon.com/x', deezerUrl: 'https://www.deezer.com/track/1',
  };
  assert.equal(wantsOtherDsps(link), false);
  assert.deepEqual(visibleOtherDsps(link), { youtubeUrl: '', amazonMusicUrl: '', deezerUrl: '' });
  assert.equal(wantsOtherDsps({ ...link, includeOtherDsps: false }), false);
  assert.equal(wantsOtherDsps({ ...link, includeOtherDsps: 'true' }), false);
});

test('a link with the flag shows its stored urls', () => {
  const link = { includeOtherDsps: true, amazonMusicUrl: 'https://music.amazon.com/x', deezerUrl: 'https://www.deezer.com/track/1' };
  assert.equal(wantsOtherDsps(link), true);
  assert.deepEqual(visibleOtherDsps(link), { youtubeUrl: '', amazonMusicUrl: link.amazonMusicUrl, deezerUrl: link.deezerUrl });
});

// ── Round 3: quota guard, URL allowlist, servicesText, strict flags ──
import {
  youtubeDue,
  isAllowedDspUrl,
  validateDspInput,
  servicesText,
  joinNames,
  dspResponseFields,
} from '../lib/dsp-resolver.js';

function stubFetch({ youtubeCalls, deezerLink = 'https://www.deezer.com/track/7' }) {
  return async (url) => {
    const u = String(url);
    if (u.includes('googleapis.com/youtube')) {
      youtubeCalls.n++;
      return { ok: true, status: 200, json: async () => ({ items: [item('vidR3', 'Quota Song', 'Quota Artist - Topic')] }) };
    }
    if (u.includes('api.deezer.com/search')) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: [{ title: 'Quota Song', title_short: 'Quota Song', artist: { name: 'Quota Artist' }, link: deezerLink, isrc: 'X' }] }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('youtubeDue: never checked, stale, fresh, has url, bad dates', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  assert.equal(youtubeDue({}, now), true);
  assert.equal(youtubeDue({ youtubeCheckedAt: 'garbage' }, now), true);
  assert.equal(youtubeDue({ youtubeCheckedAt: '2026-10-11T11:00:00Z' }, now), false);
  assert.equal(youtubeDue({ youtubeCheckedAt: '2026-10-10T12:00:01Z' }, now), false);
  assert.equal(youtubeDue({ youtubeCheckedAt: '2026-10-10T12:00:00Z' }, now), true);
  assert.equal(youtubeDue({ youtubeCheckedAt: '2027-01-01T00:00:00Z' }, now), true);
  assert.equal(youtubeDue({ youtubeUrl: 'https://youtu.be/x' }, now), false);
});

test('YouTube search runs once at create (force), is stamped, and is skipped at render within 24 h', async () => {
  const realFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = 'test-key';
  const youtubeCalls = { n: 0 };
  globalThis.fetch = stubFetch({ youtubeCalls });
  try {
    const first = await resolveOtherDsps({ artist: 'Quota Artist', title: 'Quota Song', spotifyUrl: TRACK_URL, existing: {}, force: true });
    assert.equal(youtubeCalls.n, 1);
    assert.equal(first.youtubeUrl, 'https://www.youtube.com/watch?v=vidR3');
    assert.ok(Number.isFinite(Date.parse(first.youtubeCheckedAt)));
    assert.equal(dspUpdates({}, first).youtubeCheckedAt, first.youtubeCheckedAt);

    // a link that was checked a minute ago and missed: render does not search again
    const recent = { youtubeCheckedAt: new Date(Date.now() - 60000).toISOString() };
    const render = await resolveOtherDsps({ artist: 'Quota Artist2', title: 'Quota Song2', spotifyUrl: TRACK_URL, existing: recent });
    assert.equal(youtubeCalls.n, 1);
    assert.equal(render.youtubeUrl, '');
    assert.equal(render.youtubeCheckedAt, recent.youtubeCheckedAt);

    // never checked: render searches
    await resolveOtherDsps({ artist: 'Quota Artist3', title: 'Quota Song3', spotifyUrl: TRACK_URL, existing: {} });
    assert.equal(youtubeCalls.n, 2);

    // stale (25 h): render searches again
    const stale = { youtubeCheckedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString() };
    const again = await resolveOtherDsps({ artist: 'Quota Artist4', title: 'Quota Song4', spotifyUrl: TRACK_URL, existing: stale });
    assert.equal(youtubeCalls.n, 3);
    assert.notEqual(again.youtubeCheckedAt, stale.youtubeCheckedAt);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.YOUTUBE_API_KEY;
  }
});

test('a YouTube miss is stamped too, and the in-memory miss cache is a second layer', async () => {
  const realFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('googleapis.com/youtube')) { calls++; return { ok: true, status: 200, json: async () => ({ items: [] }) }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const miss = await resolveOtherDsps({ artist: 'Miss Artist', title: 'Miss Song', spotifyUrl: TRACK_URL, existing: {}, force: true });
    assert.equal(miss.youtubeUrl, '');
    assert.ok(miss.youtubeCheckedAt);
    // force again within 30 min: the miss cache blocks a second search
    await resolveOtherDsps({ artist: 'Miss Artist', title: 'Miss Song', spotifyUrl: TRACK_URL, existing: {}, force: true });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.YOUTUBE_API_KEY;
  }
});

test('resolver values outside the allowlist are blanked and never persisted', async () => {
  const realFetch = globalThis.fetch;
  delete process.env.YOUTUBE_API_KEY;
  globalThis.fetch = stubFetch({ youtubeCalls: { n: 0 }, deezerLink: 'https://evil.example/track/1' });
  try {
    const out = await resolveOtherDsps({ artist: 'Evil Artist', title: 'Evil Song', spotifyUrl: TRACK_URL, existing: {}, force: true });
    assert.equal(out.deezerUrl, '');
    assert.equal(dspUpdates({}, { deezerUrl: 'http://www.deezer.com/track/1' }).deezerUrl, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('allowlist: YouTube', () => {
  for (const ok of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=x', 'https://m.youtube.com/watch?v=x',
    'https://music.youtube.com/watch?v=x', 'https://youtu.be/dQw4w9WgXcQ',
  ]) assert.equal(isAllowedDspUrl('youtubeUrl', ok), true, ok);
  for (const bad of [
    'https://evil.example/x', 'http://www.youtube.com/watch?v=x', 'https://youtube.com.evil.example/x',
    'https://evil.example/https://youtube.com', 'https://www.youtube.com@evil.example/x', 'https://user:pw@www.youtube.com/x',
    'javascript:alert(1)', 'https://www.youtube.com:8443/x', '', null, 42, 'https://notyoutube.com/x',
  ]) assert.equal(isAllowedDspUrl('youtubeUrl', bad), false, String(bad));
});

test('allowlist: Amazon Music', () => {
  for (const ok of [
    'https://music.amazon.com/search/a%20b', 'https://music.amazon.co.uk/albums/B0', 'https://music.amazon.de/x',
    'https://music.amazon.co.jp/x', 'https://music.amazon.com.br/x', 'https://music.amazon.in/x',
  ]) assert.equal(isAllowedDspUrl('amazonMusicUrl', ok), true, ok);
  for (const bad of [
    'https://amazon.com/music', 'https://www.amazon.com/x', 'http://music.amazon.com/x', 'https://music.amazon.evil.example/x',
    'https://music.amazon.com.evil.example/x', 'https://evil.example/music.amazon.com', 'https://music.amazon.comx/x',
  ]) assert.equal(isAllowedDspUrl('amazonMusicUrl', bad), false, bad);
});

test('allowlist: Deezer', () => {
  for (const ok of ['https://www.deezer.com/track/1', 'https://deezer.com/track/1', 'https://deezer.page.link/abc'])
    assert.equal(isAllowedDspUrl('deezerUrl', ok), true, ok);
  for (const bad of ['https://api.deezer.com/track/1', 'http://www.deezer.com/track/1', 'https://deezer.com.evil.example/x', 'https://evil.example/deezer.com'])
    assert.equal(isAllowedDspUrl('deezerUrl', bad), false, bad);
  // a field is only valid for its own domains
  assert.equal(isAllowedDspUrl('deezerUrl', 'https://www.youtube.com/watch?v=x'), false);
});

test('validateDspInput: rejects bad client values, allows blank to clear, checks the date', () => {
  assert.deepEqual(validateDspInput({ title: 'x' }), { values: {}, errors: [] });
  const bad = validateDspInput({ youtubeUrl: 'https://evil.example/x', deezerUrl: 'https://www.deezer.com/track/1' });
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0], /youtubeUrl/);
  const ok = validateDspInput({ youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', amazonMusicUrl: '', youtubeCheckedAt: '2026-10-11T00:00:00Z' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.values.amazonMusicUrl, '');
  assert.equal(ok.values.youtubeCheckedAt, '2026-10-11T00:00:00.000Z');
  assert.equal(validateDspInput({ youtubeCheckedAt: 'yesterday' }).errors.length, 1);
  assert.equal(validateDspInput({ amazonMusicUrl: 5 }).errors.length, 1);
});

test('stored values outside the allowlist are never rendered', () => {
  const link = { includeOtherDsps: true, youtubeUrl: 'https://evil.example/x', amazonMusicUrl: 'https://music.amazon.com/x', deezerUrl: 'javascript:alert(1)' };
  assert.deepEqual(visibleOtherDsps(link), { youtubeUrl: '', amazonMusicUrl: 'https://music.amazon.com/x', deezerUrl: '' });
});

test('servicesText lists only present services, in order, without an Oxford comma', () => {
  const all = {
    spotifyUrl: 'https://open.spotify.com/track/1', appleMusicUrl: 'https://music.apple.com/x', includeOtherDsps: true,
    youtubeUrl: 'https://youtu.be/x', amazonMusicUrl: 'https://music.amazon.com/x', deezerUrl: 'https://www.deezer.com/track/1',
  };
  assert.equal(servicesText(all), 'Spotify, Apple Music, YouTube, Amazon Music and Deezer');
  assert.equal(servicesText({ ...all, youtubeUrl: '' }), 'Spotify, Apple Music, Amazon Music and Deezer');
  assert.equal(servicesText({ ...all, appleMusicUrl: '', youtubeUrl: '', deezerUrl: '' }), 'Spotify and Amazon Music');
  assert.equal(servicesText({ spotifyUrl: 'https://open.spotify.com/track/1' }), 'Spotify');
  assert.equal(servicesText({ spotifyUrl: 'https://open.spotify.com/track/1', spotifyOnly: true, includeOtherDsps: true, deezerUrl: all.deezerUrl }), 'Spotify');
  assert.equal(servicesText({ spotifyUrl: 'x', appleMusicUrl: 'y' }), 'Spotify and Apple Music');
  assert.equal(joinNames([]), '');
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C');
});

test('dspResponseFields carries the fields the create / update responses need', () => {
  const link = { spotifyUrl: 'x', includeOtherDsps: true, deezerUrl: 'https://www.deezer.com/track/1', youtubeCheckedAt: '2026-10-11T00:00:00.000Z' };
  assert.deepEqual(dspResponseFields(link), {
    youtubeUrl: '', amazonMusicUrl: '', deezerUrl: 'https://www.deezer.com/track/1',
    youtubeCheckedAt: '2026-10-11T00:00:00.000Z', includeOtherDsps: true, servicesText: 'Spotify and Deezer',
  });
});

test('strict flag parsing used by update-link and links PUT for spotifyOnly and includeOtherDsps', () => {
  for (const [v, want] of [[true, true], ['true', true], [false, false], ['false', false], ['yes', undefined], [1, undefined], [null, undefined], ['', undefined], ['TRUE', undefined]]) {
    assert.equal(parseIncludeFlag(v), want, String(v));
  }
});

test('an invalid stored url counts as empty: it is due for lookup and can be replaced', async () => {
  assert.equal(youtubeDue({ youtubeUrl: 'https://evil.example/x' }), true);
  assert.deepEqual(dspUpdates({ deezerUrl: 'https://evil.example/x' }, { deezerUrl: 'https://www.deezer.com/track/5' }), { deezerUrl: 'https://www.deezer.com/track/5' });
});

test('a throwing YouTube fetch still returns the stamped checked-at', async () => {
  const realFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = 'test-key';
  globalThis.fetch = async (url) => {
    if (String(url).includes('googleapis.com/youtube')) throw new Error('boom');
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const out = await resolveOtherDsps({ artist: 'Throw Artist', title: 'Throw Song', spotifyUrl: TRACK_URL, existing: {}, force: true });
    assert.ok(out.youtubeCheckedAt);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.YOUTUBE_API_KEY;
  }
});

test('youtubeCheckedAt is not client-writable: update-link ignores it, links PUT strips it (WHI-2080 round 4)', async () => {
  const { register } = await import('node:module');
  register('./helpers/route-stubs.mjs', import.meta.url);
  const { store } = await import('./helpers/stubs/links.mjs');
  const { PUT: updateLinkPut } = await import('../app/api/update-link/route.js');
  const { PUT: linksPut } = await import('../app/api/links/route.js');
  const STAMP = '2026-10-10T00:00:00.000Z';
  const reset = () => { store.updates = null; store.link = { slug: 'a/b', title: 'Old', spotifyUrl: TRACK_URL, youtubeCheckedAt: STAMP }; };
  const req = (body) => ({ json: async () => body });

  // update-link: valid-looking and garbage values are both ignored; stored value unchanged, other fields still update
  for (const bad of ['2020-01-01T00:00:00Z', '', 'not a date']) {
    reset();
    const res = await updateLinkPut(req({ slug: 'a/b', title: 'New', youtubeCheckedAt: bad }));
    assert.equal(res.status, 200, String(bad));
    assert.equal('youtubeCheckedAt' in store.updates, false, String(bad));
    assert.equal(store.updates.title, 'New');
    assert.equal(store.link.youtubeCheckedAt, STAMP);
  }
  // update-link with only that field: nothing updatable
  reset();
  const only = await updateLinkPut(req({ slug: 'a/b', youtubeCheckedAt: '2020-01-01T00:00:00Z' }));
  assert.equal(only.status, 400);
  assert.equal(store.updates, null);

  // links PUT: stripped before it reaches the store
  for (const bad of ['2020-01-01T00:00:00Z', '', 'not a date']) {
    reset();
    const res = await linksPut(req({ slug: 'a/b', title: 'New', youtubeCheckedAt: bad }));
    assert.equal(res.status, 200, String(bad));
    assert.equal('youtubeCheckedAt' in store.updates, false, String(bad));
    assert.equal(store.link.youtubeCheckedAt, STAMP);
  }
});
