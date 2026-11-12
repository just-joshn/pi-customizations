// The container boundary of a container worker (spec 5 "Cloud subagent", 9.6, 15.1). The whole worker runs inside the
// container: the host's tmux host starts `docker run -i ... pi --mode rpc` as its child, so the docker client's stdio is
// the RPC pipe. Nothing of the user's checkout is mounted. The container clones the pushed remote itself.
// Plain Node: node: builtins only, because the worker host bundle imports it.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { redactUserinfo, stripUserinfo } from './redact.ts';

/** The label every pstack container carries, valued with its worker's tmux session name; pstack removes only containers that have it. */
export const CONTAINER_LABEL = 'pstack.worker';
/** Debian with node and git. The default environment derives its image from this one (see DEFAULT_DOCKERFILE). */
export const DEFAULT_IMAGE = 'node:24-bookworm';
/** The GitHub CLI the default environment ships, pinned by release and checked against the release's published digests. */
export const GH_VERSION = '2.103.3';
const GH_SHA256 = { amd64: '4c806978ffce1cec70853302a56d70ac6da4f19bae7adca4e1a8ab00633dd91d', arm64: 'ee32df2323c8847f5fac6cb6b4b69ca75828e9329a8f22f677021f7b3306ce63' } as const;
/** What a container worker runs in when the project names no image: node, git, base64, and `gh`. */
export const DEFAULT_DOCKERFILE = `FROM ${DEFAULT_IMAGE}
RUN set -eu; \\
  arch="$(dpkg --print-architecture)"; \\
  case "$arch" in \\
    amd64) sum=${GH_SHA256.amd64} ;; \\
    arm64) sum=${GH_SHA256.arm64} ;; \\
    *) echo "no gh release for $arch" >&2; exit 1 ;; \\
  esac; \\
  curl -fsSL -o /tmp/gh.tgz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_$arch.tar.gz"; \\
  echo "$sum  /tmp/gh.tgz" | sha256sum -c -; \\
  tar -xzf /tmp/gh.tgz -C /tmp; \\
  install -m 0755 "/tmp/gh_${GH_VERSION}_linux_$arch/bin/gh" /usr/local/bin/gh; \\
  rm -rf /tmp/gh.tgz "/tmp/gh_${GH_VERSION}_linux_$arch"; \\
  gh --version
`;
/** The cache key of the derived image: its Dockerfile. Removing the tag rebuilds it, which also takes a newer node base. */
export const DEFAULT_IMAGE_TAG = `pstack-default:${createHash('sha256').update(DEFAULT_DOCKERFILE).digest('hex').slice(0, 16)}`;
export const ENVIRONMENT_FILE = join('.pi', 'environment.json');
/** The docker client's own configuration. It reaches the client, never the container. */
export const ENGINE_ENV = ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'DOCKER_API_VERSION'] as const;
export const CONTAINER_HOME = '/tmp/pstack-home';
export const CONTAINER_WORKSPACE = '/tmp/workspace';
/** Where the host's Pi install is mounted: a `node_modules` directory, so Pi's dependencies resolve beside it. */
export const CONTAINER_PI_ROOT = '/opt/pstack/pi/node_modules';
/** The first stdout record of a container worker: the clone and install are done and Pi starts next. */
export const READY_RECORD = 'pstack_container_ready';

/** Names the container must not inherit from the host: they describe the host's own filesystem, shell, and engine. */
export const hostOnlyEnv = (name: string): boolean => ['PATH', 'HOME', 'TMPDIR', 'PWD', 'OLDPWD', 'SHELL', 'USER', 'LOGNAME', 'HOSTNAME', 'TMUX', 'TMUX_PANE', 'PI_CODING_AGENT_DIR'].includes(name) || /^(DOCKER|XDG|SSH)_/.test(name);

export class ContainerUnavailableError extends Error {
  constructor(reason: string) {
    super(`ContainerUnavailable: ${reason}`);
    this.name = 'ContainerUnavailable';
  }
}

export interface ContainerMount {
  src: string;
  dst: string;
  readonly: boolean;
}

