import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import { test } from 'node:test';

// Native coverage counts loaded source only. This inventory does not prove workflow behavior.
test('coverage includes every bounded outcome and evidence module and the RPC helper', async () => {
  const helpers = new URL('../helpers/', import.meta.url);
  const sources = globSync('resource-workflows-*-{outcome,evidence}.mjs', { cwd: helpers });
  assert.ok(sources.length > 0, 'bounded source coverage inventory is empty');
  for (const source of sources) await import(new URL(source, helpers));
  await import('../lib/rpc.mjs');
});
