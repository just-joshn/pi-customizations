import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type ContainerPolicy, contained, detectRuntime, ensureImage, IMAGE_ENV, imageTag, type Mount, mountsForPolicy, piInstallRoot, reapArgv } from '../src/container.ts';

const AGENT = '/home/u/.pi/agent';
const JOBS = `${AGENT}/pstack-v2/jobs`;

const policy = (overrides: Partial<ContainerPolicy> = {}): ContainerPolicy => ({
  writable: [],
  protect: [],
  guardFiles: [],
  checkouts: [],
  gitDirs: [],
  agentDir: AGENT,
  credsDir: `${JOBS}/j/agent/creds`,
  jobDir: `${JOBS}/j`,
  cwd: '/work/repo',
  name: 'pstack-j',
  cidFile: `${JOBS}/j/cid`,
  readonly: false,
  network: 'default',
  ...overrides,
});

const rw = (path: string): Mount => ({ path, readonly: false });
const ro = (path: string): Mount => ({ path, readonly: true });
const jobOwn = (dir: string): string[] => [`${dir}/session`, `${dir}/nested`, `${dir}/tmp`, `${dir}/agent`];

describe('mountsForPolicy', () => {
  test('a readonly worker reads its checkout and the Pi tree, and writes only its own session, nested, temp, and agent directories', () => {
    const mounts = mountsForPolicy(
      // The writable checkout and git directory are dropped, whatever built the policy.
      policy({ readonly: true, writable: [...jobOwn(`${JOBS}/j`), '/work/repo', '/work/repo/.git'], protect: ['/work/repo/.git/hooks'], gitDirs: ['/work/repo/.git'], checkouts: ['/work/repo'] }),
      ['/opt/pi'],
    );
    expect(mounts).toEqual([ro('/opt/pi'), ro('/work/repo'), ro(AGENT), rw(`${JOBS}/j/session`), rw(`${JOBS}/j/nested`), rw(`${JOBS}/j/tmp`), rw(`${JOBS}/j/agent`)]);
  });

  test('a full writer writes its checkout with the code paths and the other worktrees and submodules read-only on top', () => {
    const mounts = mountsForPolicy(
      policy({
        writable: [...jobOwn(`${JOBS}/j`), '/work/repo'],
        protect: ['/work/repo/.git/hooks', '/work/repo/.git/info', '/work/repo/.pi/extensions', '/elsewhere/not-writable'],
        gitDirs: ['/work/repo/.git'],
      }),
      ['/opt/pi'],
    );
    expect(mounts).toEqual([
      ro('/opt/pi'),
      rw('/work/repo'),
      ro(AGENT),
      ro('/work/repo/.git/hooks'),
      ro('/work/repo/.git/info'),
      ro('/work/repo/.pi/extensions'),
      ro('/work/repo/.git/worktrees'),
      ro('/work/repo/.git/modules'),
      rw(`${JOBS}/j/session`),
      rw(`${JOBS}/j/nested`),
      rw(`${JOBS}/j/tmp`),
      rw(`${JOBS}/j/agent`),
    ]);
  });

  test('a brokered worktree grant writes the worktree and its own git directory inside the read-only worktrees directory, and shares only the credentials', () => {
    const top = `${JOBS}/top`;
    const out = `${top}/brokered/h`;
    const mounts = mountsForPolicy(
      policy({
        jobDir: `${top}/nested/req`,
        credsDir: `${top}/agent/creds`,
        cwd: `${out}/worktree`,
        writable: [`${out}/worktree`, '/work/repo/.git', '/work/repo/.git/worktrees/wt', `${out}/agent`, `${top}/nested/req/session`, `${top}/nested/req/tmp`],
        protect: ['/work/repo/.git/hooks', '/work/repo/.git/info'],
        gitDirs: ['/work/repo/.git'],
      }),
      [],
    );
    expect(mounts).toEqual([
      rw('/work/repo/.git'),
      ro(AGENT),
      ro('/work/repo/.git/hooks'),
      ro('/work/repo/.git/info'),
      ro('/work/repo/.git/worktrees'),
      ro('/work/repo/.git/modules'),
      rw('/work/repo/.git/worktrees/wt'),
      rw(`${top}/agent/creds`),
      rw(`${out}/worktree`),
      rw(`${out}/agent`),
      rw(`${top}/nested/req/session`),
      rw(`${top}/nested/req/tmp`),
    ]);
  });

  test('a read-only mount sits on a writable one only when nothing of the other mode lies between, and a deeper mount always follows its parent', () => {
    const mounts = mountsForPolicy(
      policy({
        writable: [...jobOwn(`${JOBS}/j`), '/work/repo', '/work/repo/sub', `${JOBS}/j/tmp/x`],
        protect: ['/work/repo/sub/.pi/npm', `${JOBS}/j/tmp/x/frozen`],
        gitDirs: ['/work/repo/.git'],
      }),
      [],
    );
    // /work/repo/sub adds nothing to /work/repo, but the read-only directory under the writable one under agentDir stays.
    expect(mounts.map(({ path }) => path)).not.toContain('/work/repo/sub');
    expect(mounts).toEqual(expect.arrayContaining([ro(`${JOBS}/j/tmp/x/frozen`), ro('/work/repo/sub/.pi/npm')]));
    mounts.forEach((mount, index) => {
      const earlier = mounts.slice(0, index).filter((other) => other.path.startsWith(`${mount.path}/`));
      expect(earlier).toEqual([]);
    });
  });

  test('the same path asked for in both modes is mounted read-only', () => {
    expect(mountsForPolicy(policy({ writable: ['/work/repo'], protect: ['/work/repo'] }), []).filter((mount) => mount.path === '/work/repo')).toEqual([ro('/work/repo')]);
  });
});

