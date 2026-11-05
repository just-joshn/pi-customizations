// Where an environment "cloud" agent runs. A container machine is the counterpart of a Cursor cloud VM: its own
// filesystem, processes, ports, and network namespace, a fresh clone of the pushed remote, and none of the host's
// files or credentials beyond a GitHub token for pushing. A worktree machine is a git worktree on this host, used only
// when no container engine is available or PSTACK_CLOUD_DRIVER=worktree asks for it.
import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type CloudBase, cloneCheckout, mappedCwd, resolveCloudBase } from './checkout.ts';
import { containerState, DockerError, docker, dockerServerVersion, imageExists } from './docker.ts';
import { type Environment, readEnvironment, type Terminal } from './environment.ts';

export const DRIVER_ENV = 'PSTACK_CLOUD_DRIVER';
const GITHUB_TOKEN_PATH = '/run/pstack/github-token';
const INSTALL_TIMEOUT_MS = 30 * 60_000;

export type CloudDriver = 'container' | 'worktree';

interface CheckoutFields {
  /** The checkout root: a clone (container) or a git worktree (worktree). */
  path: string;
  /** The agent's working directory: the parent's place in the repository, mapped into the checkout. */
  cwd: string;
  branch: string;
  /** The ref the branch starts from, such as origin/main. */
  base: string;
  commit: string;
}

export interface ContainerMachine extends CheckoutFields {
  driver: 'container';
  /** The pushed remote the clone came from. */
  remote: string;
  container: string;
  image: string;
  readonly: boolean;
  /** Commands from the environment that run again whenever the machine boots. */
  start?: string;
  terminals?: Terminal[];
}

export interface WorktreeMachine extends CheckoutFields {
  driver: 'worktree';
}

export type Machine = ContainerMachine | WorktreeMachine;

/** The driver a new cloud agent gets: PSTACK_CLOUD_DRIVER when set, else a container when an engine answers. */
export async function selectDriver(env: NodeJS.ProcessEnv = process.env): Promise<{ driver: CloudDriver; reason: string }> {
  const requested = env[DRIVER_ENV];
  if (requested === 'worktree') return { driver: 'worktree', reason: `${DRIVER_ENV}=worktree` };
  const version = await dockerServerVersion();
  if (requested === 'container') {
    if (version === undefined) throw new Error(`${DRIVER_ENV}=container, but no container engine answers \`docker version\`. Start Docker or OrbStack, or set ${DRIVER_ENV}=worktree.`);
    return { driver: 'container', reason: `${DRIVER_ENV}=container (engine ${version})` };
  }
  if (requested !== undefined && requested !== '') throw new Error(`${DRIVER_ENV} must be container or worktree, not "${requested}".`);
  return version === undefined ? { driver: 'worktree', reason: 'no container engine answers `docker version`' } : { driver: 'container', reason: `container engine ${version}` };
}

const DRIVER_CACHE_MS = 60_000;
let cachedDriver: { at: number; value: Promise<{ driver: CloudDriver; reason: string } | { error: string }> } | undefined;

/** The driver new cloud agents get, probed at most once a minute, for the system prompt; a probe error is reported, not thrown. */
export function cloudDriverStatus(now = Date.now()): Promise<{ driver: CloudDriver; reason: string } | { error: string }> {
  if (cachedDriver === undefined || now - cachedDriver.at > DRIVER_CACHE_MS) cachedDriver = { at: now, value: selectDriver().catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })) };
  return cachedDriver.value;
}

export const containerName = (agentId: string) => `pstack-${agentId}`;

/** The container machine a cloud agent's process was started for, from the JSON its parent passed; anything else fails. */
export function parseMachine(json: string): ContainerMachine {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('The cloud machine description this agent was started with is not JSON.');
  }
  const machine = value as Partial<ContainerMachine> | null;
  const strings = ['path', 'cwd', 'branch', 'base', 'commit', 'remote', 'container', 'image'] as const;
  if (typeof machine !== 'object' || machine === null || machine.driver !== 'container' || !strings.every((key) => typeof machine[key] === 'string') || typeof machine.readonly !== 'boolean')
    throw new Error('The cloud machine description this agent was started with is incomplete.');
  return machine as ContainerMachine;
}

export function describeMachine(machine: Machine): string {
  if (machine.driver === 'worktree') return `Worktree: ${machine.path} on branch ${machine.branch}, from ${machine.base} at ${machine.commit}. Merge ${machine.branch} to take the subagent's commits.`;
  return `Cloud machine: container ${machine.container} (${machine.image}) with a fresh clone of ${machine.remote} at ${machine.path}, on branch ${machine.branch} from ${machine.base} at ${machine.commit}. The agent pushes ${machine.branch}; fetch it from the remote to take its commits.`;
}

