import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from '../src/clamp.js';

test('clamp returns max when n exceeds the upper bound', () => {
  assert.equal(clamp(10, 0, 5), 5);
});
