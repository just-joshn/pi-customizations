import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options });
assert.equal(process.env.PSTACK_CONTAINER, '1');
assert.equal(process.env.PSTACK_FAKE_FORGE_CAPABILITY, '1');
for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'SSH_AUTH_SOCK']) {
  assert.equal(process.env[name], undefined, `${name} must be absent`);
}
for (const path of ['/root/.config/gh/hosts.yml', join(process.env.HOME, '.config/gh/hosts.yml'), '/Users/josh-desktop/.config/gh/hosts.yml', '/Users/josh-desktop/Library/Keychains', '/usr/bin/security']) {
  assert.equal(existsSync(path), false, `${path} must not be reachable`);
}
const mounts = readFileSync('/proc/self/mountinfo', 'utf8');
assert.doesNotMatch(mounts, /Keychains|\.config\/gh|ssh-agent|\/Users\/josh-desktop(?: |\/Library\/)/);
const realGh = '/usr/local/bin/gh';
assert.equal(existsSync(realGh), true);
const auth = run(realGh, ['auth', 'status', '--hostname', 'github.com']);
assert.equal(auth.status, 1, 'real gh must have no github.com login');
assert.match(auth.stderr + auth.stdout, /not logged|not logged into|no accounts/i);
assert.equal(run('gh', ['auth', 'status', '--hostname', 'github.com']).status, 1);
const credential = run('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\npath=just-joshn/pstack-parity-sandbox.git\n\n',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});
assert.notEqual(credential.status, 0, 'HTTPS credential request must fail without prompting');
assert.doesNotMatch(credential.stdout, /^(password|username)=/m);
const env = { ...process.env };
delete env.PSTACK_FAKE_FORGE_CAPABILITY;
const refused = run('gh', ['pr', 'comment', '21', '--body', 'must not be posted'], { env });
assert.equal(refused.status, 4, 'missing fixture capability must refuse writes');
assert.match(refused.stderr, /no forge capability/);
console.log('CREDENTIAL-ISOLATION PASS: absent tokens, no host auth, real gh refused, HTTPS credential unavailable, missing fixture capability refused');
