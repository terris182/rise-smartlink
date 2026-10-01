// WHI-1877: asserts Instagram-only placements in /api/meta-targeting targeting_json.
// Run: node scripts/whi1877_placements_test.mjs   (no network: global fetch is stubbed)
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Next resolves 'next/server' itself; plain node ESM needs the .js extension.
register('data:text/javascript,' + encodeURIComponent(
  "export async function resolve(s,c,n){return n(s==='next/server'?'next/server.js':s,c);}"));
const { GET } = await import('../app/api/meta-targeting/route.js');

process.env.META_TARGETING_TOKEN = 'test-token';
delete process.env.META_TARGETING_KEY;

// Stub Meta Graph: every interest valid, genre search returns one interest.
globalThis.fetch = async (u) => {
  const s = String(u);
  let data = [];
  if (s.includes('adinterestvalid')) data = [{ id: '6003020622093', name: 'Taylor Swift', valid: true }];
  else if (s.includes('adinterest')) data = [{ id: '6003107902433', name: 'Pop music' }];
  return new Response(JSON.stringify({ data }), { status: 200 });
};

async function call(qs) {
  const res = await GET(new Request('https://gudmuzik.com/api/meta-targeting?' + qs));
  const body = await res.json();
  return { raw: JSON.stringify(body), body, t: body.targeting ? JSON.parse(body.targeting) : null };
}

const custom = 'type=targeting_json&targeting=custom&countries=' + encodeURIComponent('US|United States') +
  '&interests=' + encodeURIComponent('6003020622093|Taylor Swift') + '&genre=Pop&custom_audiences=12345678,23456789';
const modes = [custom, 'type=targeting_json&targeting=global&genre=Pop', 'type=targeting_json&targeting=big5&genre=Pop'];

// OFF baseline (d)
process.env.META_TARGETING_SEND_PLACEMENTS = '0';
const off = [];
for (const q of modes) off.push(await call(q));
for (const o of off) {
  assert.ok(!('publisher_platforms' in o.t) && !('instagram_positions' in o.t), '(d) keys must be absent when switch is 0');
}

// ON (default: variable unset) (a)(b)(c)(e)
delete process.env.META_TARGETING_SEND_PLACEMENTS;
for (let i = 0; i < modes.length; i++) {
  const on = await call(modes[i]);
  assert.deepEqual(on.t.publisher_platforms, ['instagram'], '(b) publisher_platforms');
  assert.deepEqual(on.t.instagram_positions, ['stream', 'story', 'reels'], '(b) instagram_positions');
  assert.ok(!/explore/i.test(on.raw), '(c) explore never appears');
  // (a) every other key/value unchanged vs OFF output
  const { publisher_platforms, instagram_positions, ...rest } = on.t;
  assert.deepEqual(rest, off[i].t, '(a) existing targeting fields unchanged');
  assert.equal(JSON.stringify(rest), JSON.stringify(off[i].t), '(a) key order unchanged');
  for (const k of ['dropped', 'mode', 'countries', 'interests']) assert.equal(on.body[k], off[i].body[k], '(a) ' + k);
  // (e)
  assert.deepEqual(on.t.targeting_automation, { advantage_audience: 0 }, '(e) targeting_automation');
}
const c = await call(custom);
assert.deepEqual(c.t.custom_audiences, [{ id: '12345678' }, { id: '23456789' }], '(e) custom_audiences');

// explicit "1" also on
process.env.META_TARGETING_SEND_PLACEMENTS = '1';
assert.deepEqual((await call(modes[0])).t.publisher_platforms, ['instagram']);

console.log('PASS: WHI-1877 placements (a)-(e) across custom/global/big5');
