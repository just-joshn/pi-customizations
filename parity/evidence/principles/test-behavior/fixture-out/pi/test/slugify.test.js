import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/slugify.js';

test('slugify turns "Hello, World!" into hello-world', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
});
