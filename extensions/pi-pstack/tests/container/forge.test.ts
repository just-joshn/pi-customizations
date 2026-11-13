// Forge access for a container worker: `gh` ships in the default environment, and a token is injected only when asked for.
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DEFAULT_IMAGE_TAG } from '../../src/container.ts';
import { tmuxSessionName } from '../../src/run-files.ts';
import { type Entry, killTmuxServer, makeParent, makeProject, makeRun, type Parent, PI, type Project, stopProject, transcript, until, workerDir, workerTestEnv, writeAssignment } from '../worker-lifecycle/harness.ts';
import { startGitServer, type GitServer } from './git-https-server.ts';

const run = promisify(execFile);

function engineEnv(): Record<string, string> {
  if (process.env['DOCKER_HOST']) return { DOCKER_HOST: process.env['DOCKER_HOST'] };
  const host = execFileSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).trim();
  return host === '' ? {} : { DOCKER_HOST: host };
}
const ENGINE = engineEnv();
process.env['DOCKER_HOST'] = ENGINE['DOCKER_HOST'] ?? '';
if (process.env['DOCKER_HOST'] === '') delete process.env['DOCKER_HOST'];

const docker = async (...args: string[]) => (await run('docker', args)).stdout.trim();
function piEntry(): string {
  const override = process.env['PSTACK_E2E_PI_ENTRY'];
  if (override) return override;
  const agent = dirname(dirname(PI));
  const version = readFileSync(join(agent, 'install', 'current-version'), 'utf8').trim();
  return join(agent, 'install', 'releases', version, 'node_modules', '.bin', 'pi');
}
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const RUN_ID = `frg-${randomBytes(3).toString('hex')}`;
/** An address the host and a container on the engine's bridge both reach: the host's own LAN address. */
const HOST = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address as string;
const TOKEN = `push-token-${randomBytes(10).toString('hex')}`;

let base: string;
let project: Project;
let server: GitServer;
let bare: string;
let entries: Entry[];
let parent: Parent;

const makeContainerParent = (extraEnv: Record<string, string> = {}) =>
  makeParent(project, entries, {
    containerPi: piEntry(),
    extraEnv: { ...workerTestEnv(project), ...ENGINE, GIT_SSL_CAINFO: server.cert, GH_HOST: `${HOST}:${server.port}`, PSTACK_CONTAINER_FORGE_TOKEN: TOKEN, ...extraEnv },
  });
const writeWorker = (workerId: string, command: string, fields: Record<string, unknown> = {}, inputCommit = project.commit) =>
  writeAssignment(project, RUN_ID, workerId, `@@script ${JSON.stringify([{ tool: 'bash', args: { command } }])}`, { workspace: { mode: 'container', inputCommit }, ...fields });
const spawn = (workerId: string, command: string, fields: Record<string, unknown> = {}, who: Parent = parent) =>
  who.call('pstack_worker', { action: 'spawn', runId: RUN_ID, assignmentPath: writeWorker(workerId, command, fields) });
const collect = (workerId: string) => parent.call('pstack_worker', { action: 'collect', runId: RUN_ID, workerId });
const abort = (workerId: string) => parent.call('pstack_worker', { action: 'abort', runId: RUN_ID, workerId });
const settled = (workerId: string) =>
  until(
    async () => (await collect(workerId)).details.settled,
    (done) => done === true,
    120_000,
    `${workerId} to settle`,
  );
const printed = (workerId: string) =>
  transcript(project, RUN_ID, workerId)
    .filter((line) => line.startsWith('assistant:RESULTS:'))
    .join('\n');
const sessionOf = (workerId: string) => tmuxSessionName(project.dir, RUN_ID as never, workerId as never);

beforeAll(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-forge-')));
  project = makeProject('pstack-forge-');
  bare = join(base, 'o', 'r.git');
  mkdirSync(dirname(bare), { recursive: true });
  git(base, 'init', '--quiet', '--bare', '-b', 'main', bare);
  git(project.dir, 'push', '--quiet', bare, 'main');
  server = await startGitServer(base, mkdtempSync(join(base, 'tls-')), TOKEN, HOST);
  git(project.dir, 'remote', 'add', 'origin', remoteUrl());
  makeRun(project, RUN_ID);
  entries = [];
  parent = makeContainerParent();
  await parent.start();
}, 120_000);