/** Everything the host needs to start the container. Non-secret: it travels in argv. Secrets travel in the launch environment. */
export interface ContainerPlan {
  /** Absolute path of the docker CLI. */
  docker: string;
  /** The container's name and its label value: the worker's tmux session name, which carries the collision-free identity. */
  name: string;
  runId: string;
  /** The image id the environment resolved to, so the worker runs exactly the image that was checked. */
  image: string;
  /** `uid:gid`, so files the container creates in a bind mount belong to the host user. */
  user: string | null;
  mounts: ContainerMount[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const MOUNT_PATH = /^\/[^\0\n,]*$/;

export function parseContainerPlan(raw: unknown): ContainerPlan {
  if (!isRecord(raw)) throw new Error('Launch container must be an object');
  const { docker, name, runId, image, user, mounts } = raw;
  if (typeof docker !== 'string' || !isAbsolute(docker)) throw new Error('Launch container.docker must be an absolute path');
  if (typeof name !== 'string' || !/^pstack_[a-z0-9-]+_[a-z0-9-]+_[0-9a-f]{8}$/.test(name)) throw new Error('Launch container.name is invalid');
  if (typeof runId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(runId)) throw new Error('Launch container.runId is invalid');
  if (typeof image !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(image)) throw new Error('Launch container.image must be an image id');
  if (user !== null && !(typeof user === 'string' && /^\d+:\d+$/.test(user))) throw new Error('Launch container.user must be uid:gid or null');
  if (
    !Array.isArray(mounts) ||
    !mounts.every((mount) => isRecord(mount) && typeof mount['src'] === 'string' && MOUNT_PATH.test(mount['src']) && typeof mount['dst'] === 'string' && MOUNT_PATH.test(mount['dst']) && typeof mount['readonly'] === 'boolean')
  )
    throw new Error('Launch container.mounts must be { src, dst, readonly } with absolute paths');
  return { docker, name, runId, image, user, mounts: mounts as ContainerMount[] };
}

/** Runs the docker CLI and resolves with its stdout; a non-zero exit rejects with the CLI's stderr. */
function dockerCli(docker: string, args: readonly string[], env: NodeJS.ProcessEnv, timeoutMs: number, input?: string): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = execFile(docker, [...args], { env, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 64 << 20 }, (error, stdout, stderr) => {
      if (error === null) resolveRun(stdout);
      else reject(new Error(redactUserinfo(`docker ${args[0] ?? ''} failed: ${stderr.trim() || error.message}`)));
    });
    child.stdin?.end(input);
  });
}

/** The docker client's environment: where the engine is and how to reach it, from a snapshot or the parent's own environment. */
export function clientEnv(source: Record<string, string | null | undefined>): NodeJS.ProcessEnv {
  const names = ['PATH', 'HOME', ...ENGINE_ENV];
  return Object.fromEntries(names.flatMap((name) => (typeof source[name] === 'string' ? [[name, source[name]]] : [])));
}

function findOnPath(command: string, path: string | undefined): string | undefined {
  for (const dir of (path ?? '').split(delimiter)) {
    const candidate = join(dir, command);
    if (dir !== '' && existsSync(candidate)) return candidate;
  }
  return undefined;
}

export interface Engine {
  docker: string;
  env: NodeJS.ProcessEnv;
  version: string;
}

/** The engine the environment points at, or ContainerUnavailable when no `docker` answers. */
export async function connectEngine(source: Record<string, string | undefined>): Promise<Engine> {
  const env = clientEnv(source);
  const docker = findOnPath('docker', env['PATH']);
  if (docker === undefined) throw new ContainerUnavailableError('there is no `docker` on PATH, so no container engine can run a container worker');
  try {
    const version = (await dockerCli(docker, ['version', '--format', '{{.Server.Version}}'], env, 10_000)).trim();
    if (version === '') throw new Error('the engine reported no server version');
    return { docker, env, version };
  } catch (error) {
    throw new ContainerUnavailableError(`no container engine answers \`docker version\` (${error instanceof Error ? error.message : String(error)}). Start Docker or OrbStack, or point DOCKER_HOST at an engine.`);
  }
}

