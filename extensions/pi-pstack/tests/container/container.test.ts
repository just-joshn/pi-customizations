// Container workers on a real engine: real Pi (the scripted model) runs inside the container, started by the real tmux host.
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { tmuxSessionName } from '../../src/run-files.ts';
import {
  type Entry,
  killTmuxServer,
  liveTmuxSessions,
  makeParent,
  makeProject,
  makeRun,
  type Parent,
  PI,
  type Project,
  readState,
  stopProject,
  transcript,
  until,
  wakes,
  workerDir,
  workerTestEnv,
  writeAssignment,
} from '../worker-lifecycle/harness.ts';

const run = promisify(execFile);

// The merge gate isolates HOME, which hides a docker context (OrbStack, Colima), so the engine is pinned here too.
function engineEnv(): Record<string, string> {
  if (process.env['DOCKER_HOST']) return { DOCKER_HOST: process.env['DOCKER_HOST'] };
  const host = execFileSync('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { encoding: 'utf8' }).trim();
  return host === '' ? {} : { DOCKER_HOST: host };
}
const ENGINE = engineEnv();
process.env['DOCKER_HOST'] = ENGINE['DOCKER_HOST'] ?? '';
if (process.env['DOCKER_HOST'] === '') delete process.env['DOCKER_HOST'];

const docker = async (...args: string[]) => (await run('docker', args)).stdout.trim();

/** Pi's JS entry beside the managed launcher the lifecycle tests run, which is what a container mounts. */
function piEntry(): string {
  const override = process.env['PSTACK_E2E_PI_ENTRY'];
  if (override) return override;
  const agent = dirname(dirname(PI));
  const version = readFileSync(join(agent, 'install', 'current-version'), 'utf8').trim();
  return join(agent, 'install', 'releases', version, 'node_modules', '.bin', 'pi');
}

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const RUN_ID = `ctr-${randomBytes(3).toString('hex')}`;
const SECRET = `s3cret-${randomBytes(12).toString('hex')}`;

let project: Project;
let remote: string;
let entries: Entry[];
let parent: Parent;

/** A parent whose workers get the isolated test home and the pinned engine, and whose credential reaches them only through the launch snapshot. */
const makeContainerParent = (extraEnv: Record<string, string> = {}) => makeParent(project, entries, { containerPi: piEntry(), extraEnv: { ...workerTestEnv(project), ...ENGINE, ...extraEnv } });

const spawn = (workerId: string, brief: string, fields: Record<string, unknown> = {}, inputCommit = project.commit) =>
  parent.call('pstack_worker', { action: 'spawn', runId: RUN_ID, assignmentPath: writeAssignment(project, RUN_ID, workerId, brief, { workspace: { mode: 'container', inputCommit }, ...fields }) });
const collect = (workerId: string) => parent.call('pstack_worker', { action: 'collect', runId: RUN_ID, workerId });
const abort = (workerId: string) => parent.call('pstack_worker', { action: 'abort', runId: RUN_ID, workerId });
const sessionOf = (workerId: string) => tmuxSessionName(project.dir, RUN_ID as never, workerId as never);
const containersOf = (workerId: string) => docker('ps', '--all', '--quiet', '--filter', `label=pstack.worker=${sessionOf(workerId)}`).then((out) => out.split('\n').filter(Boolean));
const settled = (workerId: string) =>
  until(
    async () => (await collect(workerId)).details.settled,
    (done) => done === true,
    90_000,
    `${workerId} to settle`,
  );

beforeAll(async () => {
  project = makeProject('pstack-u10-');
  remote = join(dirname(project.dir), 'remote.git');
  git(dirname(project.dir), 'init', '--quiet', '--bare', '-b', 'main', remote);
  git(project.dir, 'remote', 'add', 'origin', remote);
  git(project.dir, 'push', '--quiet', 'origin', 'main');
  makeRun(project, RUN_ID);
  entries = [];
}, 120_000);

afterAll(async () => {
  await parent?.stop();
  if (project !== undefined) await stopProject(project);
  const left = (await docker('ps', '--all', '--quiet', '--filter', `label=pstack.run=${RUN_ID}`)).split('\n').filter(Boolean);
  if (left.length > 0) await docker('rm', '--force', ...left);
  await killTmuxServer();
}, 120_000);

describe('a container worker', () => {
  let outcome: string[];
  let image: string;

  beforeAll(async () => {
    mkdirSync(join(project.dir, '.pi'), { recursive: true });
    writeFileSync(join(project.dir, '.pi', 'Dockerfile'), 'FROM node:24-bookworm\nRUN echo from-the-built-image > /etc/pstack-environment\n');
    writeFileSync(join(project.dir, '.pi', 'environment.json'), JSON.stringify({ build: { dockerfile: 'Dockerfile' }, install: 'echo installed-by-environment > .pstack-installed' }));
    parent = makeContainerParent({ PSTACK_TEST_CREDENTIAL: SECRET });
    await parent.start();
    const dir = workerDir(project, RUN_ID, 'a');
    // The worker prints facts about its own world. Its brief is one scripted bash call.
    const facts = [
      'pwd',
      'git rev-parse HEAD',
      'git branch --show-current',
      'echo written-in-container > container-only.txt',
      'git status --short',
      'printenv PSTACK_TEST_CREDENTIAL',
      `(test -e ${project.dir}/README.md && echo HOST-CHECKOUT-VISIBLE || echo HOST-CHECKOUT-HIDDEN)`,
      'cat /etc/pstack-environment',
      'cat .pstack-installed',
      'id -u',
      'grep CapEff /proc/self/status',
      '(test -e /var/run/docker.sock && echo ENGINE-SOCKET-VISIBLE || echo ENGINE-SOCKET-HIDDEN)',
    ];
    const command = [...facts, `echo report-from-container > ${dir}/report.md`, `echo evidence-from-container > ${dir}/evidence/check.txt`].join(' ; ');
    await spawn('a', `@@script ${JSON.stringify([{ tool: 'bash', args: { command } }])}`, { capabilities: { mcp: 'none', env: 'inherit', externalWrite: false } });
    await settled('a');
    const text = transcript(project, RUN_ID, 'a')
      .filter((line) => line.startsWith('assistant:RESULTS:'))
      .join('\n');
    outcome = text.split('\n').map((line) => line.replace(/^assistant:RESULTS:\n?/, '').replace(/^\[bash\] /, ''));
    image = await docker('inspect', '--format', '{{.Image}}', sessionOf('a'));
  }, 240_000);

  test('runs a scripted prompt through the real host and settles, collectable with its report and evidence', async () => {
    const result = await collect('a');

    expect(result.details).toMatchObject({ settled: true, available: true, phase: 'idle', lastSettle: { phase: 'idle' } });
    expect(result.details.report).toBe('report-from-container\n');
    expect(result.details.evidence).toEqual(['check.txt']);
    expect(result.details.finalText).toContain('RESULTS:');
    await until(
      () => wakes(parent).map((wake) => wake?.phase),
      (phases) => phases.length === 1,
      10_000,
      'settle wake',
    );
    expect(wakes(parent).map((wake) => wake?.phase)).toEqual(['idle']);
    expect(await liveTmuxSessions()).toContain(sessionOf('a'));
  });

  test('works in a fresh clone at inputCommit, on its own branch, and leaves the host checkout untouched', () => {
    expect(outcome).toContain('/tmp/workspace');
    expect(outcome).toContain(project.commit);
    expect(outcome).toContain(`pstack-run/${RUN_ID}/a`);
    expect(outcome).toContain('?? container-only.txt');
    expect(outcome).toContain('HOST-CHECKOUT-HIDDEN');
    expect(existsSync(join(project.dir, 'container-only.txt'))).toBe(false);
    expect(git(project.dir, 'status', '--porcelain', '--', ':!.pi')).toBe('');
    expect(git(project.dir, 'rev-parse', 'HEAD')).toBe(project.commit);
  });

  test('uses the image the environment file builds and runs its install command', () => {
    expect(outcome).toContain('from-the-built-image');
    expect(outcome).toContain('installed-by-environment');
  });

  test('receives a credential from the launch snapshot, and the credential is nowhere an engine or the host shows it', async () => {
    expect(outcome).toContain(SECRET);

    const name = sessionOf('a');
    const config = await docker('inspect', '--format', '{{json .Config}}', name);
    const parsed = JSON.parse(config) as { Env: string[]; Cmd: string[]; Entrypoint: string[] };
    expect(parsed.Cmd.join(' ')).toContain('--mode');
    expect(config).not.toContain(SECRET);
    expect(JSON.stringify(parsed.Env)).not.toContain(SECRET);
    expect(await docker('image', 'inspect', image)).not.toContain(SECRET);
    expect(await docker('history', '--no-trunc', image)).not.toContain(SECRET);
    expect((await run('ps', ['-ww', '-eo', 'args'], { maxBuffer: 64 << 20 })).stdout).not.toContain(SECRET);
    expect(await liveTmuxSessions()).toContain(name);
  });

  test('runs unprivileged: the host uid, no capabilities, and no engine socket', () => {
    expect(outcome).toContain(String(process.getuid?.()));
    expect(outcome).toContain('CapEff:\t0000000000000000');
    expect(outcome).toContain('ENGINE-SOCKET-HIDDEN');
  });

  test('files the container creates in its output mount belong to the host user', () => {
    const dir = workerDir(project, RUN_ID, 'a');
    expect(outcome).toContain(String(process.getuid?.()));
    for (const path of [join(dir, 'out', 'report.md'), join(dir, 'out', 'evidence', 'check.txt'), join(dir, 'out', 'session')]) expect(statSync(path).uid).toBe(process.getuid?.());
  });

  test('is labelled so pstack finds its own container, and abort removes it', async () => {
    const [id] = await containersOf('a');
    expect(id).toBeDefined();
    expect(await docker('inspect', '--format', '{{index .Config.Labels "pstack.worker"}} {{index .Config.Labels "pstack.run"}}', id as string)).toBe(`${sessionOf('a')} ${RUN_ID}`);

    const receipt = await abort('a');

    expect(receipt.details.disposition).toBe('stopped');
    expect(await containersOf('a')).toEqual([]);
    expect(await liveTmuxSessions()).not.toContain(sessionOf('a'));
  });
});

describe('a container worker that cannot start', () => {
  test('ContainerUnavailable when no engine answers, with no claim left', async () => {
    const offline = makeContainerParent({ DOCKER_HOST: 'unix:///nonexistent/pstack-test-docker.sock' });
    await offline.start();

    await expect(
      offline.call('pstack_worker', {
        action: 'spawn',
        runId: RUN_ID,
        assignmentPath: writeAssignment(project, RUN_ID, 'offline', '@@say NEVER', { workspace: { mode: 'container', inputCommit: project.commit } }),
      }),
    ).rejects.toThrow(/ContainerUnavailable: no container engine answers/);

    expect(existsSync(join(workerDir(project, RUN_ID, 'offline'), 'claim'))).toBe(false);
    expect(await containersOf('offline')).toEqual([]);
    await offline.stop();
  });

  test('an inputCommit that is not on the remote is refused before any container exists, with no claim left', async () => {
    git(project.dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'local only');
    const unpushed = git(project.dir, 'rev-parse', 'HEAD');

    await expect(spawn('unpushed', '@@say NEVER', {}, unpushed)).rejects.toThrow(new RegExp(`inputCommit ${unpushed} is not on the remote origin`));

    expect(existsSync(join(workerDir(project, RUN_ID, 'unpushed'), 'claim'))).toBe(false);
    expect(await containersOf('unpushed')).toEqual([]);
  });

  test('a malformed .pi/environment.json fails the spawn instead of being ignored', async () => {
    writeFileSync(join(project.dir, '.pi', 'environment.json'), JSON.stringify({ image: 'node:24-bookworm', start: 'npm start' }));

    await expect(spawn('badenv', '@@say NEVER')).rejects.toThrow(/unsupported field start/);

    expect(existsSync(join(workerDir(project, RUN_ID, 'badenv'), 'claim'))).toBe(false);
  });
});

describe('a container worker whose environment would hand it the checkout', () => {
  test.each([
    ['is the checkout itself', () => project.dir],
    ['lies inside the checkout', () => join(project.dir, 'nested.git')],
    ['contains the checkout', () => dirname(project.dir)],
  ])('a local remote that %s is refused before any claim, and the remote is untouched', async (_name, remoteUrl) => {
    const target = remoteUrl();
    if (target.endsWith('nested.git')) git(dirname(project.dir), 'init', '--quiet', '--bare', '-b', 'main', target);
    git(project.dir, 'remote', 'set-url', 'origin', target);
    try {
      await expect(spawn('hand-over', '@@say NEVER')).rejects.toThrow(/is, contains, or lies inside the project checkout/);
    } finally {
      git(project.dir, 'remote', 'set-url', 'origin', remote);
    }

    expect(existsSync(join(workerDir(project, RUN_ID, 'hand-over'), 'claim'))).toBe(false);
    expect(await containersOf('hand-over')).toEqual([]);
  });

  test('a build context outside the project is refused before any claim', async () => {
    writeFileSync(join(project.dir, '.pi', 'environment.json'), JSON.stringify({ build: { dockerfile: 'Dockerfile', context: '../..' } }));

    await expect(spawn('wide-context', '@@say NEVER')).rejects.toThrow(/build\.context .* is outside the project/);

    expect(existsSync(join(workerDir(project, RUN_ID, 'wide-context'), 'claim'))).toBe(false);
  });
});

describe('a container worker that points its outputs at host files', () => {
  test('collect refuses a report, evidence directory, or session path that leaves its output directory', async () => {
    const dir = workerDir(project, RUN_ID, 'd');
    // The links are made in the container, where the target path is only a string; the host would follow it to the real file.
    const command = [`ln -sf ${project.dir}/README.md ${dir}/report.md`, `rm -rf ${dir}/evidence`, `ln -s ${project.dir} ${dir}/evidence`].join(' && ');
    writeFileSync(join(project.dir, '.pi', 'environment.json'), '{}');
    await spawn('d', `@@script ${JSON.stringify([{ tool: 'bash', args: { command } }])}`);
    await settled('d');

    const result = await collect('d');

    expect(result.details.report).toBe('(refused: report.md leaves the worker output directory)');
    expect(result.details.evidence).toEqual([]);
    expect(result.text).not.toContain('fixture');
    await abort('d');
  }, 180_000);
});

describe('a container whose host dies without cleaning up', () => {
  test('ends with its stdin, so no container outlives the host', async () => {
    writeFileSync(join(project.dir, '.pi', 'environment.json'), '{}');
    await spawn('c', '@@say ALIVE');
    await settled('c');
    expect(await containersOf('c')).toHaveLength(1);

    process.kill(readState(project, RUN_ID, 'c').hostPid, 'SIGKILL');

    await until(
      () => containersOf('c'),
      (ids) => ids.length === 0,
      60_000,
      'the orphaned container to end',
    );
  }, 180_000);
});

describe('the default environment', () => {
  test('runs the default image and loads the pstack extension in the worker, and an abort leaves nothing behind', async () => {
    writeFileSync(join(project.dir, '.pi', 'environment.json'), '{}');
    await spawn('b', '@@tools-list');
    await settled('b');

    expect(transcript(project, RUN_ID, 'b').at(-1)).toMatch(/^assistant:.*pstack_evidence/);
    expect(await docker('inspect', '--format', '{{.Config.Image}}', sessionOf('b'))).toMatch(/^sha256:/);
    expect(await docker('inspect', '--format', '{{index .Config.Labels "pstack.worker"}}', sessionOf('b'))).toBe(sessionOf('b'));

    await abort('b');

    expect(await containersOf('b')).toEqual([]);
    expect(await docker('ps', '--all', '--quiet', '--filter', `label=pstack.run=${RUN_ID}`)).toBe('');
  }, 180_000);
});