afterAll(async () => {
  await parent?.stop();
  await server?.close();
  if (project !== undefined) await stopProject(project);
  const left = (await docker('ps', '--all', '--quiet', '--filter', `label=pstack.run=${RUN_ID}`)).split('\n').filter(Boolean);
  if (left.length > 0) await docker('rm', '--force', ...left);
  await killTmuxServer();
}, 120_000);

const remoteUrl = () => `https://${HOST}:${server.port}/o/r.git`;
/** The https remote's certificate is the test's own, so the worker's image is the default one plus that certificate. */
function trustTestCertificate(): void {
  mkdirSync(join(project.dir, '.pi'), { recursive: true });
  copyFileSync(server.cert, join(project.dir, '.pi', 'cert.pem'));
  writeFileSync(join(project.dir, '.pi', 'Dockerfile'), `FROM ${DEFAULT_IMAGE_TAG}\nCOPY cert.pem /usr/local/share/ca-certificates/pstack-test.crt\nRUN update-ca-certificates\n`);
  writeFileSync(join(project.dir, '.pi', 'environment.json'), JSON.stringify({ build: { dockerfile: 'Dockerfile' } }));
}

test.each([false, true])('minimal container drops ambient credentials with forge=%s', async (forge) => {
  trustTestCertificate();
  const names = ['PSTACK_CONTAINER_FORGE_TOKEN', 'PSTACK_OTHER_SECRET', 'PSTACK_OPAQUE', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'SSH_AUTH_SOCK', 'GITHUB_TOKEN'];
  const owner = makeContainerParent(Object.fromEntries(names.filter((name) => name !== 'PSTACK_CONTAINER_FORGE_TOKEN').map((name) => [name, 'host-only-sentinel'])));
  const workerId = forge ? 'scoped-forge' : 'scoped-plain';
  await owner.start();
  try {
    const script = `const initial=Object.fromEntries(require('node:fs').readFileSync('/proc/self/environ','utf8').split('\\0').filter(Boolean).map(entry=>{const i=entry.indexOf('=');return [entry.slice(0,i),entry.slice(i+1)];})); console.log(JSON.stringify({present:${JSON.stringify(names)}.filter(name=>Object.hasOwn(initial,name)),forge:!!initial.GH_TOKEN,worker:initial.PSTACK_WORKER,depth:initial.PSTACK_DEPTH}));`;
    await spawn(workerId, `node -e ${JSON.stringify(script)}`, { capabilities: { mcp: 'none', env: 'minimal', externalWrite: false, forge } }, owner);
    await until(async () => (await owner.call('pstack_worker', { action: 'collect', runId: RUN_ID, workerId })).details.settled, (done) => done === true, 120_000, `${workerId} to settle`);
    expect(printed(workerId)).toContain(JSON.stringify({ present: [], forge, worker: '1', depth: '2' }));
  } finally {
    await owner.call('pstack_worker', { action: 'abort', runId: RUN_ID, workerId });
    await owner.stop();
  }
}, 240_000);

describe('the default environment', () => {
  test('ships gh, and holds no forge token when the assignment does not ask for one', async () => {
    git(project.dir, 'remote', 'set-url', 'origin', bare);
    try {
      await spawn('plain', `gh --version | head -1; printf 'TOKEN=[%s]\\n' "$GH_TOKEN"`);
      await settled('plain');
    } finally {
      git(project.dir, 'remote', 'set-url', 'origin', remoteUrl());
    }

    expect(printed('plain')).toMatch(/gh version 2\.103\.3 /);
    expect(printed('plain')).toContain('TOKEN=[]');
    await abort('plain');
  }, 240_000);

  test('cannot push without a forge token: the server refuses the unauthenticated push', async () => {
    trustTestCertificate();
    const command = `echo one > one.txt && git add one.txt && git -c user.name=c -c user.email=c@c commit -qm one && git push origin HEAD:refs/heads/no-token 2>&1 | tail -3; echo done`;
    await spawn('nopush', command);
    await settled('nopush');

    expect(printed('nopush')).toMatch(/401|Authentication failed|could not read Username/i);
    expect(() => git(bare, 'rev-parse', '--verify', 'refs/heads/no-token')).toThrow();
    await abort('nopush');
  }, 240_000);
});