/** Tells a fresh cloud agent where it runs, since nothing else says that the parent takes its work from the branch. */
export function machinePreface(machine: Machine, prompt: string): string {
  const where = machine.cwd === machine.path ? machine.path : `${machine.path} (working directory ${machine.cwd})`;
  if (machine.driver === 'worktree')
    return `You are running in an isolated git worktree at ${where} on branch ${machine.branch}, created from ${machine.base} at ${machine.commit}. Uncommitted changes in the parent's checkout are not here. Commit your changes to ${machine.branch} before you finish, because the parent agent merges from that branch.\n\n${prompt}`;
  return `You are running as a cloud agent on your own machine: a Linux container with its own filesystem, processes, and ports. Your repository is a fresh clone of ${machine.remote} at ${where} on branch ${machine.branch}, created from ${machine.base} at ${machine.commit}. Nothing from the parent's machine is here: no uncommitted or unpushed changes, local transcripts, simulators, or local credentials. Install what you need. The machine can be stopped at any time, so commit and push ${machine.branch} early and often (\`git push\` publishes it), because the parent takes your work from the pushed branch.\n\n${prompt}`;
}

export interface MachinePlan {
  driver: CloudDriver;
  agentId: string;
  /** The parent's working directory. */
  cwd: string;
  /** `<workspace state>/machines/<agent id>` for a container; the worktree path for a worktree. */
  home: string;
  baseBranch: string | undefined;
  readonly: boolean;
  /**
   * Host folders every agent of the workspace shares (the Projects folder and the root agent's store), mounted at the
   * same paths so a cloud agent reads and writes the same shared context as local agents, as a Project's synced files do.
   */
  shared: readonly string[];
}

