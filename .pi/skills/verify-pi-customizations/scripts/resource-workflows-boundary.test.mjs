import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';

test('the actual sandbox prevents writes outside its owned fixture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resource-workflows-boundary-'));
  const other = mkdtempSync(join(tmpdir(), 'resource-workflows-neighbor-'));
  const fixture = makeLocalSession({ root, out: join(root, 'out'), repoRoot: process.cwd() });
  const sentinel = join(other, 'should-not-exist');
  try {
    await fixture.session.state();
    assert.throws(() => execFileSync('/usr/bin/sandbox-exec', ['-f', fixture.profile, '/usr/bin/touch', sentinel], { stdio: 'pipe' }));
    assert.equal(existsSync(sentinel), false);
    assert.throws(() => execFileSync('/usr/bin/sandbox-exec', ['-f', fixture.profile, '/usr/bin/touch', fixture.profile], { stdio: 'pipe' }));
    assert.throws(() => execFileSync('/usr/bin/sandbox-exec', ['-f', fixture.profile, '/bin/mv', fixture.profile, join(root, 'replaced.sb')], { stdio: 'pipe' }));
    execFileSync('/usr/bin/sandbox-exec', ['-f', fixture.profile, '/usr/bin/touch', join(root, 'owned')]);
    assert.equal(existsSync(join(root, 'owned')), true);
  } finally {
    await fixture.session.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});