describe('a container worker with the forge capability', () => {
  test('gets the token under GH_TOKEN, runs gh against it, and pushes over https; the token is nowhere an engine or the host shows it', async () => {
    trustTestCertificate();
    const command = [
      'gh auth status 2>&1 | head -4',
      `printf 'TOKEN-IN-ENV=%s\\n' "$GH_TOKEN"`,
      'echo two > two.txt && git add two.txt && git -c user.name=c -c user.email=c@c commit -qm two',
      'git push origin HEAD:refs/heads/with-token 2>&1 | tail -2',
      'git rev-parse HEAD',
    ].join(' ; ');
    await spawn('forge', command, { capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } });
    await settled('forge');

    const out = printed('forge');
    expect(out).toMatch(/\(GH_TOKEN\)/);
    expect(out).toContain(`TOKEN-IN-ENV=${TOKEN}`);
    const pushed = git(bare, 'rev-parse', '--verify', 'refs/heads/with-token');
    expect(out).toContain(pushed);
    expect(server.pushes.some((header) => header === `Basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`)).toBe(true);
    const name = sessionOf('forge');
    const config = await docker('inspect', '--format', '{{json .Config}}', name);
    expect(config).not.toContain(TOKEN);
    expect(await docker('image', 'inspect', await docker('inspect', '--format', '{{.Image}}', name))).not.toContain(TOKEN);
    expect((await run('ps', ['-ww', '-eo', 'args'], { maxBuffer: 64 << 20 })).stdout).not.toContain(TOKEN);
    expect(existsSync(join(workerDir(project, RUN_ID, 'forge'), 'claim', 'launch-env.json'))).toBe(false);
    await abort('forge');
  }, 240_000);
});

describe('a forge worker that cannot be given forge access', () => {
  const forge = { capabilities: { mcp: 'inherit', env: 'minimal', externalWrite: false, forge: true } };
  const noClaim = (workerId: string) => expect(existsSync(join(workerDir(project, RUN_ID, workerId), 'claim'))).toBe(false);

  /** A PATH holding only docker and git, so there is no gh to read a login from. */
  function pathWithout(...omit: string[]): string {
    const dir = mkdtempSync(join(base, 'bin-'));
    for (const tool of ['docker', 'git', 'sh', 'node']) {
      if (omit.includes(tool)) continue;
      symlinkSync(execFileSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).trim(), join(dir, tool));
    }
    return dir;
  }

  test('fails at spawn with ForgeUnavailable when neither a token nor gh is available', async () => {
    const bare = makeContainerParent({ PSTACK_CONTAINER_FORGE_TOKEN: '', PATH: pathWithout() });
    await bare.start();

    await expect(spawn('no-gh', 'true', forge, bare)).rejects.toThrow(/ForgeUnavailable: .*no `gh` on PATH/);

    noClaim('no-gh');
    await bare.stop();
  });

  test('fails at spawn with ForgeUnavailable when gh has no login', async () => {
    const empty = mkdtempSync(join(base, 'gh-config-'));
    const logged = join(base, 'fake-bin');
    mkdirSync(logged);
    writeFileSync(join(logged, 'gh'), '#!/bin/sh\necho "no oauth token found for github.com" >&2\nexit 1\n');
    chmodSync(join(logged, 'gh'), 0o755);
    const nobody = makeContainerParent({ PSTACK_CONTAINER_FORGE_TOKEN: '', GH_CONFIG_DIR: empty, PATH: `${logged}:${pathWithout()}` });
    await nobody.start();

    await expect(spawn('no-login', 'true', forge, nobody)).rejects.toThrow(/ForgeUnavailable: .*`gh auth token` gave none \(no oauth token found/);

    noClaim('no-login');
    await nobody.stop();
  });

  test('fails at spawn with ForgeUnavailable when the project image has no gh', async () => {
    mkdirSync(join(project.dir, '.pi'), { recursive: true });
    writeFileSync(join(project.dir, '.pi', 'environment.json'), JSON.stringify({ image: 'node:24-bookworm' }));

    await expect(spawn('image-no-gh', 'true', forge)).rejects.toThrow(/ForgeUnavailable: the image node:24-bookworm has no `gh`/);

    noClaim('image-no-gh');
    writeFileSync(join(project.dir, '.pi', 'environment.json'), '{}');
  }, 240_000);

  test('is refused for a worktree worker, which already runs as the operator', async () => {
    await expect(spawn('wt', 'true', { ...forge, workspace: { mode: 'worktree', inputCommit: project.commit } })).rejects.toThrow(/capabilities\.forge needs a container workspace/);
  });
});