function git(dir: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function githubToken(env: NodeJS.ProcessEnv): string | undefined {
  const fromEnv = env['GH_TOKEN'] ?? env['GITHUB_TOKEN'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  try {
    const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
    return token === '' ? undefined : token;
  } catch {
    return undefined;
  }
}

/** Lets `git push` and `gh` in the container authenticate to GitHub with the host's token, read from a mounted file. */
function configureGithubAuth(clone: string): void {
  const helper = `!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=$(cat ${GITHUB_TOKEN_PATH})"; }; f`;
  git(clone, ['config', 'credential.https://github.com.helper', helper]);
  git(clone, ['config', '--add', 'url.https://github.com/.insteadOf', 'git@github.com:']);
  git(clone, ['config', '--add', 'url.https://github.com/.insteadOf', 'ssh://git@github.com/']);
}

async function ensureImage(environment: Environment, log: (line: string) => void, signal: AbortSignal | undefined): Promise<string> {
  const image = environment.image;
  if (image.kind === 'pull') {
    if (!(await imageExists(image.reference))) {
      log(`pulling ${image.reference}`);
      await docker(['pull', '--quiet', image.reference], { ...(signal === undefined ? {} : { signal }) });
    }
    return image.reference;
  }
  log(`building ${image.tag} from ${image.dockerfile}`);
  await docker(['build', '--quiet', '-f', image.dockerfile, '-t', image.tag, image.context], { ...(signal === undefined ? {} : { signal }) });
  return image.tag;
}

/** Runs a command inside the machine and writes its output to `logFile`; rejects with the output's tail on failure. */
function execLogged(container: string, cwd: string, command: string, logFile: string, timeoutMs: number, signal: AbortSignal | undefined): Promise<void> {
  const out = createWriteStream(logFile, { flags: 'a' });
  return docker(['exec', '-w', cwd, container, 'bash', '-lc', `${command} 2>&1`], { timeoutMs, ...(signal === undefined ? {} : { signal }) }).then(
    (stdout) => {
      out.end(stdout);
    },
    (error: unknown) => {
      const text = error instanceof DockerError ? error.stderr : String(error);
      out.end(text);
      throw new Error(`\`${command}\` failed in the cloud machine: ${text.trim().split('\n').slice(-20).join('\n')} (log: ${logFile})`);
    },
  );
}

/** Starts the environment's long-running processes; each terminal writes to /tmp/pstack-terminals/<n>.log in the machine. */
async function startServices(machine: ContainerMachine): Promise<void> {
  if (machine.start !== undefined) await docker(['exec', '-d', '-w', machine.cwd, machine.container, 'bash', '-lc', machine.start]);
  for (const [index, terminal] of (machine.terminals ?? []).entries()) {
    const log = `/tmp/pstack-terminals/${index + 1}.log`;
    await docker(['exec', '-d', '-w', machine.cwd, machine.container, 'bash', '-lc', `mkdir -p /tmp/pstack-terminals && { ${terminal.command} ; } > ${log} 2>&1`]);
  }
}

/** Plans and creates the machine: clone, image, container, install, and services. Undoes what it made on failure. */
export async function provisionMachine(plan: MachinePlan, signal?: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<Machine> {
  if (plan.driver === 'worktree') throw new Error('provisionMachine creates container machines; worktree machines come from task/worktree.ts');
  const base: CloudBase = await resolveCloudBase(plan.cwd, plan.baseBranch, signal);
  const path = join(plan.home, 'repo');
  const branch = `pstack/${plan.agentId}`;
  const container = containerName(plan.agentId);
  mkdirSync(plan.home, { recursive: true, mode: 0o700 });
  const logFile = join(plan.home, 'provision.log');
  const log = (line: string) => writeFileSync(logFile, `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
  let created = false;
  try {
    log(`cloning ${base.remote.url} at ${base.branch} (${base.commit})`);
    await cloneCheckout(plan.cwd, base, path, branch, signal);
    const environment = readEnvironment(path, env);
    const image = await ensureImage(environment, log, signal);
    const token = githubToken(env);
    const secrets = join(plan.home, 'secrets');
    const mounts = ['-v', `${path}:${path}${plan.readonly ? ':ro' : ''}`];
    for (const folder of plan.shared) {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      mounts.push('-v', `${folder}:${folder}${plan.readonly ? ':ro' : ''}`);
    }
    if (token !== undefined) {
      mkdirSync(secrets, { recursive: true, mode: 0o700 });
      writeFileSync(join(secrets, 'github-token'), token, { mode: 0o600 });
      configureGithubAuth(path);
      mounts.push('-v', `${join(secrets, 'github-token')}:${GITHUB_TOKEN_PATH}:ro`);
      writeFileSync(join(secrets, 'env'), `GH_TOKEN=${token}\n`, { mode: 0o600 });
    }
    const cwd = mappedCwd(plan.cwd, path, base.commit);
    log(`starting container ${container} from ${image}`);
    await docker(
      [
        'run',
        '--detach',
        '--init',
        '--name',
        container,
        '--hostname',
        `pstack-${plan.agentId.slice(0, 8)}`,
        '--label',
        `pstack.agent=${plan.agentId}`,
        ...mounts,
        '--workdir',
        cwd,
        ...(token === undefined ? [] : ['--env-file', join(secrets, 'env')]),
        image,
        'sleep',
        'infinity',
      ],
      { timeoutMs: 120_000, ...(signal === undefined ? {} : { signal }) },
    );
    created = true;
    // The clone belongs to the host user, and git refuses a repository another user owns unless it is marked safe.
    await docker(['exec', container, 'git', 'config', '--global', '--add', 'safe.directory', '*'], { timeoutMs: 30_000 });
    const machine: ContainerMachine = {
      driver: 'container',
      path,
      cwd,
      branch,
      base: `${base.remote.name}/${base.branch}`,
      commit: base.commit,
      remote: base.remote.url,
      container,
      image,
      readonly: plan.readonly,
      ...(environment.start === undefined ? {} : { start: environment.start }),
      ...(environment.terminals.length === 0 ? {} : { terminals: environment.terminals }),
    };
    if (environment.install !== undefined) {
      log(`install: ${environment.install}`);
      await execLogged(container, cwd, environment.install, join(plan.home, 'install.log'), INSTALL_TIMEOUT_MS, signal);
    }
    await startServices(machine);
    log('ready');
    return machine;
  } catch (error) {
    if (created) await docker(['rm', '--force', container]).catch(() => undefined);
    rmSync(path, { recursive: true, force: true });
    throw error;
  }
}

/** Boots a stopped container machine again, with its start command and terminals, before a resumed run. */
export async function bootMachine(machine: Machine): Promise<void> {
  if (machine.driver === 'worktree') {
    if (!existsSync(machine.cwd)) throw new Error(`The git worktree ${machine.path} no longer exists.`);
    return;
  }
  const state = await containerState(machine.container);
  if (state === 'missing') throw new Error(`The cloud machine ${machine.container} no longer exists.`);
  if (state === 'running') return;
  await docker(['start', machine.container], { timeoutMs: 60_000 });
  await startServices(machine);
}

/** Stops a container machine's processes; its disk stays, so a resume boots it again. */
export async function stopMachine(machine: Machine): Promise<void> {
  if (machine.driver === 'worktree') return;
  if ((await containerState(machine.container)) === 'running') await docker(['stop', '--time', '5', machine.container], { timeoutMs: 30_000 });
}

/** The machine's state as one word for agent_status. */
export async function machineState(machine: Machine): Promise<string> {
  if (machine.driver === 'worktree') return existsSync(machine.cwd) ? 'worktree present' : 'worktree missing';
  try {
    return `container ${await containerState(machine.container)}`;
  } catch (error) {
    return `container unknown (${error instanceof Error ? error.message : String(error)})`;
  }
}
