import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { captureReference, comparePackaged } from '../helpers/resource-workflows-contract.mjs';
import { seedGreetingCli } from '../helpers/resource-workflows-fixtures.mjs';
import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';

test('immutable real reference bytes reject a mutated packaged command', async () => {
  const root = mkdtempSync('/tmp/rw-');
  const fixture = makeLocalSession({ root, out: join(root, 'out'), repoRoot: process.cwd() });
  try {
    await fixture.session.state();
    const target = seedGreetingCli(fixture.cwd);
    const env = { ...process.env, ...fixture.env };
    const reference = captureReference({ target, out: join(root, 'reference'), cwd: fixture.cwd, env });
    const source = join(fixture.cwd, 'source');
    mkdirSync(source);
    const main = join(source, '__main__.py');
    writeFileSync(main, readFileSync(target));
    const artifact = join(fixture.cwd, 'greet.pyz');
    execFileSync('python3', ['-m', 'zipapp', source, '-o', artifact], { env });
    assert.equal(comparePackaged({ artifact, reference, cwd: fixture.cwd, env, profile: fixture.profile }).allMatched, true);
    writeFileSync(main, readFileSync(target, 'utf8').replace("print('Hello ' + args[1])", "print('Wrong ' + args[1])"));
    execFileSync('python3', ['-m', 'zipapp', source, '-o', artifact], { env });
    const mutated = comparePackaged({ artifact, reference, cwd: fixture.cwd, env, profile: fixture.profile });
    assert.equal(mutated.allMatched, false);
    assert.equal(mutated.cases.find((item) => item.id === 'greeting').matched, false);
    assert.equal(readFileSync(join(reference.directory, 'greeting/stdout.raw'), 'utf8'), 'Hello Ada\n');
  } finally {
    await fixture.session.close();
    rmSync(root, { recursive: true, force: true });
  }
});
