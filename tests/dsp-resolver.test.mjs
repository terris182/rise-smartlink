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
    assert.deepEqual(playlist, { youtubeUrl: '', amazonMusicUrl: '', deezerUrl: '' });
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