export interface Environment {
  /** `.pi/environment.json` when the project has one. */
  source: string | undefined;
  image: { kind: 'default' } | { kind: 'pull'; reference: string } | { kind: 'build'; dockerfile: string; context: string; tag: string };
  install: string | undefined;
}

/** `child` is `parent` or inside it, by path. */
const within = (parent: string, child: string): boolean => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

const fail = (path: string, problem: string): never => {
  throw new Error(`${path}: ${problem}`);
};

function optionalString(path: string, value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') return fail(path, `${field} must be a non-empty string`);
  return value;
}

/** The project's `.pi/environment.json`: `image` or `build.dockerfile` (relative to `.pi/`), and `install`. A malformed file fails the spawn instead of being ignored. */
export function readEnvironment(project: string): Environment {
  const path = join(project, ENVIRONMENT_FILE);
  if (!existsSync(path)) return { source: undefined, image: { kind: 'default' }, install: undefined };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return fail(path, `not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isRecord(raw)) return fail(path, 'must be a JSON object');
  const unknown = Object.keys(raw).filter((key) => !['image', 'build', 'install'].includes(key));
  if (unknown.length > 0) fail(path, `unsupported field${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}; a container worker reads image, build, and install`);
  const reference = optionalString(path, raw['image'], 'image');
  const install = optionalString(path, raw['install'], 'install');
  if (raw['build'] === undefined) return { source: path, image: reference === undefined ? { kind: 'default' } : { kind: 'pull', reference }, install };
  if (reference !== undefined) fail(path, 'set image or build, not both');
  const build = raw['build'];
  if (!isRecord(build)) return fail(path, 'build must be an object with a dockerfile');
  const dockerfile = optionalString(path, build['dockerfile'], 'build.dockerfile');
  if (dockerfile === undefined) return fail(path, 'build.dockerfile is required');
  const base = join(project, '.pi');
  const file = resolve(base, dockerfile);
  if (!existsSync(file)) fail(path, `build.dockerfile ${file} does not exist`);
  const context = resolve(base, optionalString(path, build['context'], 'build.context') ?? '.');
  if (!existsSync(context)) fail(path, `build.context ${context} does not exist`);
  const root = realpathSync(project);
  if (!within(root, realpathSync(file))) fail(path, `build.dockerfile ${file} is outside the project ${root}`);
  if (!within(root, realpathSync(context))) fail(path, `build.context ${context} is outside the project ${root}; the docker client would send that folder to the engine`);
  const digest = createHash('sha256').update(readFileSync(file)).update('\0').update(relative(project, context)).digest('hex').slice(0, 16);
  return { source: path, image: { kind: 'build', dockerfile: file, context, tag: `pstack-env:${digest}` }, install };
}

/** Pulls or builds the environment's image and resolves it to an image id. A build reruns each time and its layer cache makes that cheap. */
export async function ensureImage(engine: Engine, environment: Environment): Promise<{ reference: string; id: string }> {
  const { image } = environment;
  const inspect = (reference: string) => dockerCli(engine.docker, ['image', 'inspect', '--format', '{{.Id}}', reference], engine.env, 30_000);
  const present = (reference: string) =>
    inspect(reference).then(
      () => true,
      () => false,
    );
  let reference: string;
  if (image.kind === 'default') {
    reference = DEFAULT_IMAGE_TAG;
    if (!(await present(reference))) await dockerCli(engine.docker, ['build', '--quiet', '-t', reference, '-'], engine.env, 30 * 60_000, DEFAULT_DOCKERFILE);
  } else if (image.kind === 'pull') {
    reference = image.reference;
    if (!(await present(reference))) await dockerCli(engine.docker, ['pull', '--quiet', reference], engine.env, 30 * 60_000);
  } else {
    reference = image.tag;
    await dockerCli(engine.docker, ['build', '--quiet', '-f', image.dockerfile, '-t', reference, image.context], engine.env, 30 * 60_000);
  }
  return { reference, id: (await inspect(reference)).trim() };
}

export class ForgeUnavailableError extends Error {
  constructor(reason: string) {
    super(`ForgeUnavailable: ${reason}`);
    this.name = 'ForgeUnavailable';
  }
}

/** What `gh` reads to find its login. The rest of the parent's environment never reaches it. */
const GH_ENV = ['PATH', 'HOME', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME'] as const;

/**
 * The token a worker with the forge capability gets: `PSTACK_CONTAINER_FORGE_TOKEN` when the parent sets one (a token the
 * operator scoped for workers, such as a fine-grained one), else what `gh auth token` prints. Throws ForgeUnavailable when
 * neither exists, so the spawn fails before any claim. `gh auth token` reads the operator's own login, so it holds their scopes.
 */
export async function resolveForgeToken(source: Record<string, string | undefined>): Promise<string> {
  const explicit = source['PSTACK_CONTAINER_FORGE_TOKEN'];
  if (explicit !== undefined && explicit !== '') return explicit;
  const env = Object.fromEntries(GH_ENV.flatMap((name) => (typeof source[name] === 'string' ? [[name, source[name]]] : [])));
  const gh = findOnPath('gh', env['PATH']);
  if (gh === undefined) throw new ForgeUnavailableError('capabilities.forge needs a token, and there is no `gh` on PATH to read one from. Install gh and log in, or set PSTACK_CONTAINER_FORGE_TOKEN.');
  const token = await new Promise<string>((resolveRun, reject) => {
    const child = execFile(gh, ['auth', 'token'], { env, timeout: 15_000, encoding: 'utf8' }, (error, stdout, stderr) => (error === null ? resolveRun(stdout.trim()) : reject(new Error(redactUserinfo(stderr.trim() || error.message)))));
    child.stdin?.end();
  }).catch((error: unknown) => {
    throw new ForgeUnavailableError(`capabilities.forge needs a token, and \`gh auth token\` gave none (${error instanceof Error ? error.message : String(error)}). Run \`gh auth login\`, or set PSTACK_CONTAINER_FORGE_TOKEN.`);
  });
  if (token === '') throw new ForgeUnavailableError('capabilities.forge needs a token, and `gh auth token` printed none. Run `gh auth login`, or set PSTACK_CONTAINER_FORGE_TOKEN.');
  return token;
}

