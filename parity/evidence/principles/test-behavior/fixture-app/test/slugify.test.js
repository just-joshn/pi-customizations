import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/slugify.js';

test('slugify is callable', () => {
  assert.doesNotThrow(() => slugify('Hello, World!'));
});
