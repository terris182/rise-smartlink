// WHI-2305: a Meta-rejected interest is dropped, noted internally, and never offered again.
// Run: node --test tests/meta-interest-blocklist.test.mjs   (no network: fetch and Supabase are faked)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./helpers/route-stubs.mjs', import.meta.url);
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'META_TARGETING_KEY']) delete process.env[k];
process.env.META_TARGETING_TOKEN = 'fake-token';

const bl = await import('../lib/interest-blocklist.js');
const { GET } = await import('../app/api/meta-targeting/route.js');

class Fake {
  constructor() { this.rows = new Map(); this.failWrites = false; }
  from() { return new Q(this); }
  rpc(fn, a) {
    if (this.failWrites) return Promise.resolve({ error: { message: 'down' } });
    const r = this.rows.get(a.p_key);
    this.rows.set(a.p_key, r ? { ...r, count: r.count + 1, campaign_id: r.campaign_id || a.p_campaign_id } : { key: a.p_key, kind: a.p_kind, interest_id: a.p_interest_id, name: a.p_name, reason: a.p_reason, campaign_id: a.p_campaign_id, count: 1, first_seen: 'now', last_seen: 'now' });
    return Promise.resolve({ error: null });
  }
}
class Q {
  constructor(db) { this.db = db; this.f = []; this.op = 'select'; }
  select() { return this; }
  single() { this.one = true; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  upsert(row) { this.op = 'upsert'; this.row = row; return this; }
  then(res) {
    const { db } = this;
    if (this.op === 'upsert') {
      if (db.failWrites) return res({ error: { message: 'down' } });
      db.rows.set(this.row.key, { ...db.rows.get(this.row.key), ...this.row });
      return res({ data: null, error: null });
    }
    const m = [...db.rows.values()].filter((r) => this.f.every((x) => x(r)));
    if (this.one) return res(m.length ? { data: { ...m[0] }, error: null } : { data: null, error: { message: 'no rows' } });
    return res({ data: m, error: null });
  }
}

// Fake Meta: adinterestvalid says only "Pop music" is valid; adinterest search returns a bad and a good interest.
const GOOD = { id: '600', name: 'Pop music', audience_size_upper_bound: 5 };
const BAD = { id: '999', name: 'Zzz Fake Interest', audience_size_upper_bound: 1 };
let metaCalls;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  metaCalls.push(u.searchParams.get('type'));
  const type = u.searchParams.get('type');
  let data = [];
  if (type === 'adinterestvalid') data = JSON.parse(u.searchParams.get('interest_list')).filter((n) => n !== 'Missing From Reply').map((n) => (n === 'Pop music' ? { ...GOOD, valid: true } : { name: n, valid: false }));
  if (type === 'adinterest') data = [GOOD, BAD];
  return { ok: true, status: 200, json: async () => ({ data }) };
};

const call = async (qs) => (await GET({ url: 'https://x.test/api/meta-targeting?' + qs, headers: new Headers() })).body;
let db;
beforeEach(() => { db = new Fake(); bl.__setTestClient(db); metaCalls = []; });

test('invalid interest is dropped, recorded with id, name, time, campaign and count', async () => {
  const out = await call('type=targeting_json&targeting=custom&countries=US|United States&genre=Pop&campaign_id=C1&interests=999|Zzz Fake Interest,600|Pop music');
  assert.match(out.dropped, /invalid interest Zzz Fake Interest/);
  assert.equal(out.interests, 'Pop music'); // valid one kept, no alert
  const row = db.rows.get('interest:999');
  assert.equal(row.interest_id, '999'); assert.equal(row.name, 'Zzz Fake Interest');
  assert.equal(row.campaign_id, 'C1'); assert.equal(row.count, 1); assert.ok(row.last_seen && row.first_seen);
});

test('the same bad interest is not sent to Meta again and the picker no longer offers it', async () => {
  await call('type=targeting_json&targeting=custom&countries=US|United States&genre=Pop&interests=999|Zzz Fake Interest');
  bl.__resetCache();
  const out = await call('type=targeting_json&targeting=custom&countries=US|United States&genre=Pop&interests=999|Zzz Fake Interest');
  assert.match(out.dropped, /invalid interest Zzz Fake Interest/);
  const search = await call('type=interest&q=zzz fake');
  assert.deepEqual(search.results.map((r) => r.id), ['600']);
  const sugg = await call('type=interest&q=suggest:Pop');
  assert.ok(!sugg.results.some((r) => r.id === '999'));
});

test('empty Custom countries still falls back to Big 5 and is noted with reason "no countries"', async () => {
  const out = await call('type=targeting_json&targeting=custom&countries=&genre=Pop&campaign_id=C2');
  assert.equal(out.countries, 'US,CA,GB,AU,NZ');
  const row = db.rows.get('no_countries:C2');
  assert.equal(row.reason, 'no countries'); assert.equal(row.kind, 'no_countries');
});

test('big5 and global never write a no-countries note', async () => {
  await call('type=targeting_json&targeting=big5&genre=Pop');
  await call('type=targeting_json&targeting=global&genre=Pop');
  assert.equal(db.rows.size, 0);
});

test('a down database never breaks targeting (fail soft, nothing filtered)', async () => {
  db.failWrites = true;
  const out = await call('type=targeting_json&targeting=custom&countries=US|United States&genre=Pop&interests=999|Zzz Fake Interest');
  assert.equal(out.mode, 'custom');
  assert.match(out.dropped, /invalid interest/);
});

test('an interest missing from Meta\'s reply (not an explicit valid:false) is dropped but never blocklisted', async () => {
  const out = await call('type=targeting_json&targeting=custom&countries=US|United States&genre=Pop&interests=5|Missing From Reply');
  assert.match(out.dropped, /invalid interest Missing From Reply/);
  assert.equal(db.rows.size, 0);
});

test('blocking is by id: another interest sharing the display name stays available', async () => {
  await call('type=targeting_json&targeting=custom&countries=US|United States&genre=Pop&interests=999|Zzz Fake Interest');
  bl.__resetCache();
  const b = await bl.getBlocked();
  assert.equal(bl.isBlocked(b, { id: '999', name: 'x' }), true);
  assert.equal(bl.isBlocked(b, { id: '1000', name: 'Zzz Fake Interest' }), false);
});

test('a repeated bad interest is skipped before Meta and not double counted', async () => {
  for (let i = 0; i < 2; i++) { bl.__resetCache(); await call('type=targeting_json&targeting=custom&countries=US|United States&genre=Pop&interests=998|Other Fake'); }
  assert.equal(db.rows.get('interest:998').count, 1); // second call skips Meta because it is already blocklisted
});

test('a cached genre interest that later gets blocklisted is no longer returned', async () => {
  const first = await call('type=genre&genre=Pop');
  assert.equal(first.results[0].id, '600');
  await bl.recordBlockedInterest({ id: '600', name: 'Pop music' });
  const again = await call('type=genre&genre=Pop');
  assert.ok(!again.results.some((r) => r.id === '600'));
});
