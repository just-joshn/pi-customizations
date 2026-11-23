import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sandboxReadOnlyCommand } from '../../src/readonly-guard.ts';

const root = mkdtempSync(join(tmpdir(), 'pi-git-exfil-'));
const secret = join(root, 'secret.txt');
const script = join(root, 'exfil.sh');
writeFileSync(secret, 'SECRET-TOKEN-991');
writeFileSync(script, `#!/bin/sh\necho EXFIL:$(cat "${secret}")\n`);
chmodSync(script, 0o755);

let failures = 0;
const markers = [];

function run(command) {
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    stdout = execFileSync('/bin/ksh', ['-c', sandboxReadOnlyCommand(command)], { cwd: root, timeout: 8000, encoding: 'utf8' });
  } catch (error) {
    code = error.status ?? 1;
    stdout = `${error.stdout ?? ''}`;
    stderr = `${error.stderr ?? ''}`;
  }
  const hit = `${stdout}${stderr}`.includes('SECRET-TOKEN-991');
  if (hit) {
    failures += 1;
  }
  console.log('CMD', command, 'code', code, 'LEAK', hit);
  console.log('STDOUT', stdout.slice(0, 500).replaceAll('\n', ' | '));
  console.log('STDERR', stderr.slice(0, 500).replaceAll('\n', ' | '));
}

execFileSync('git', ['init', '-q'], { cwd: root });
execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: root });
execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
writeFileSync(join(root, 'file.txt'), 'base\n');
execFileSync('git', ['add', 'file.txt'], { cwd: root });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: root });
writeFileSync(join(root, 'file.txt'), 'changed\n');
writeFileSync(join(root, '.gitattributes'), '*.txt diff=evil\n');
execFileSync('git', ['config', 'diff.evil.command', script], { cwd: root });
console.log('== diff driver command');
run('git diff');
execFileSync('git', ['config', '--unset-all', 'diff.evil.command'], { cwd: root });
execFileSync('git', ['config', 'diff.evil.textconv', script], { cwd: root });
console.log('== textconv log -p');
run('git log -p -1');
console.log('== textconv diff');
run('git diff -- file.txt');
execFileSync('git', ['config', 'core.sshCommand', script], { cwd: root });
execFileSync('git', ['remote', 'add', 'origin', 'git@example.invalid:acme/app.git'], { cwd: root });
console.log('== sshCommand remote show');
run('git remote show origin');
execFileSync('git', ['config', 'credential.helper', `!${script}`], { cwd: root });
execFileSync('git', ['remote', 'set-url', 'origin', 'https://example.invalid/acme/app.git'], { cwd: root });
console.log('== credential helper');
run('git remote show origin');

const filterScript = join(root, 'filter.sh');
writeFileSync(filterScript, `#!/bin/sh\ncat "${secret}"\n`);
chmodSync(filterScript, 0o755);
execFileSync('git', ['config', '--unset-all', 'diff.evil.textconv'], { cwd: root });
execFileSync('git', ['config', '--unset-all', 'core.sshCommand'], { cwd: root });
execFileSync('git', ['config', '--unset-all', 'credential.helper'], { cwd: root });
writeFileSync(join(root, '.gitattributes'), '* filter=evil\n');
execFileSync('git', ['config', 'filter.evil.clean', filterScript], { cwd: root });
execFileSync('git', ['config', 'filter.evil.required', 'true'], { cwd: root });
console.log('== clean filter diff');
run('git diff');
console.log('== clean filter blame');
run('git blame file.txt');

const fsMarker = join(root, 'fsmonitor-marker');
const extMarker = join(root, 'external-marker');
writeFileSync(join(root, 'fsmonitor.sh'), `#!/bin/sh\ntouch "${fsMarker}"\n`);
writeFileSync(join(root, 'external.sh'), `#!/bin/sh\ntouch "${extMarker}"\n`);
chmodSync(join(root, 'fsmonitor.sh'), 0o755);
chmodSync(join(root, 'external.sh'), 0o755);
execFileSync('git', ['config', 'core.fsmonitor', join(root, 'fsmonitor.sh')], { cwd: root });
execFileSync('git', ['config', 'diff.external', join(root, 'external.sh')], { cwd: root });
run('git status --porcelain');
run('git diff');
markers.push(fsMarker, extMarker);
const fsLeak = existsSync(fsMarker);
const extLeak = existsSync(extMarker);
console.log('fsmonitor-leak', fsLeak);
console.log('diff-external-leak', extLeak);
if (fsLeak || extLeak) {
  failures += 1;
}

if (failures > 0) {
  console.error('FAIL: a read-only git command executed a repository helper');
  process.exitCode = 1;
} else {
  console.log('PASS: repository git helpers did not expose their output or write markers');
}
rmSync(root, { recursive: true, force: true });
