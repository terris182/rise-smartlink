// WHI-2061: stored top-5 pins for the auto-curator.
// Run: npm run test:curator   (node --test, in-memory fake Spotify, no network)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeSpotify, uri, trackItem, nullItem, localItem, episodeItem } from './helpers/fake-spotify.mjs';

// Fakes only: no Supabase (in-memory stores), dummy Spotify credentials.
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_CURATOR_URL', 'SUPABASE_CURATOR_SERVICE_ROLE_KEY']) delete process.env[k];
process.env.SPOTIFY_CURATOR_CLIENT_ID = 'fake-id';
process.env.SPOTIFY_CURATOR_CLIENT_SECRET = 'fake-secret';
process.env.SPOTIFY_CURATOR_REFRESH_TOKEN = 'fake-refresh';

const { curateOnce, reorderToMatch } = await import('../lib/spotify-curator.js');

const TGT = 'TARGETPLAYLIST';
const PINS = ['Pin One', 'Pin Two', 'Pin Three', 'Pin Four', 'Pin Five'];
const PIN_URIS = PINS.map(uri);
const OTHERS = Array.from({ length: 10 }, (_, i) => `Song ${String.fromCharCode(65 + i)}`);

let fake;
beforeEach(() => {
  fake = new FakeSpotify().install();
  PINS.forEach((n, i) => fake.setEnergy(n, 0.1 + i * 0.01)); // pins are low energy on purpose
  OTHERS.forEach((n, i) => fake.setEnergy(n, 0.9 - i * 0.05)); // Song A highest
  fake.setEnergy('Intruder', 0.99); // would sort to the very top of the pool
});
afterEach(() => fake.uninstall());

let jobSeq = 0;
const job = (over = {}) => ({
  id: `job-${++jobSeq}`,
  name: 'Test',
  targetPlaylistId: `${TGT}${jobSeq}`,
  sourcePlaylistId: '',
  mode: 'resort',
  energyDirection: 'desc',
  excludeTopN: 5,
  ...over,
});
const base = () => [...PINS, ...OTHERS].map((n) => trackItem(n));

test('(a) outside writer inserts a track at index 0: pins restored to 1-5 in order, intruder at 6+, count unchanged', async () => {
  for (const mode of ['refresh', 'resort']) {
    const j = job({ mode, pinnedUris: PIN_URIS });
    fake.setPlaylist(j.targetPlaylistId, [trackItem('Intruder'), ...base()]);
    const before = fake.uris(j.targetPlaylistId).length;
    const r = await curateOnce(j);
    const after = fake.uris(j.targetPlaylistId);
    assert.deepEqual(after.slice(0, 5), PIN_URIS, `${mode}: pins at 1-5`);
    assert.ok(after.indexOf(uri('Intruder')) >= 5, `${mode}: intruder at position 6 or below`);
    assert.equal(after.length, before, `${mode}: track count unchanged`);
    assert.equal(r.ok, true, `${mode}: ${r.message}`);
    assert.equal(r.pinnedCheck, 'ok');
  }
});

test('(a2) pins are restored in STORED order even when physically shuffled', async () => {
  const j = job({ mode: 'refresh', pinnedUris: PIN_URIS });
  const items = base();
  [items[0], items[3]] = [items[3], items[0]];
  fake.setPlaylist(j.targetPlaylistId, items);
  const r = await curateOnce(j);
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(fake.uris(j.targetPlaylistId).slice(0, 5), PIN_URIS);
});

test('(b) a pinned URI is missing: zero mutations, ok:false naming the missing track', async () => {
  const j = job({ mode: 'refresh', pinnedUris: PIN_URIS });
  // Pin Five is gone; also stack a duplicate so we can prove dedupe did not run.
  const items = base().filter((it) => it.track.name !== 'Pin Five');
  items.push(trackItem('Song A'));
  fake.setPlaylist(j.targetPlaylistId, items);
  const before = fake.uris(j.targetPlaylistId);
  const r = await curateOnce(j);
  assert.equal(r.ok, false);
  assert.match(r.message, /Pin Five/);
  assert.equal(fake.mutations.length, 0, 'no mutating request was sent');
  assert.deepEqual(fake.uris(j.targetPlaylistId), before);
});

