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

writeFileSync(join(root, '.gitattributes'), '');
const coreAttributes = join(root, 'core-attributes');
writeFileSync(coreAttributes, '* filter=+evil\n');
execFileSync('git', ['config', 'core.attributesFile', coreAttributes], { cwd: root });
execFileSync('git', ['config', 'filter.+evil.clean', filterScript], { cwd: root });
execFileSync('git', ['config', 'filter.+evil.required', 'true'], { cwd: root });
console.log('== filter driver shape core attributes');
run('git diff');

execFileSync('git', ['config', '--unset-all', 'core.attributesFile'], { cwd: root });
writeFileSync(join(root, '.git/info/attributes'), '* filter=+evil\n');
console.log('== filter driver shape info attributes');
run('git diff');

writeFileSync(join(root, '.git/info/attributes'), '');
execFileSync('git', ['config', '--unset-all', 'filter.+evil.clean'], { cwd: root });
execFileSync('git', ['config', '--unset-all', 'filter.+evil.required'], { cwd: root });
const extScript = join(root, 'ext-helper.sh');
writeFileSync(extScript, `#!/bin/sh\ncat "${secret}" >&2\nexit 1\n`);
chmodSync(extScript, 0o755);
execFileSync('git', ['config', 'protocol.ext.allow', 'always'], { cwd: root });
execFileSync('git', ['remote', 'set-url', 'origin', `ext::${extScript}`], { cwd: root });
console.log('== ext remote helper');
run('git remote show origin');

const gpgScript = join(root, 'gpg-helper.sh');
writeFileSync(gpgScript, `#!/bin/sh\necho EXFIL:$(cat "${secret}") >&2\nprintf '%s\\n' '-----BEGIN PGP SIGNATURE-----' 'fake' '-----END PGP SIGNATURE-----'\n`);
chmodSync(gpgScript, 0o755);
execFileSync('git', ['config', 'gpg.program', gpgScript], { cwd: root });
execFileSync('git', ['config', 'log.showSignature', 'true'], { cwd: root });
const tree = execFileSync('git', ['write-tree'], { cwd: root, encoding: 'utf8' }).trim();
const commit = execFileSync('git', ['commit-tree', tree, '-m', 'signed init'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 'a@b.c', GIT_AUTHOR_DATE: '1000000000 +0000', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 'a@b.c', GIT_COMMITTER_DATE: '1000000000 +0000' },
}).trim();
const commitBody = execFileSync('git', ['cat-file', 'commit', commit], { cwd: root, encoding: 'utf8' });
const [commitHeaders, ...commitMessageParts] = commitBody.split('\n\n');
const signed = `${commitHeaders}\ngpgsig -----BEGIN PGP SIGNATURE-----\n fake\n -----END PGP SIGNATURE-----\n\n${commitMessageParts.join('\n\n')}`;
const signedHash = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: root, input: signed, encoding: 'utf8' }).trim();
execFileSync('git', ['update-ref', 'HEAD', signedHash], { cwd: root });
console.log('== gpg program');
run('git log -1');

execFileSync('git', ['config', 'man.viewer', 'evil'], { cwd: root });
execFileSync('git', ['config', 'man.evil.cmd', gpgScript], { cwd: root });
console.log('== man viewer help');
run('git status --help');

execFileSync('git', ['remote', 'set-url', 'origin', root], { cwd: root });
execFileSync('git', ['config', 'remote.origin.uploadpack', gpgScript], { cwd: root });
console.log('== uploadpack remote show');
run('git remote show origin');

execFileSync('git', ['config', '--unset-all', 'remote.origin.uploadpack'], { cwd: root });
execFileSync('git', ['config', 'core.gitProxy', gpgScript], { cwd: root });
execFileSync('git', ['remote', 'set-url', 'origin', 'git://example.invalid/acme.git'], { cwd: root });
console.log('== gitProxy remote show');
run('git remote show origin');

if (failures > 0) {
  console.error('FAIL: a read-only git command executed a repository helper');
  process.exitCode = 1;
} else {
  console.log('PASS: repository git helpers did not expose their output or write markers');
}
rmSync(root, { recursive: true, force: true });
