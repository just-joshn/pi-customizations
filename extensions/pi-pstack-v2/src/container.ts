import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTAINED_ENV = 'PSTACK_V2_CONTAINED';
/** The job directory of the contained process. Jobs it asks the root to start are requested under its writable `nested/` directory. */
export const JOB_DIR_ENV = 'PSTACK_V2_JOB_DIR';
/** The directory of the top-level job a process descends from. Its `brokered/` directory holds what the root launched for descendants. */
export const TOP_DIR_ENV = 'PSTACK_V2_TOP_DIR';
/** Names an image to run jobs in. pstack then only checks that it exists and never builds it. */
export const IMAGE_ENV = 'PSTACK_V2_IMAGE';

export interface ContainerPolicy {
  /** Directories mounted read-write at their own host path. Only directories, never files. */
  writable: string[];
  /** Existing directories mounted read-only on top of `writable`: git hooks and info, `.pi` code directories, editor and harness directories. */
  protect: string[];
  /** Paths that cannot be mounted, because a file bind fails on Apple `container`, or that did not exist at launch. The sweep snapshots them at launch and restores or quarantines them on exit. */
  guardFiles: string[];
  /** Checkouts the job writes. Sweep inventory and quarantine roots. */
  checkouts: string[];
  /** Git common directories. `worktrees/` and `modules/` are mounted read-only, and the job's own worktree git directory, listed in `writable`, on top. */
  gitDirs: string[];
  /** Pi's real agent directory, mounted read-only so settings and extensions resolve. */
  agentDir: string;
  /** The shared credentials directory of the top-level job, the only shared read-write mount, holding `auth.json` and Pi's lock for it. */
  credsDir: string;
  jobDir: string;
  /** Working directory inside the container, the same path as on the host. */
  cwd: string;
  /** Container name, `pstack-<job id>`, so stopping and killing never derive it twice. */
  name: string;
  /** Host path for `--cidfile`. */
  cidFile: string;
  /** A readonly job writes nothing in its checkout or git directories, whatever `writable` holds. */
  readonly: boolean;
  network: 'default' | 'none';
}

export interface ContainerRuntime {
  bin: 'container' | 'podman' | 'docker';
  image: string;
}

export interface Contained {
  argv: string[];
  bin: ContainerRuntime['bin'];
  name: string;
  cidfile: string;
}