test('(c) duplicate copy of a pinned track: pinned not touched, duplicate reported', async () => {
  const j = job({ mode: 'refresh', pinnedUris: PIN_URIS });
  const items = base();
  items.splice(8, 0, trackItem('Pin Three'));
  fake.setPlaylist(j.targetPlaylistId, items);
  const r = await curateOnce(j);
  assert.equal(r.ok, true, r.message);
  const touchedPin = fake.mutations.some((m) => JSON.stringify(m.body || {}).includes(uri('Pin Three')));
  assert.equal(touchedPin, false, 'never removed or re-added a pinned uri');
  assert.deepEqual(fake.uris(j.targetPlaylistId).slice(0, 5), PIN_URIS);
  assert.ok(Array.isArray(r.pinnedDuplicates) && r.pinnedDuplicates.some((d) => d.uri === uri('Pin Three') && d.copies === 2));
  assert.match(r.message, /Pin Three/);
});

test('(d) null / local / episode items in the list: moves land on the right physical positions', async () => {
  const j = job({ mode: 'resort', pinnedUris: PIN_URIS });
  const items = [
    nullItem(), trackItem('Song J'), trackItem('Pin Two'), localItem('home-demo.mp3'), trackItem('Pin One'),
    trackItem('Song C'), episodeItem('Podcast'), trackItem('Pin Five'), trackItem('Song A'), trackItem('Pin Three'),
    nullItem(), trackItem('Pin Four'), trackItem('Song B'),
  ];
  fake.setPlaylist(j.targetPlaylistId, items);
  const r = await curateOnce(j);
  const after = fake.uris(j.targetPlaylistId);
  assert.deepEqual(after.slice(0, 5), PIN_URIS, 'physical positions 1-5 are the pins');
  assert.deepEqual(fake.playableUris(j.targetPlaylistId), [...PIN_URIS, uri('Song A'), uri('Song B'), uri('Song C'), uri('Song J')]);
  assert.equal(after.length, items.length, 'nothing added or removed');
  assert.equal(r.ok, true, r.message);
  assert.equal(r.pinnedCheck, 'ok');
});

test('(d2) reorderToMatch uses physical indices and chains snapshot_id between PUTs', async () => {
  const pid = 'PHYSICAL';
  fake.setPlaylist(pid, [nullItem(), trackItem('Song C'), localItem('x.mp3'), trackItem('Song A'), trackItem('Song B')]);
  const r = await reorderToMatch(pid, [uri('Song A'), uri('Song B'), uri('Song C')]);
  assert.deepEqual(fake.playableUris(pid), [uri('Song A'), uri('Song B'), uri('Song C')]);
  assert.equal(r.ok, true, r.reason);
  assert.ok(fake.moveSnapshots.length > 0);
  assert.equal(fake.moveSnapshots[0].sent, 'snap-1', 'first PUT carries the snapshot that was read');
  for (let i = 1; i < fake.moveSnapshots.length; i++) {
    assert.equal(fake.moveSnapshots[i].sent, fake.moveSnapshots[i - 1].returned, 'each PUT carries the previous response snapshot');
  }
});

test('(e) membership changes between read and reorder: ok:false, no silent success', async () => {
  for (const pinnedUris of [PIN_URIS, undefined]) {
    const j = job({ mode: 'resort', pinnedUris });
    fake.setPlaylist(j.targetPlaylistId, base());
    let injected = false;
    fake.onRequest = (req, f) => {
      // audio-features is fetched after the curator read the playlist and before it reorders
      if (!injected && req.path === '/audio-features') {
        injected = true;
        f.items(j.targetPlaylistId).push(trackItem('Intruder'));
      }
    };
    const r = await curateOnce(j);
    fake.onRequest = null;
    assert.equal(injected, true);
    assert.equal(r.ok, false, `pins=${!!pinnedUris}: must not report success`);
    assert.match(r.message, /membership/i);
  }
});

test('(e2) reorderToMatch with a membership mismatch returns ok:false with a reason', async () => {
  const pid = 'MISMATCH';
  fake.setPlaylist(pid, [trackItem('Song A'), trackItem('Song B')]);
  const r = await reorderToMatch(pid, [uri('Song B'), uri('Song C')]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /membership/i);
  assert.equal(fake.mutations.length, 0);
});

