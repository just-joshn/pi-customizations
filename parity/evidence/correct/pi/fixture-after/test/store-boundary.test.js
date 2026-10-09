import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';

const run = (...files) => spawnSync('node', ['scripts/check-store-boundary.js', ...files], { encoding: 'utf8' });

test('src passes the boundary check', () => assert.strictEqual(run().status, 0));
for (const f of ['history/past-mistake-1.js', 'history/past-mistake-2.js']) {
  test(`${f} is rejected`, () => {
    const r = run(f);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /src\/store\.js/);
  });
}
