// Run: npm test   (node --test, no network)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSpotifyResource,
  parseSpotifyTrackId,
  slugifyPart,
  slugBase,
  isSlugVariant,
  sameSlugBase,
} from '../lib/link-match.js';

const TRACK = '4DYYlTuhtc21yJBgUs3dNy';
const ALBUM = '1DFixLWuPkv3KT3TnV35m3';
const PLAYLIST = '37i9dQZF1DXcBWIGoYBM5M';

test('track URLs yield the track id', () => {
  assert.equal(parseSpotifyTrackId(`https://open.spotify.com/track/${TRACK}`), TRACK);
  assert.equal(parseSpotifyTrackId(`https://open.spotify.com/track/${TRACK}/`), TRACK);
  assert.equal(parseSpotifyTrackId(`https://open.spotify.com/intl-de/track/${TRACK}`), TRACK);
  assert.equal(parseSpotifyTrackId(`https://open.spotify.com/embed/track/${TRACK}`), TRACK);
  assert.equal(parseSpotifyTrackId(`spotify:track:${TRACK}`), TRACK);
  assert.equal(parseSpotifyTrackId(`  https://open.spotify.com/track/${TRACK}  `), TRACK);
});

test('query strings and fragments are ignored', () => {
  assert.equal(parseSpotifyTrackId(`https://open.spotify.com/track/${TRACK}?si=7f324a4ec0cc4052`), TRACK);
  assert.equal(parseSpotifyTrackId(`https://open.spotify.com/track/${TRACK}?si=abc&utm_source=copy-link`), TRACK);
  assert.equal(parseSpotifyTrackId(`https://open.spotify.com/track/${TRACK}#x`), TRACK);
  assert.equal(
    parseSpotifyTrackId(`https://open.spotify.com/track/${TRACK}?si=1`),
    parseSpotifyTrackId(`https://open.spotify.com/track/${TRACK}?si=2`)
  );
});

test('album URLs are parsed but are not tracks', () => {
  const url = `https://open.spotify.com/album/${ALBUM}?si=xyz`;
  assert.deepEqual(parseSpotifyResource(url), { type: 'album', id: ALBUM });
  assert.equal(parseSpotifyTrackId(url), null);
});

test('playlist URLs are parsed but are not tracks', () => {
  const url = `https://open.spotify.com/playlist/${PLAYLIST}?si=abc123`;
  assert.deepEqual(parseSpotifyResource(url), { type: 'playlist', id: PLAYLIST });
  assert.equal(parseSpotifyTrackId(url), null);
  assert.equal(parseSpotifyTrackId(`spotify:playlist:${PLAYLIST}`), null);
});

test('non-Spotify or malformed input returns null', () => {
  assert.equal(parseSpotifyTrackId(''), null);
  assert.equal(parseSpotifyTrackId(null), null);
  assert.equal(parseSpotifyTrackId(undefined), null);
  assert.equal(parseSpotifyTrackId('not a url'), null);
  assert.equal(parseSpotifyTrackId(`https://example.com/track/${TRACK}`), null);
  assert.equal(parseSpotifyTrackId(`https://evilspotify.com/track/${TRACK}`), null);
  assert.equal(parseSpotifyTrackId('https://open.spotify.com/track/short'), null);
  assert.equal(parseSpotifyTrackId('https://open.spotify.com/'), null);
});

test('slugifyPart matches the create-link artist sanitizer', () => {
  assert.equal(slugifyPart('Vex Verity'), 'vex-verity');
  assert.equal(slugifyPart('  A$AP  Rocky '), 'aap-rocky');
  assert.equal(slugifyPart('vex-verity'), 'vex-verity');
  assert.equal(slugifyPart(''), '');
  assert.equal(slugifyPart(undefined), '');
});

test('slugBase strips the collision serial', () => {
  assert.equal(slugBase('leela'), 'leela');
  assert.equal(slugBase('leela-1'), 'leela');
  assert.equal(slugBase('leela-12'), 'leela');
  assert.equal(slugBase('artist/leela-2'), 'artist/leela');
  assert.equal(slugBase('leela-remix'), 'leela-remix');
  assert.equal(slugBase(''), '');
});

test('isSlugVariant accepts the base and -N suffixes only', () => {
  assert.equal(isSlugVariant('leela', 'leela'), true);
  assert.equal(isSlugVariant('leela-1', 'leela'), true);
  assert.equal(isSlugVariant('leela-10', 'leela'), true);
  assert.equal(isSlugVariant('artist/leela-1', 'artist/leela'), true);
  assert.equal(isSlugVariant('leela-remix', 'leela'), false);
  assert.equal(isSlugVariant('leelaa', 'leela'), false);
  assert.equal(isSlugVariant('leela-1-2', 'leela'), false);
  assert.equal(isSlugVariant('', 'leela'), false);
});

test('sameSlugBase pairs leela with leela-1', () => {
  assert.equal(sameSlugBase('leela', 'leela-1'), true);
  assert.equal(sameSlugBase('leela-1', 'leela-2'), true);
  assert.equal(sameSlugBase('leela', 'leela-remix'), false);
  assert.equal(sameSlugBase('leela', ''), false);
});
