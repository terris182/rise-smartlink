import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePairs } from '../lib/parse-pairs.js';

test('two country pairs', () => {
  assert.deepEqual(parsePairs('US|United States,CA|Canada'), [
    { id: 'US', name: 'United States' },
    { id: 'CA', name: 'Canada' },
  ]);
});

test('single numeric-id pair', () => {
  assert.deepEqual(parsePairs('6003020622093|Taylor Swift'), [{ id: '6003020622093', name: 'Taylor Swift' }]);
});

test('comma inside a name is kept', () => {
  assert.deepEqual(parsePairs('6003|Tyler, the Creator,6004|Indie rock'), [
    { id: '6003', name: 'Tyler, the Creator' },
    { id: '6004', name: 'Indie rock' },
  ]);
});

test('whitespace after separating commas is trimmed', () => {
  assert.deepEqual(parsePairs('US|United States, CA|Canada ,  MX|Mexico'), [
    { id: 'US', name: 'United States' },
    { id: 'CA', name: 'Canada' },
    { id: 'MX', name: 'Mexico' },
  ]);
});

test('empty and missing input give an empty list', () => {
  assert.deepEqual(parsePairs(''), []);
  assert.deepEqual(parsePairs(null), []);
});

test('bare id without a pipe maps to id and name', () => {
  assert.deepEqual(parsePairs('US'), [{ id: 'US', name: 'US' }]);
});