/** Every mount is a directory bound at its own host path. */
export interface Mount {
  path: string;
  readonly: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const containerfile = join(here, '..', 'container', 'Containerfile');

const isUnder = (parent: string, path: string): boolean => path === parent || path.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
const depth = (path: string): number => path.split(sep).filter(Boolean).length;
const real = (path: string): string => (existsSync(path) ? realpathSync(path) : path);
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * What a job may reach, as directory mounts. Writable paths come first, then everything read-only, and a deeper mount
 * always follows its parent so it lands on top: a read-only directory inside a writable one, and the job's own worktree
 * git directory inside the read-only `worktrees/`. A mount inside a mount of the same mode adds nothing and is dropped.
 */
export function mountsForPolicy(policy: ContainerPolicy, readonlyMounts: string[] = []): Mount[] {
  const project = [policy.cwd, ...policy.gitDirs, ...policy.checkouts];
  // A readonly job keeps no writable path in or around its checkout, however its policy was built.
  const kept = policy.readonly ? policy.writable.filter((path) => !project.some((root) => isUnder(root, path) || isUnder(path, root))) : policy.writable;
  const writable = [...new Set([...kept, policy.credsDir].filter(Boolean))];
  const writes = (path: string): boolean => writable.some((root) => isUnder(root, path));
  const gitReadonly = policy.gitDirs.flatMap((common) => (writes(common) ? [join(common, 'worktrees'), join(common, 'modules')] : [common]));
  const wanted: Mount[] = [
    ...[policy.jobDir, policy.agentDir, ...readonlyMounts].map((path) => ({ path, readonly: true })),
    // What a job reads but may not write, such as the repository of a readonly worker.
    ...(writes(policy.cwd) ? [] : [{ path: policy.cwd, readonly: true }]),
    ...writable.map((path) => ({ path, readonly: false })),
    // Only what lies in a writable directory needs protecting, and a mount needs its parent to be mounted too.
    ...[...policy.protect.filter(writes), ...gitReadonly].map((path) => ({ path, readonly: true })),
  ];
  // The same path asked for twice is mounted read-only.
  const byPath = new Map<string, Mount>();
  for (const mount of wanted) {
    const seen = byPath.get(mount.path);
    if (!seen || mount.readonly) byPath.set(mount.path, mount);
  }
  const all = [...byPath.values()].filter((mount) => mount.path !== '');
  // A mount is redundant when a parent of the same mode covers it with no mount of the other mode between them.
  const redundant = (mount: Mount): boolean =>
    all.some(
      (parent) =>
        parent.readonly === mount.readonly &&
        parent.path !== mount.path &&
        isUnder(parent.path, mount.path) &&
        !all.some((between) => between.readonly !== mount.readonly && isUnder(parent.path, between.path) && isUnder(between.path, mount.path)),
    );
  return all
    .filter((mount) => !redundant(mount))
    .map((mount, index) => ({ mount, index }))
    .sort((a, b) => depth(a.mount.path) - depth(b.mount.path) || a.index - b.index)
    .map(({ mount }) => mount);
}

const FLAGS: Record<ContainerRuntime['bin'], string[]> = { container: [], podman: ['--userns=keep-id'], docker: ['--security-opt', 'no-new-privileges'] };

export interface ContainedOptions {
  /** Environment of the job, passed with `-e`. Nothing else of the host's reaches it. */
  env?: Record<string, string>;
  /** Directories mounted read-only at their host path: the Pi install and pstack itself. */
  readonlyMounts?: string[];
  user?: string;
  cpus?: number;
  memory?: string;
  /** The top-level job's directory, labelled on the container so leftovers are found by it. */
  top?: string;
}

/**
 * The outermost `node_modules` the running Pi was installed in, which the container mounts to run the same Pi. A package
 * manager that nests installs, such as bun in `node_modules/.bun`, links a package to its dependencies in sibling
 * directories, so only the outermost directory holds them all.
 */
export function piInstallRoot(entry: string | undefined = process.argv[1]): string | undefined {
  if (!entry) return undefined;
  const file = real(entry);
  const marker = `${sep}node_modules${sep}`;
  const at = file.indexOf(marker);
  return at === -1 ? dirname(file) : file.slice(0, at + marker.length - 1);
}

/** The read-only mounts every job needs beside its policy: the Pi that runs it and the pstack package it loads. */
export const hostMounts = (): string[] => [piInstallRoot(), real(join(here, '..'))].filter((path): path is string => path !== undefined);

/** The directories git needs to exist before it can be mounted over: empty `hooks`, `info`, `worktrees`, and `modules`. */
function placeholders(policy: ContainerPolicy): void {
  for (const common of policy.gitDirs) if (existsSync(common)) for (const name of ['hooks', 'info', 'worktrees', 'modules']) mkdirSync(join(common, name), { recursive: true });
}

/**
 * Wraps argv so it runs in a container whose mounts are the policy. The container has a read-only root filesystem, no
 * capabilities, and no runtime socket, so a job cannot start a container of its own. Every host path is mounted at the
 * same path, so absolute paths in git worktrees and Pi's symlinks mean the same thing inside.
 */
export function contained(argv: string[], policy: ContainerPolicy, runtime: ContainerRuntime, options: ContainedOptions = {}): Contained {
  placeholders(policy);
  const uid = process.getuid?.() ?? 0;
  const user = options.user ?? `${uid}:${process.getgid?.() ?? 0}`;
  const mounts = mountsForPolicy(policy, options.readonlyMounts ?? hostMounts());
  const args = [
    'run',
    // Apple `container` writes pull and start progress to stderr, which would mix into the job's own output.
    ...(runtime.bin === 'container' ? ['--progress', 'none'] : []),
    '--rm',
    '--init',
    '--name',
    policy.name,
    '--cidfile',
    policy.cidFile,
    '--label',
    `pstack.job=${policy.name}`,
    ...(options.top === undefined ? [] : ['--label', `pstack.top=${hash(options.top).slice(0, 16)}`]),
    '--cap-drop',
    'ALL',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/run',
    '--user',
    user,
    ...FLAGS[runtime.bin],
    '--cpus',
    String(options.cpus ?? Math.max(1, Math.floor(cpus().length / 2))),
    '--memory',
    options.memory ?? '8G',
    ...(policy.network === 'none' ? ['--network', 'none'] : []),
    '-w',
    policy.cwd,
    ...mounts.flatMap(({ path, readonly }) => ['--mount', `type=bind,source=${path},target=${path}${readonly ? ',readonly' : ''}`]),
    ...Object.entries(options.env ?? {}).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    runtime.image,
    ...argv,
  ];
  return { argv: [runtime.bin, ...args], bin: runtime.bin, name: policy.name, cidfile: policy.cidFile };
}

const INSTALL = {
  darwin: 'On macOS install Apple `container` (https://github.com/apple/container) and start it with `container system start`.',
  linux: 'On Linux or WSL2 install Podman (preferred) or Docker.',
};

function runs(command: string, args: string[], env: NodeJS.ProcessEnv): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', env });
    return true;
  } catch {
    return false;
  }
}