/** Fails the spawn when the image has no `gh`: a forge worker in it could not use its token. The default image always has it. */
async function assertImageHasGh(engine: Engine, image: { reference: string; id: string }): Promise<void> {
  await dockerCli(engine.docker, ['run', '--rm', '--entrypoint', 'sh', image.id, '-c', 'command -v gh'], engine.env, 120_000).catch(() => {
    throw new ForgeUnavailableError(`the image ${image.reference} has no \`gh\`, which this worker's forge capability needs. Add it to the image, or leave the image to the default, which ships gh ${GH_VERSION}.`);
  });
}

function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = execFile('git', ['-C', cwd, ...args], { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout: 60_000, encoding: 'utf8', maxBuffer: 16 << 20 }, (error, stdout, stderr) => {
      if (error === null) resolveRun(stdout.trim());
      else reject(new Error(redactUserinfo(stderr.trim() || error.message)));
    });
    child.stdin?.end();
  });
}

const tryGit = (cwd: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string | undefined> => git(cwd, args, env).catch(() => undefined);

export interface Remote {
  name: string;
  /** What the container clones: a local path, or a URL without its userinfo. A token never rides in a URL. */
  url: string;
  /** The bare repository's own path when the remote is a local path: the container cannot reach it without a mount. */
  localPath: string | null;
}

/** A remote URL that is a path on this machine: `file://`, or no scheme and no `host:` prefix. */
function localPathOf(url: string, project: string): string | null {
  if (url.startsWith('file://')) return fileURLToPath(url);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) || /^[^/]*:/.test(url)) return null;
  return resolve(project, url);
}

