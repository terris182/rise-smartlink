// WHI-1355 controlled test of removeDuplicateCopies on the (empty) Lay Low
// SUBMISSIONS playlist: add the same track 3x + another track, dedupe, expect 2
// copies removed and order [A, B], then clean up. Never touches a public playlist.
import fs from 'node:fs';
const s = JSON.parse(fs.readFileSync(process.env.HOME + '/.whitley/secrets/tout_spotify.json', 'utf8'));
process.env.SPOTIFY_CURATOR_CLIENT_ID = s.client_id;
process.env.SPOTIFY_CURATOR_CLIENT_SECRET = s.client_secret;
process.env.SPOTIFY_CURATOR_REFRESH_TOKEN = s.refresh_token;
const cur = await import('../lib/spotify-curator.js');
const PID = '4aEViQW43tSlhXVDmzaKFO'; // Submissions: Lay Low On Tout
const A = 'spotify:track:4PTG3Z6ehGkBFwjybzWkR8'; // Never Gonna Give You Up
const B = 'spotify:track:7GhIk7Il098yCjg4BQjzvb'; // Never Gonna Give You Up (other)
const before = await cur.getPlaylistTracks(PID);
if (before.length) { console.log('ABORT: submissions playlist not empty', before.length); process.exit(2); }
await cur.appendTracks(PID, [A, B, A, A]);
const stacked = await cur.getPlaylistTracks(PID);
console.log('stacked:', stacked.map((t) => t.uri.slice(-6)).join(','));
const r = await cur.removeDuplicateCopies(PID);
const after = await cur.getPlaylistTracks(PID);
console.log('dedupe result:', JSON.stringify(r));
console.log('after:', after.map((t) => t.uri.slice(-6)).join(','));
const ok = r.removed === 2 && after.length === 2 && after[0].uri === A && after[1].uri === B;
await cur.removeTracks(PID, [A, B]);
const clean = await cur.getPlaylistTracks(PID);
console.log('cleanup left', clean.length, 'tracks');
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok && clean.length === 0 ? 0 : 1);
