// WHI-2266 ledger 2287 (Terris 2026-11-11): every Spotify button on gudmuzik opens the song with si=gud.
// Run: npm test   (node --test, no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpotifySiTag } from '../lib/link-match.js';

const T = '2FLxyfHwvnDZi5ZAc7gjLf';

test('bare track URL gets si=gud', () => {
  assert.equal(withSpotifySiTag(`https://open.spotify.com/track/${T}`), `https://open.spotify.com/track/${T}?si=gud`);
});

test('Spotify-generated share token is replaced with gud', () => {
  assert.equal(withSpotifySiTag(`https://open.spotify.com/track/${T}?si=7f324a4ec0cc4052`), `https://open.spotify.com/track/${T}?si=gud`);
});

test('existing si=gud is left alone', () => {
  assert.equal(withSpotifySiTag(`https://open.spotify.com/track/${T}?si=gud`), `https://open.spotify.com/track/${T}?si=gud`);
});

test('artist tag Terris chose (si=vex) is kept', () => {
  assert.equal(withSpotifySiTag(`https://open.spotify.com/track/${T}?si=vex`), `https://open.spotify.com/track/${T}?si=vex`);
});

test('song-in-playlist context is kept and si added', () => {
  const ctx = `https://open.spotify.com/track/${T}?context=spotify%3Aplaylist%3A1ed1zSW9zXKtvRuk9I8d6r`;
  assert.equal(withSpotifySiTag(ctx), `${ctx}&si=gud`);
});

test('intl path and trailing slash are kept', () => {
  assert.equal(withSpotifySiTag(`https://open.spotify.com/intl-de/track/${T}/`), `https://open.spotify.com/intl-de/track/${T}/?si=gud`);
});

test('playlist and album URLs get si=gud too', () => {
  assert.equal(withSpotifySiTag('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=gud');
  assert.equal(withSpotifySiTag('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3?si=abcdefABCDEF123456'), 'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3?si=gud');
});

test('spotify:track URI becomes an open.spotify.com track link with si=gud', () => {
  assert.equal(withSpotifySiTag(`spotify:track:${T}`), `https://open.spotify.com/track/${T}?si=gud`);
});

test('non-Spotify, empty and junk values pass through unchanged', () => {
  assert.equal(withSpotifySiTag(''), '');
  assert.equal(withSpotifySiTag(undefined), undefined);
  assert.equal(withSpotifySiTag('https://music.apple.com/us/album/x/1?i=2'), 'https://music.apple.com/us/album/x/1?i=2');
  assert.equal(withSpotifySiTag('not a url'), 'not a url');
  assert.equal(withSpotifySiTag('https://evilspotify.com/track/' + T), 'https://evilspotify.com/track/' + T);
});

test('spotify.link short links are left alone (cannot add si safely)', () => {
  assert.equal(withSpotifySiTag('https://spotify.link/abc123'), 'https://spotify.link/abc123');
});

test('duplicate si params collapse to one, custom tag wins in either order', () => {
  const base = `https://open.spotify.com/track/${T}`;
  assert.equal(withSpotifySiTag(`${base}?si=gud&si=7f324a4ec0cc4052`), `${base}?si=gud`);
  assert.equal(withSpotifySiTag(`${base}?si=7f324a4ec0cc4052&si=gud`), `${base}?si=gud`);
  assert.equal(withSpotifySiTag(`${base}?si=vex&si=7f324a4ec0cc4052`), `${base}?si=vex`);
  assert.equal(withSpotifySiTag(`${base}?si=7f324a4ec0cc4052&si=vex`), `${base}?si=vex`);
});

test('percent-encoded si name is treated as si', () => {
  const base = `https://open.spotify.com/track/${T}`;
  assert.equal(withSpotifySiTag(`${base}?s%69=7f324a4ec0cc4052`), `${base}?si=gud`);
  assert.equal(withSpotifySiTag(`${base}?si=gud&s%69=7f324a4ec0cc4052`), `${base}?si=gud`);
});

test('hash is kept after the query', () => {
  assert.equal(withSpotifySiTag(`https://open.spotify.com/track/${T}#x`), `https://open.spotify.com/track/${T}?si=gud#x`);
});

test('old si=gudmuzik and other short tags become gud (only artist tags are kept)', () => {
  assert.equal(withSpotifySiTag(`https://open.spotify.com/track/${T}?si=gudmuzik`), `https://open.spotify.com/track/${T}?si=gud`);
  assert.equal(withSpotifySiTag(`https://open.spotify.com/track/${T}?si=fb`), `https://open.spotify.com/track/${T}?si=gud`);
});

test('Spotify Web API hrefs become open.spotify.com links with si=gud', () => {
  assert.equal(withSpotifySiTag(`https://api.spotify.com/v1/tracks/${T}?si=gud`), `https://open.spotify.com/track/${T}?si=gud`);
  assert.equal(withSpotifySiTag(`https://api.spotify.com/v1/tracks/${T}`), `https://open.spotify.com/track/${T}?si=gud`);
  assert.equal(withSpotifySiTag('https://api.spotify.com/v1/playlists/37i9dQZF1DXcBWIGoYBM5M'), 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=gud');
  assert.equal(withSpotifySiTag('https://api.spotify.com/v1/me/tracks'), 'https://api.spotify.com/v1/me/tracks');
});

test('empty si and leading whitespace are handled', () => {
  assert.equal(withSpotifySiTag(`https://open.spotify.com/track/${T}?si=`), `https://open.spotify.com/track/${T}?si=gud`);
  assert.equal(withSpotifySiTag(`  https://open.spotify.com/track/${T}`), `https://open.spotify.com/track/${T}?si=gud`);
});

test('mixed-case variants of an artist tag are not approved tags', () => {
  assert.equal(withSpotifySiTag(`https://open.spotify.com/track/${T}?si=VEX`), `https://open.spotify.com/track/${T}?si=gud`);
  assert.equal(withSpotifySiTag(`https://open.spotify.com/track/${T}?si=Vex`), `https://open.spotify.com/track/${T}?si=gud`);
});