const onPath = (bin: string, env: NodeJS.ProcessEnv): boolean => runs('/bin/sh', ['-c', `command -v ${bin}`], env);
const detected = new Map<string, ContainerRuntime>();

/** The tag an image built from this Containerfile carries, so changing the file builds a new one. */
export const imageTag = (): string => `pstack-v2-job:${hash(readFileSync(containerfile, 'utf8')).slice(0, 12)}`;

/**
 * The container runtime jobs run in: Apple `container` on macOS, Podman and then Docker on Linux. Without one, nothing
 * starts, since no job may run outside a container.
 */
export function detectRuntime(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): ContainerRuntime {
  const key = `${platform}:${env['PATH'] ?? ''}:${env[IMAGE_ENV] ?? ''}`;
  const known = detected.get(key);
  if (known) return known;
  const image = env[IMAGE_ENV] || imageTag();
  let bin: ContainerRuntime['bin'] | undefined;
  if (platform === 'darwin') {
    if (!onPath('container', env)) throw new Error(`pstack runs every job in a container and found no \`container\` command on PATH. ${INSTALL.darwin}`);
    if (!runs('container', ['system', 'status'], env)) throw new Error(`pstack runs every job in a container, and Apple \`container\` is installed but its system is not running. Start it with \`container system start\`.`);
    bin = 'container';
  } else if (platform === 'linux') {
    bin = onPath('podman', env) ? 'podman' : onPath('docker', env) && runs('docker', ['info'], env) ? 'docker' : undefined;
    if (!bin) throw new Error(`pstack runs every job in a container and found neither podman nor a running docker. ${INSTALL.linux}`);
  } else {
    throw new Error(`pstack runs every job in a container, which ${platform} does not support. Use macOS with Apple \`container\`, or Linux or WSL2 with Podman or Docker.`);
  }
  const runtime = { bin, image };
  detected.set(key, runtime);
  return runtime;
}

/**
 * Makes sure the job image exists. It is built from the Containerfile once, streaming the build to `log`, and never
 * pulled per job. An image named through PSTACK_V2_IMAGE is only checked, never built.
 */
export function ensureImage(runtime: ContainerRuntime, log?: string, env: NodeJS.ProcessEnv = process.env): void {
  if (runs(runtime.bin, ['image', 'inspect', runtime.image], env)) return;
  if (env[IMAGE_ENV]) throw new Error(`${IMAGE_ENV} names ${runtime.image}, which ${runtime.bin} does not have. Build or pull it first.`);
  const fd = log ? openSync(log, 'a') : 'ignore';
  try {
    execFileSync(runtime.bin, ['build', '-t', runtime.image, '-f', containerfile, dirname(containerfile)], { stdio: ['ignore', fd, fd], env });
  } catch (error) {
    throw new Error(`pstack could not build the job image ${runtime.image} with ${runtime.bin}${log ? ` (see ${log})` : ''}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (typeof fd === 'number') closeSync(fd);
  }
}

/** The commands that end and remove one container by name. Apple `container` calls removal `delete`. */
export const reapArgv = (bin: ContainerRuntime['bin'], name: string): { stop: string[]; kill: string[]; remove: string[] } => ({
  stop: [bin, 'stop', '-t', '2', name],
  kill: [bin, 'kill', name],
  remove: bin === 'container' ? [bin, 'delete', '--force', name] : [bin, 'rm', '-f', name],
});

/** Stops named job containers that outlived their wrapper. A container already gone is not an error. */
export function stopContainers(bin: ContainerRuntime['bin'], names: string[]): void {
  for (const name of names) {
    const { stop, kill, remove } = reapArgv(bin, name);
    for (const [command, ...args] of [stop, kill, remove]) if (command) runs(command, args, process.env);
  }
}
