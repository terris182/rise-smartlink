import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkApiKey } from '../lib/api-key.js';

const original = process.env.SMARTLINK_API_KEY;
const req = (headers = {}) => ({ headers: new Headers(headers) });
const KEY = 'test-key-not-a-real-secret';

beforeEach(() => {
  delete process.env.SMARTLINK_API_KEY;
});

after(() => {
  if (original === undefined) delete process.env.SMARTLINK_API_KEY;
  else process.env.SMARTLINK_API_KEY = original;
});

test('unset env allows requests without a key', () => {
  assert.deepEqual(checkApiKey(req()), { ok: true, enforced: false });
});

test('unset env allows requests even when a key header is sent', () => {
  assert.equal(checkApiKey(req({ 'x-api-key': 'anything' })).ok, true);
});

test('set env rejects a missing key', () => {
  process.env.SMARTLINK_API_KEY = KEY;
  assert.deepEqual(checkApiKey(req()), { ok: false, enforced: true });
});

test('set env rejects a wrong key in both header forms', () => {
  process.env.SMARTLINK_API_KEY = KEY;
  assert.equal(checkApiKey(req({ 'x-api-key': 'wrong' })).ok, false);
  assert.equal(checkApiKey(req({ authorization: 'Bearer wrong' })).ok, false);
});

test('set env accepts Authorization: Bearer', () => {
  process.env.SMARTLINK_API_KEY = KEY;
  assert.equal(checkApiKey(req({ authorization: `Bearer ${KEY}` })).ok, true);
});

test('set env accepts x-api-key', () => {
  process.env.SMARTLINK_API_KEY = KEY;
  assert.equal(checkApiKey(req({ 'x-api-key': KEY })).ok, true);
});

test('set env rejects a non-Bearer Authorization scheme', () => {
  process.env.SMARTLINK_API_KEY = KEY;
  assert.equal(checkApiKey(req({ authorization: `Basic ${KEY}` })).ok, false);
});