test('(f) no pinnedUris: same output as current behavior plus a "no stored pins" warning', async () => {
  const j = job({ mode: 'resort', excludeTopN: 3, pinnedUris: undefined });
  const items = [trackItem('Intruder'), ...base()];
  fake.setPlaylist(j.targetPlaylistId, items);
  const r = await curateOnce(j);
  assert.equal(r.ok, true, r.message);
  // Current behavior: physical top 3 frozen, rest energy-sorted.
  const expected = [uri('Intruder'), uri('Pin One'), uri('Pin Two'), ...OTHERS.map(uri), uri('Pin Five'), uri('Pin Four'), uri('Pin Three')];
  assert.deepEqual(fake.uris(j.targetPlaylistId), expected);
  assert.equal(r.pinned, 3);
  assert.equal(r.total, items.length);
  assert.ok(Array.isArray(r.warnings) && r.warnings.includes('no stored pins'));
  assert.equal(r.pinnedCheck, 'not_set');
});

test('(h) top does not match pins after reorder (writes silently ignored): ok:false, pinnedCheck mismatch', async () => {
  const j = job({ mode: 'resort', pinnedUris: PIN_URIS });
  fake.setPlaylist(j.targetPlaylistId, [trackItem('Intruder'), ...base()]);
  fake.dropMoves = true;
  const r = await curateOnce(j);
  assert.equal(r.ok, false);
  assert.equal(r.pinnedCheck, 'mismatch');
  assert.ok(r.pinnedMismatch && Array.isArray(r.pinnedMismatch.actual));
});

test('(i) insert mode with pins: new submission lands below the pins', async () => {
  const j = job({ mode: 'insert', sourcePlaylistId: `SRC${jobSeq + 1}`, pinnedUris: PIN_URIS, windowSize: 30 });
  fake.setPlaylist(j.targetPlaylistId, [trackItem('Intruder'), ...base().filter((it) => it.track.name !== 'Song J')]);
  fake.setPlaylist(j.sourcePlaylistId, [trackItem('Song J')]);
  const r = await curateOnce(j);
  assert.equal(r.ok, true, r.message);
  const after = fake.uris(j.targetPlaylistId);
  assert.deepEqual(after.slice(0, 5), PIN_URIS);
  assert.ok(after.indexOf(uri('Song J')) >= 5);
});

test('(r4) submissions are cleared only after reorder ok and pins verified; kept on failure', async () => {
  // failure 1: pins do not verify (Spotify ignores the moves)
  let j = job({ mode: 'insert', sourcePlaylistId: `SRCA${jobSeq}`, pinnedUris: PIN_URIS, removeFromSource: true });
  fake.setPlaylist(j.targetPlaylistId, [trackItem('Intruder'), ...base().filter((it) => it.track.name !== 'Song J')]);
  fake.setPlaylist(j.sourcePlaylistId, [trackItem('Song J')]);
  fake.dropMoves = true;
  let r = await curateOnce(j);
  fake.dropMoves = false;
  assert.equal(r.ok, false);
  assert.equal(r.pinnedCheck, 'mismatch');
  assert.deepEqual(fake.uris(j.sourcePlaylistId), [uri('Song J')], 'submission kept for the next run');
  assert.equal(r.removedFromSource, 0);

  // failure 2: reorder refused (membership changed mid-run)
  j = job({ mode: 'insert', sourcePlaylistId: `SRCB${jobSeq}`, pinnedUris: PIN_URIS, removeFromSource: true });
  fake.setPlaylist(j.targetPlaylistId, base().filter((it) => it.track.name !== 'Song J'));
  fake.setPlaylist(j.sourcePlaylistId, [trackItem('Song J')]);
  let injected = false;
  fake.onRequest = (req, f) => {
    if (!injected && req.path === '/audio-features') { injected = true; f.items(j.targetPlaylistId).push(trackItem('Intruder')); }
  };
  r = await curateOnce(j);
  fake.onRequest = null;
  assert.equal(r.ok, false);
  assert.deepEqual(fake.uris(j.sourcePlaylistId), [uri('Song J')], 'submission kept after a refused reorder');

  // success: submissions cleared
  j = job({ mode: 'insert', sourcePlaylistId: `SRCC${jobSeq}`, pinnedUris: PIN_URIS, removeFromSource: true });
  fake.setPlaylist(j.targetPlaylistId, base().filter((it) => it.track.name !== 'Song J'));
  fake.setPlaylist(j.sourcePlaylistId, [trackItem('Song J')]);
  r = await curateOnce(j);
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(fake.uris(j.sourcePlaylistId), [], 'submission cleared after a verified run');
  assert.equal(r.removedFromSource, 1);
});