/** origin, else the only remote: the repository the container clones. */
export async function resolveRemote(project: string, env: NodeJS.ProcessEnv): Promise<Remote> {
  const names = ((await tryGit(project, ['remote'], env)) ?? '').split('\n').filter(Boolean);
  const name = names.includes('origin') ? 'origin' : names.length === 1 ? names[0] : undefined;
  if (name === undefined)
    throw new ContainerUnavailableError(
      names.length === 0
        ? `A container worker clones the pushed remote, and ${project} has no git remote. Push the repository first.`
        : `A container worker clones the pushed remote, and ${project} has several remotes but none named origin.`,
    );
  const url = await git(project, ['remote', 'get-url', name], env);
  const localPath = localPathOf(url, project);
  return { name, url: localPath ?? stripUserinfo(url), localPath };
}

/** A local remote is mounted read-write, so it must not be, contain, or lie inside the checkout the operator works in. */
export function assertRemoteOutsideCheckout(project: string, remote: Remote): void {
  if (remote.localPath === null) return;
  const target = existsSync(remote.localPath) ? realpathSync(remote.localPath) : remote.localPath;
  const checkout = realpathSync(project);
  if (within(target, checkout) || within(checkout, target))
    throw new ContainerUnavailableError(
      `The remote ${remote.name} is the local path ${remote.localPath}, which is, contains, or lies inside the project checkout ${checkout}. A container worker gets a local remote mounted read-write, so that would hand it the checkout. Push to a bare repository outside the project, or use a network remote.`,
    );
}

/**
 * The full SHA of `inputCommit`, once it is on the remote: some branch or tag the remote lists is that commit or has it as an
 * ancestor. Only tips this checkout has can be compared, so a remote that moved ahead of the checkout refuses until a fetch.
 */
export async function verifyPushed(project: string, remote: Remote, inputCommit: string, env: NodeJS.ProcessEnv): Promise<string> {
  const full = await tryGit(project, ['rev-parse', '--verify', '--quiet', `${inputCommit}^{commit}`], env);
  if (full === undefined) throw new Error(`inputCommit ${inputCommit} names no commit in ${project}`);
  // By name, so the checkout's own URL, userinfo and all, stays in git's configuration and out of argv.
  const listed = await git(project, ['ls-remote', '--heads', '--tags', remote.name], env).catch((error: unknown) => {
    throw new ContainerUnavailableError(`Could not read the remote ${remote.name} (${remote.url}): ${error instanceof Error ? error.message : String(error)}`);
  });
  const tips = [...new Set(listed.split('\n').flatMap((line) => (line === '' ? [] : [line.split('\t')[0] as string])))];
  for (const tip of tips) {
    if (tip === full) return full;
    if ((await tryGit(project, ['cat-file', '-e', `${tip}^{commit}`], env)) !== undefined && (await tryGit(project, ['merge-base', '--is-ancestor', full, tip], env)) !== undefined) return full;
  }
  throw new ContainerUnavailableError(
    `inputCommit ${full} is not on the remote ${remote.name} (${remote.url}). A container worker clones the pushed remote, so push the commit first (git push ${remote.name} <branch>), or fetch if the remote moved ahead of this checkout.`,
  );
}

/** Pi's JS install, so the container runs the same Pi as the parent: the enclosing `node_modules` and the entry script inside it. */
export function resolvePiInstall(entry: string | undefined): { root: string; script: string } {
  if (entry === undefined || !existsSync(entry)) throw new Error("Cannot locate Pi's JS install to mount into the container: set PSTACK_CONTAINER_PI to its cli.js (node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js)");
  const real = realpathSync(entry);
  const marker = `${sep}node_modules${sep}@earendil-works${sep}pi-coding-agent${sep}`;
  const at = real.lastIndexOf(marker);
  if (at === -1) throw new Error(`${real} is not inside a node_modules/@earendil-works/pi-coding-agent install, so it cannot be mounted into the container`);
  const root = real.slice(0, at + `${sep}node_modules`.length);
  return { root, script: join(CONTAINER_PI_ROOT, relative(root, real)) };
}

/**
 * Runs in the container. The first stdin lines are the worker's environment, `NAME=<base64 value>`, ended by an empty line,
 * so credentials never reach argv, `docker inspect`, or an image layer. It clones the remote at the exact commit, runs the
 * environment's install, reports ready on stdout, and replaces itself with Pi, whose stdin is then the rest of the pipe.
 * Everything else it prints goes to stderr, because stdout is the RPC stream.
 */
