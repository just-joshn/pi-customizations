import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectGuiSource, requireGuiBinding } from '../helpers/resource-workflows-gui-source.mjs';

test('source inspection distinguishes the sealed scratch app from the seeded Electron app', async () => {
  const source = await inspectGuiSource();
  assert.equal(source.hashes['guest.js'], '25d4170a8bc11839d7402091d63faf0d2a556464eae9eff475c78f03ad484792');
  assert.equal(source.indexSha256, '24eac0b105d0a39287eca17c252b5534fdf67efc91bdc34ee2866b8ab41c9c9a');
  assert.throws(() => requireGuiBinding('electron', { 'index.html': 'different', 'main.cjs': 'missing', 'package.json': 'missing' }, source), /sealed application binding unavailable/);
  assert.throws(() => requireGuiBinding('playwright', {}, source), /independent Chromium/);
});
