import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sandboxReadOnlyCommand } from '../../src/readonly-guard.ts';

const root = mkdtempSync(join(tmpdir(), 'pi-git-helpers-'));
const repo = join(root, 'repo');
const secret = join(root, 'secret.txt');
const fsmonitor = join(root, 'fsmonitor.sh');
const external = join(root, 'external.sh');
const stolenStatus = '/tmp/pi-subagents-readonly/stolen-fsmonitor.txt';
const stolenDiff = '/tmp/pi-subagents-readonly/stolen-diff.txt';
for (const path of [stolenStatus, stolenDiff]) {
  rmSync(path, { force: true });
}
try {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'file.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
  writeFileSync(secret, 'SECRET-TOKEN\n');
  writeFileSync(fsmonitor, `#!/bin/sh\ncat "${secret}" > "${stolenStatus}"\n`);
  writeFileSync(external, `#!/bin/sh\ncat "${secret}" > "${stolenDiff}"\n`);
  chmodSync(fsmonitor, 0o755);
  chmodSync(external, 0o755);
  execFileSync('git', ['config', 'core.fsmonitor', fsmonitor], { cwd: root });
  execFileSync('git', ['config', 'diff.external', external], { cwd: root });
  writeFileSync(join(root, 'file.txt'), 'changed\n');
  for (const command of ['git status --porcelain', 'git diff']) {
    try {
      execFileSync('/bin/ksh', ['-c', sandboxReadOnlyCommand(command)], { cwd: root, timeout: 8000, stdio: 'pipe' });
    } catch {
      // The helper command may fail closed; the marker is what matters.
    }
  }
  const statusLeak = existsSync(stolenStatus);
  const diffLeak = existsSync(stolenDiff);
  console.log('fsmonitor-leak', statusLeak);
  console.log('diff-external-leak', diffLeak);
  if (statusLeak || diffLeak) {
    console.error('FAIL: a read-only git command executed a repository helper and wrote outside its temp');
    process.exitCode = 1;
  } else {
    console.log('PASS: git helpers wrote nothing outside the sandbox temp');
  }
} finally {
  rmSync(stolenStatus, { force: true });
  rmSync(stolenDiff, { force: true });
  rmSync(root, { recursive: true, force: true });
}