describe('contained', () => {
  const runtime = (bin: 'container' | 'podman' | 'docker') => ({ bin, image: 'img:1' });
  const options = { env: { PSTACK_V2_CONTAINED: '1', TMPDIR: `${JOBS}/j/tmp` }, readonlyMounts: ['/opt/pi'], user: '501:20', cpus: 4, memory: '8G', top: `${JOBS}/top` };
  const full = policy({ writable: [...jobOwn(`${JOBS}/j`), '/work/repo'], protect: ['/work/repo/.git/hooks'], gitDirs: ['/work/repo/.git'] });
  const base = (bin: string, extra: string[] = []): string[] => [
    bin,
    'run',
    ...(bin === 'container' ? ['--progress', 'none'] : []),
    '--rm',
    '--init',
    '--name',
    'pstack-j',
    '--cidfile',
    `${JOBS}/j/cid`,
    '--label',
    'pstack.job=pstack-j',
    '--label',
    expect.stringMatching(/^pstack\.top=[0-9a-f]{16}$/) as unknown as string,
    '--cap-drop',
    'ALL',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/run',
    '--user',
    '501:20',
    ...extra,
    '--cpus',
    '4',
    '--memory',
    '8G',
    '-w',
    '/work/repo',
    ...[
      ['/opt/pi', 'readonly'],
      ['/work/repo', ''],
      [AGENT, 'readonly'],
      ['/work/repo/.git/hooks', 'readonly'],
      ['/work/repo/.git/worktrees', 'readonly'],
      ['/work/repo/.git/modules', 'readonly'],
      [`${JOBS}/j/session`, ''],
      [`${JOBS}/j/nested`, ''],
      [`${JOBS}/j/tmp`, ''],
      [`${JOBS}/j/agent`, ''],
    ].flatMap(([path, mode]) => ['--mount', `type=bind,source=${path},target=${path}${mode ? `,${mode}` : ''}`]),
    '-e',
    'PSTACK_V2_CONTAINED=1',
    '-e',
    `TMPDIR=${JOBS}/j/tmp`,
    'img:1',
    'node',
    '/opt/pi/cli.js',
  ];

  test('Apple container gets the shared flags, one bind mount per directory, the environment, the image, and the guest argv', () => {
    expect(contained(['node', '/opt/pi/cli.js'], full, runtime('container'), options)).toEqual({ argv: base('container'), bin: 'container', name: 'pstack-j', cidfile: `${JOBS}/j/cid` });
  });

  test('podman keeps the user ID, and docker refuses new privileges', () => {
    expect(contained(['node', '/opt/pi/cli.js'], full, runtime('podman'), options).argv).toEqual(base('podman', ['--userns=keep-id']));
    expect(contained(['node', '/opt/pi/cli.js'], full, runtime('docker'), options).argv).toEqual(base('docker', ['--security-opt', 'no-new-privileges']));
  });

  test('no mount takes a file, a socket, or the home directory, and the network is the default one unless the policy says none', () => {
    const { argv } = contained(['true'], full, runtime('docker'), options);
    const sources = argv.filter((arg) => arg.startsWith('type=bind,')).map((arg) => /source=([^,]+)/.exec(arg)?.[1]);
    expect(sources).not.toContain('/home/u');
    expect(sources.filter((source) => /\.sock$|docker|\.json$/.test(source ?? ''))).toEqual([]);
    expect(argv).not.toContain('--network');
    expect(contained(['true'], { ...full, network: 'none' }, runtime('docker'), options).argv).toEqual(expect.arrayContaining(['--network', 'none']));
  });

  test('every mount source is a directory, since Apple container refuses a file bind', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-container-')));
    try {
      mkdirSync(join(dir, 'repo', '.git'), { recursive: true });
      writeFileSync(join(dir, 'repo', '.git', 'config'), '');
      // The git directories a mount needs to land on are created empty beside the files that cannot be mounted.
      contained(['true'], policy({ cwd: join(dir, 'repo'), writable: [join(dir, 'repo')], gitDirs: [join(dir, 'repo', '.git')] }), runtime('docker'), { readonlyMounts: [] });
      for (const name of ['hooks', 'info', 'worktrees', 'modules']) expect(existsSync(join(dir, 'repo', '.git', name))).toBe(true);
      expect(readFileSync(join(dir, 'repo', '.git', 'config'), 'utf8')).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('piInstallRoot', () => {
  test('a flat install mounts its node_modules, and a nested one mounts the outermost, which holds the dependencies it links to', () => {
    expect(piInstallRoot('/opt/pi/node_modules/@scope/pi/dist/cli.js')).toBe('/opt/pi/node_modules');
    expect(piInstallRoot('/repo/node_modules/.bun/@scope+pi@1/node_modules/@scope/pi/dist/cli.js')).toBe('/repo/node_modules');
    expect(piInstallRoot('/opt/pi/cli.js')).toBe('/opt/pi');
  });
});

describe('detectRuntime', () => {
  let bin: string;

  beforeEach(() => {
    bin = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-bin-')));
  });

  afterEach(() => {
    rmSync(bin, { recursive: true, force: true });
  });

  const fake = (name: string, script: string): void => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, name), 0o755);
  };

  test('macOS without Apple container refuses, with the install step', () => {
    expect(() => detectRuntime('darwin', { PATH: '/nonexistent' })).toThrow(/found no `container` command.*container system start/s);
  });

  test('macOS with the container system stopped refuses and says how to start it', () => {
    fake('container', 'exit 1');
    expect(() => detectRuntime('darwin', { PATH: bin })).toThrow(/system is not running.*container system start/s);
  });

  test('macOS with the container system running uses it, and an image named in the environment replaces the built one', () => {
    fake('container', 'exit 0');
    expect(detectRuntime('darwin', { PATH: bin })).toEqual({ bin: 'container', image: imageTag() });
    expect(detectRuntime('darwin', { PATH: bin, [IMAGE_ENV]: 'mine:2' })).toEqual({ bin: 'container', image: 'mine:2' });
  });

  test('Linux without podman or a running docker refuses, and never falls back to anything else', () => {
    expect(() => detectRuntime('linux', { PATH: '/nonexistent' })).toThrow(/neither podman nor a running docker/);
    fake('docker', 'exit 1');
    expect(() => detectRuntime('linux', { PATH: bin })).toThrow(/neither podman nor a running docker/);
  });

  test('Linux prefers podman, and uses docker only when it answers', () => {
    fake('docker', 'exit 0');
    expect(detectRuntime('linux', { PATH: bin }).bin).toBe('docker');
    const both = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-bin-')));
    try {
      for (const name of ['docker', 'podman']) {
        writeFileSync(join(both, name), '#!/bin/sh\nexit 0\n');
        chmodSync(join(both, name), 0o755);
      }
      expect(detectRuntime('linux', { PATH: both }).bin).toBe('podman');
    } finally {
      rmSync(both, { recursive: true, force: true });
    }
  });

  test('another platform is refused', () => {
    expect(() => detectRuntime('win32', { PATH: bin })).toThrow(/win32 does not support/);
  });
});

describe('ensureImage', () => {
  let bin: string;
  let calls: string;
  const env = () => ({ PATH: `${bin}:/usr/bin:/bin` });

  beforeEach(() => {
    bin = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-bin-')));
    calls = join(bin, 'calls');
  });

  afterEach(() => {
    rmSync(bin, { recursive: true, force: true });
  });

  const fake = (inspect: number): void => {
    writeFileSync(join(bin, 'podman'), `#!/bin/sh\necho "$@" >> '${calls}'\n[ "$1 $2" = "image inspect" ] && exit ${inspect}\necho building\nexit 0\n`);
    chmodSync(join(bin, 'podman'), 0o755);
  };

  test('an image that exists is not built again', () => {
    fake(0);
    ensureImage({ bin: 'podman', image: 'img:1' }, undefined, env());
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(['image inspect img:1']);
  });

  test('a missing image is built once from the Containerfile, streaming to the log', () => {
    fake(1);
    const log = join(bin, 'build.log');
    ensureImage({ bin: 'podman', image: 'img:1' }, log, env());
    const [inspect, build] = readFileSync(calls, 'utf8').trim().split('\n');
    expect(inspect).toBe('image inspect img:1');
    expect(build).toMatch(/^build -t img:1 -f .*\/container\/Containerfile .*\/container$/);
    expect(readFileSync(log, 'utf8')).toContain('building');
  });

  test('an image named in the environment is checked and never built', () => {
    fake(1);
    expect(() => ensureImage({ bin: 'podman', image: 'mine:2' }, undefined, { ...env(), [IMAGE_ENV]: 'mine:2' })).toThrow(/names mine:2, which podman does not have/);
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(['image inspect mine:2']);
  });
});

describe('the job image and container names', () => {
  test('the Containerfile is a node 22 bookworm image that mounts in Pi and runs the job argv directly', () => {
    const file = readFileSync(new URL('../container/Containerfile', import.meta.url), 'utf8');
    expect(file).toMatch(/^FROM node:22-bookworm-slim$/m);
    expect(file).toMatch(/ENTRYPOINT \[\]/);
    for (const tool of ['git', 'ripgrep', 'jq', 'python3', 'build-essential', 'openssh-client', 'gh']) expect(file).toContain(tool);
    expect(file).not.toMatch(/\btmux\b/);
    expect(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).files).toContain('container');
  });

  test('stopping, killing, and removing a container use the runtime that started it', () => {
    expect(reapArgv('container', 'n')).toEqual({ stop: ['container', 'stop', '-t', '2', 'n'], kill: ['container', 'kill', 'n'], remove: ['container', 'delete', '--force', 'n'] });
    expect(reapArgv('podman', 'n').remove).toEqual(['podman', 'rm', '-f', 'n']);
  });
});