export const ENTRYPOINT = `fail() { echo "pstack: $*" >&2; exit 1; }
for tool in node git base64; do command -v "$tool" >/dev/null 2>&1 || fail "the image has no $tool; a container worker's image needs node, git, and base64"; done
while IFS= read -r line; do
  [ -n "$line" ] || break
  name=\${line%%=*}
  value=$(printf %s "\${line#*=}" | base64 -d; printf x)
  export "$name=\${value%x}"
done
[ -n "\${PSTACK_CONTAINER_CLONE_URL:-}" ] || fail "the launch environment did not arrive on stdin"
export GIT_TERMINAL_PROMPT=0 GH_PROMPT_DISABLED=1 GH_NO_UPDATE_NOTIFIER=1
[ -z "\${PSTACK_CONTAINER_FORGE:-}" ] || command -v gh >/dev/null 2>&1 || fail "the image has no gh, which this worker's forge capability needs"
WS=${CONTAINER_WORKSPACE}
{
  mkdir -p "$HOME" "$PI_CODING_AGENT_DIR" "$WS" || fail "cannot create the workspace"
  if [ -n "\${PSTACK_CONTAINER_AUTH:-}" ]; then (umask 077 && printf %s "$PSTACK_CONTAINER_AUTH" > "$PI_CODING_AGENT_DIR/auth.json") || fail "cannot write the model credential"; fi
  git config --global --add safe.directory '*'
  [ -z "\${PSTACK_CONTAINER_GIT_NAME:-}" ] || git config --global user.name "$PSTACK_CONTAINER_GIT_NAME"
  [ -z "\${PSTACK_CONTAINER_GIT_EMAIL:-}" ] || git config --global user.email "$PSTACK_CONTAINER_GIT_EMAIL"
  if [ -n "\${GH_TOKEN:-\${GITHUB_TOKEN:-}}" ]; then
    git config --global "credential.https://\${PSTACK_CONTAINER_FORGE_HOST:-github.com}.helper" '!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=\${GH_TOKEN:-$GITHUB_TOKEN}"; }; f'
  fi
  git clone --quiet --no-checkout "$PSTACK_CONTAINER_CLONE_URL" "$WS" || fail "could not clone the remote"
  git -C "$WS" rev-parse --verify --quiet "$PSTACK_CONTAINER_COMMIT^{commit}" >/dev/null || fail "commit $PSTACK_CONTAINER_COMMIT is not on the remote"
  git -C "$WS" checkout --quiet -b "$PSTACK_CONTAINER_BRANCH" "$PSTACK_CONTAINER_COMMIT" || fail "cannot check out $PSTACK_CONTAINER_COMMIT"
  if [ -n "\${PSTACK_CONTAINER_INSTALL:-}" ]; then (cd "$WS" && sh -c "$PSTACK_CONTAINER_INSTALL") || fail "the environment's install command failed"; fi
} >&2
unset PSTACK_CONTAINER_CLONE_URL PSTACK_CONTAINER_COMMIT PSTACK_CONTAINER_BRANCH PSTACK_CONTAINER_INSTALL PSTACK_CONTAINER_GIT_NAME PSTACK_CONTAINER_GIT_EMAIL PSTACK_CONTAINER_FORGE PSTACK_CONTAINER_FORGE_HOST PSTACK_CONTAINER_AUTH
printf '{"type":"%s"}\\n' ${READY_RECORD}
cd "$WS"
exec "$@"
`;

/**
 * The one directory the container writes through: `<workerDir>/out` appears at `<workerDir>` inside, so the report, evidence, and
 * session paths a brief names are the same in both places. The worker directory's claim, state, and control socket are not mounted.
 */
export const outDirOf = (workerDir: string): string => join(workerDir, 'out');

