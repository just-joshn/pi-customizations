// What a container worker's parent and host may show or store about credentials, on real git and real files.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { resolveRemote, verifyPushed } from '../../src/container.ts';
import { redactUserinfo, scrubber, secretValues, stripUserinfo } from '../../src/redact.ts';

const TOKEN = 'ghp_ThisIsNotARealTokenButLooksLikeOne0123456789';

describe('redaction of what a worker shows or stores', () => {
  test('a URL loses its userinfo, and a text loses the userinfo of every URL in it', () => {
    expect(stripUserinfo(`https://user:${TOKEN}@github.com/o/r.git`)).toBe('https://github.com/o/r.git');
    expect(stripUserinfo(`https://${TOKEN}@github.com/o/r.git`)).toBe('https://github.com/o/r.git');
    expect(stripUserinfo('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
    expect(stripUserinfo('/srv/git/remote.git')).toBe('/srv/git/remote.git');
    expect(redactUserinfo(`fatal: unable to access 'https://x-access-token:${TOKEN}@host/r.git/' and https://${TOKEN}@other/r`)).toBe("fatal: unable to access 'https://***@host/r.git/' and https://***@other/r");
  });

  test('secret values come from credential names, secret-looking names, and the strings inside a JSON credential file', () => {
    const env = {
      ANTHROPIC_API_KEY: 'sk-live-0123456789',
      GH_TOKEN: TOKEN,
      PSTACK_CONTAINER_AUTH: JSON.stringify({ deepseek: { type: 'api_key', key: 'ds-key-abcdef' }, 'claude-subscription': { type: 'oauth', access: 'at-0123456789', refresh: '', expires: 1 } }),
      PATH: '/usr/local/bin:/usr/bin',
      GIT_AUTHOR_NAME: 'a-long-author-name',
      SHORT_TOKEN: 'abc',
    };

    const secrets = secretValues(env, ['ANTHROPIC_API_KEY']);

    expect(secrets).toEqual(expect.arrayContaining(['sk-live-0123456789', TOKEN, 'ds-key-abcdef', 'at-0123456789']));
    expect(secrets).not.toContain('/usr/local/bin:/usr/bin');
    expect(secrets).not.toContain('a-long-author-name');
    expect(secrets).not.toContain('abc');
    expect(scrubber(secrets)(`boom ${TOKEN} then at-0123456789 and https://u:p@h/r`)).toBe('boom *** then *** and https://***@h/r');
  });
});

describe('a remote whose URL carries a token', () => {
  let dir: string;
  let project: string;
  let commit: string;
  let log: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-redact-')));
    project = join(dir, 'project');
    const bin = join(dir, 'bin');
    log = join(dir, 'git-argv.log');
    mkdirSync(project);
    mkdirSync(bin);
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${log}\nexec ${real} "$@"\n`);
    chmodSync(join(bin, 'git'), 0o755);
    env = { PATH: `${bin}:${process.env['PATH']}`, HOME: dir };
    const git = (...args: string[]) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', env }).trim();
    git('init', '--quiet', '-b', 'main');
    writeFileSync(join(project, 'f'), 'x');
    git('add', 'f');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'init');
    commit = git('rev-parse', 'HEAD');
    git('remote', 'add', 'origin', `https://x-access-token:${TOKEN}@127.0.0.1:9/o/r.git`);
    // The setup above is the operator's own configuration; what is logged from here is what pstack runs.
    writeFileSync(log, '');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('is cloned without its token, and a failed read of it shows and runs no token', async () => {
    const remote = await resolveRemote(project, env);
    expect(remote.url).toBe('https://127.0.0.1:9/o/r.git');

    const failure = await verifyPushed(project, remote, commit, env).then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(failure?.message).toMatch(/Could not read the remote origin/);
    expect(failure?.message).not.toContain(TOKEN);
    const argv = readFileSync(log, 'utf8');
    expect(argv).toContain('ls-remote --heads --tags origin');
    expect(argv).not.toContain(TOKEN);
  });
});
