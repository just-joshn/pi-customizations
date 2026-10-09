import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checker = join(root, 'scripts/check-store-boundary.js');

function runChecker(...args) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

describe('store-boundary lint', () => {
  test('src/ passes (features use store)', () => {
    const result = runChecker();
    assert.equal(result.status, 0, result.stderr);
  });

  test('history/past-mistake-1.js fails the check', () => {
    const result = runChecker('history/past-mistake-1.js');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /store-boundary/);
    assert.match(result.stderr, /past-mistake-1\.js/);
  });
});