/** The `docker run` arguments, from the plan and the command to run inside. Secret-free, so it may appear in argv and events. */
export function containerRunArgs(plan: ContainerPlan, workerDir: string, command: readonly string[]): string[] {
  const mount = ({ src, dst, readonly }: ContainerMount) => ['--mount', `type=bind,src=${src},dst=${dst}${readonly ? ',readonly' : ''}`];
  return [
    'run',
    '--rm',
    '-i',
    '--init',
    '--name',
    plan.name,
    '--label',
    `${CONTAINER_LABEL}=${plan.name}`,
    '--label',
    `pstack.run=${plan.runId}`,
    ...(plan.user === null ? [] : ['--user', plan.user]),
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    ...plan.mounts.flatMap(mount),
    ...mount({ src: outDirOf(workerDir), dst: workerDir, readonly: false }),
    '--entrypoint',
    '/bin/sh',
    plan.image,
    '-c',
    ENTRYPOINT,
    'pstack-container',
    ...command,
  ];
}

/** The stdin preamble for the entrypoint. Names are checked, values are base64, so no value can end a line or inject shell. */
export function containerPreamble(env: Record<string, string>): string {
  return `${Object.entries(env)
    .map(([name, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid environment variable name ${JSON.stringify(name)}`);
      return `${name}=${Buffer.from(value).toString('base64')}\n`;
    })
    .join('')}\n`;
}

/** Removes the containers this worker owns, found by label so a name that another tool reuses is never touched. Returns what it removed; idempotent. */
export async function removeWorkerContainers(docker: string, env: NodeJS.ProcessEnv, name: string): Promise<string[]> {
  const listed = await dockerCli(docker, ['ps', '--all', '--quiet', '--no-trunc', '--filter', `label=${CONTAINER_LABEL}=${name}`], env, 30_000);
  const ids = listed.split('\n').filter(Boolean);
  for (const id of ids)
    await dockerCli(docker, ['rm', '--force', id], env, 60_000).catch((error: unknown) => {
      // --rm may be removing it already.
      if (!/No such container|already in progress/i.test(error instanceof Error ? error.message : String(error))) throw error;
    });
  return ids;
}

/** The engine a container worker was started on, as spawn saw it. Abort removes the container there, whatever the environment has become. */
export const engineRecordPath = (workerDir: string): string => join(workerDir, 'claim', 'engine.json');

export function writeEngineRecord(workerDir: string, engine: Pick<Engine, 'docker' | 'env'>): void {
  writeFileSync(engineRecordPath(workerDir), JSON.stringify({ docker: engine.docker, env: engine.env }), { mode: 0o600, flag: 'wx' });
}

/** Removes the worker's container on the engine spawn recorded. Throws when nothing was recorded: guessing an engine from today's environment could miss the container or hit another engine. */
export async function removeRecordedContainers(workerDir: string, name: string): Promise<string[]> {
  const path = engineRecordPath(workerDir);
  if (!existsSync(path)) throw new Error(`${path} does not exist, so the engine this worker's container ran on is unknown`);
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(raw) || typeof raw['docker'] !== 'string' || !isAbsolute(raw['docker']) || !isRecord(raw['env']) || Object.values(raw['env']).some((value) => typeof value !== 'string')) throw new Error(`${path} is not an engine record`);
  return removeWorkerContainers(raw['docker'], raw['env'] as NodeJS.ProcessEnv, name);
}

export interface ContainerRequest {
  project: string;
  runId: string;
  workerId: string;
  /** The worker's tmux session name: the container's name and label value. */
  session: string;
  inputCommit: string;
  /** The parent's environment, which locates the engine and the git remote's credentials. */
  source: Record<string, string | undefined>;
  packageRoot: string;
  /** Pi's JS entry script, or undefined to use the running Pi. */
  piEntry: string | undefined;
  /** The role instruction document Pi appends to its system prompt. */
  roleDoc: string | null;
  /** Further read-only host paths to mount at the same path. */
  extraMounts: readonly string[];
  /** The assignment's `capabilities.forge`: the worker gets a forge token and needs `gh`. */
  forge: boolean;
  /** The resolved model provider's credential, and the packages that register it (see container-auth.ts). */
  auth: { authJson: string | null; mounts: readonly string[]; extensions: readonly string[] };
}

export interface PreparedContainer {
  plan: ContainerPlan;
  /** Entries for the launch environment: the clone's source, commit, branch, install, and git identity. */
  env: Record<string, string>;
  /** Pi's command inside the container, and the arguments that load pstack there. */
  piCommand: string[];
  piArgs: string[];
  engine: Engine;
  engineVersion: string;
  image: { reference: string; id: string };
  remote: string;
}

/**
 * Everything the parent settles before it claims the worker: the engine answers, the commit is pushed, the image exists, and
 * Pi's install can be mounted. A refusal that means no container worker can run here is a ContainerUnavailableError. A refusal leaves nothing behind, so the assignment can be fixed and spawned again.
 */
export async function prepareContainer(request: ContainerRequest): Promise<PreparedContainer> {
  const { project, runId, workerId, session, source, packageRoot } = request;
  const engine = await connectEngine(source);
  const remote = await resolveRemote(project, source);
  assertRemoteOutsideCheckout(project, remote);
  const commit = await verifyPushed(project, remote, request.inputCommit, source);
  const environment = readEnvironment(project);
  const forgeToken = request.forge ? await resolveForgeToken(source) : undefined;
  const image = await ensureImage(engine, environment).catch((error: unknown) => {
    throw new ContainerUnavailableError(`the container image could not be prepared (${error instanceof Error ? error.message : String(error)})`);
  });
  if (forgeToken !== undefined && environment.image.kind !== 'default') await assertImageHasGh(engine, image);
  const pi = resolvePiInstall(request.piEntry);
  const mounts: ContainerMount[] = [{ src: pi.root, dst: CONTAINER_PI_ROOT, readonly: true }];
  for (const path of [packageRoot, ...(request.roleDoc === null ? [] : [resolve(request.roleDoc, '..')]), ...request.extraMounts, ...request.auth.mounts])
    if (!mounts.some((mount) => mount.dst === path || (mount.readonly && within(mount.dst, path)))) mounts.push({ src: path, dst: path, readonly: true });
  // A local remote stands in for a network one: the container pushes to it the way it would push over the network.
  if (remote.localPath !== null) mounts.push({ src: remote.localPath, dst: remote.localPath, readonly: false });
  for (const { src, dst } of mounts) if (!existsSync(src) || !MOUNT_PATH.test(src) || !MOUNT_PATH.test(dst)) throw new Error(`Cannot mount ${src}: it must exist and be an absolute path without commas`);
  const [name, email] = await Promise.all([tryGit(project, ['config', 'user.name'], source), tryGit(project, ['config', 'user.email'], source)]);
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  return {
    plan: { docker: engine.docker, name: session, runId, image: image.id, user: uid === undefined || gid === undefined || uid === 0 ? null : `${uid}:${gid}`, mounts },
    env: {
      PSTACK_CONTAINER_CLONE_URL: remote.url,
      PSTACK_CONTAINER_COMMIT: commit,
      PSTACK_CONTAINER_BRANCH: `pstack-run/${runId}/${workerId}`,
      ...(request.auth.authJson === null ? {} : { PSTACK_CONTAINER_AUTH: request.auth.authJson }),
      ...(forgeToken === undefined ? {} : { GH_TOKEN: forgeToken, PSTACK_CONTAINER_FORGE: '1', PSTACK_CONTAINER_FORGE_HOST: source['GH_HOST'] || 'github.com' }),
      ...(environment.install === undefined ? {} : { PSTACK_CONTAINER_INSTALL: environment.install }),
      ...(name === undefined || name === '' ? {} : { PSTACK_CONTAINER_GIT_NAME: name }),
      ...(email === undefined || email === '' ? {} : { PSTACK_CONTAINER_GIT_EMAIL: email }),
    },
    piCommand: ['node', pi.script],
    piArgs: ['--extension', join(packageRoot, 'src', 'extension.ts'), ...request.auth.extensions.flatMap((path) => ['--extension', path]), '--skill', join(packageRoot, 'generated', 'skills')],
    engine,
    engineVersion: engine.version,
    image,
    remote: remote.name,
  };
}
