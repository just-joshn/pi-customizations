import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ExtensionAPI, type ExtensionContext, getAgentDir, parseFrontmatter, stripFrontmatter } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { commandProviders, jobAgentDir, makeJobAgentDir, syncTokens } from './credentials.ts';
import { brokeredSession, claimWake, excerpt, exitPath, type Job, type JobSpec, launch, launchBrokered, list, newJobId, outputPath, read, readSpec, request, resultsDir, settleBrokered, stop, tail, tmuxSocket } from './jobs.ts';
import { JOB_DIR_ENV, SANDBOX_ENV, type SandboxPolicy, sandboxed, TOP_DIR_ENV } from './sandbox.ts';
import { codePaths, PI_CODE } from './sweep.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = ['poteto-agent', 'comment-sicko', 'ci-watcher', 'thermo-nuclear-code-quality-review'] as const;
const THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const POLL_MS = 2000;
const REPORT_LIMIT = 20000;
// A report's first lines hold its verdict, so they are kept ahead of the end when a report is cut.
const REPORT_HEAD = 4000;

export const modelsFile = (agentDir: string): string => join(agentDir, 'pstack-v2-models.md');
const insideJob = (): boolean => process.env[SANDBOX_ENV] === '1';
// As in Cursor, the root and the workers it starts may start workers, and a worker started by another worker may not.
const startedByWorker = (): boolean => insideJob() && process.env[JOB_DIR_ENV] !== process.env[TOP_DIR_ENV];
const topJobsRoot = (): string => join(getAgentDir(), 'pstack-v2', 'jobs');
// A sandboxed worker can write only inside its own job directory's `nested/`, so the jobs it starts live there.
const jobsRoot = (env: NodeJS.ProcessEnv = process.env): string => {
  const parent = env[JOB_DIR_ENV];
  return env[SANDBOX_ENV] === '1' && parent ? join(parent, 'nested') : topJobsRoot();
};
// A plain string enum, which every provider accepts, typed for TypeBox inference.
const stringEnum = <T extends readonly string[]>(values: T, description?: string) => Type.Unsafe<T[number]>({ type: 'string', enum: [...values], ...(description ? { description } : {}) });
const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }], details: undefined });

const agentRoles = AGENTS.map((name) => `${name}: ${parseFrontmatter<{ description?: string }>(readFileSync(join(packageRoot, 'agents', `${name}.md`), 'utf8')).frontmatter.description ?? ''}`);
const skillsHint = `pstack skills, including ones hidden from the skill list, live at ${join(packageRoot, 'skills')}/<name>/SKILL.md. When a skill says to run another skill, read that file and follow it.`;
const flagValue = (command: string[], flag: string): string | undefined => (command.includes(flag) ? command[command.indexOf(flag) + 1] : undefined);
const rules = ['no-inline-imports', 'typescript-exhaustive-switch'].map((name) => stripFrontmatter(readFileSync(join(packageRoot, 'rules', `${name}.md`), 'utf8')).replace(/^#.*\n+/, ''));

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitPath(cwd: string, flag: '--git-common-dir' | '--show-toplevel' | '--absolute-git-dir'): string | undefined {
  try {
    return resolve(cwd, git(cwd, ['rev-parse', flag]));
  } catch {
    return undefined;
  }
}

/** A job may only work inside the session's project, so the model cannot widen its own sandbox by naming another directory. */
function projectPath(ctx: ExtensionContext, path: string | undefined): string {
  const root = realpathSync(gitPath(ctx.cwd, '--show-toplevel') ?? ctx.cwd);
  const target = realpathSync(path === undefined ? ctx.cwd : resolve(ctx.cwd, path));
  if (!within(target, [root])) throw new Error(`cwd must be inside this project (${root}), got ${target}.`);
  return target;
}

/**
 * Paths an unsandboxed process later executes from: git hooks and config, and Pi's project extensions and settings. Git
 * finds those through `.git`, and in a linked worktree through its `commondir` and `gitdir` files, so each of those is
 * protected too. A job that could repoint any of them would make the next `git commit` run its own hooks unsandboxed.
 */
function protectedPaths(cwd: string, common: string | undefined): { protect: string[]; lock: string[]; gitDirs: string[] } {
  // Every .pi directory and git pointer file already in the checkout, at any depth, since Pi and git find them anywhere.
  const found = codePaths([cwd]);
  const piDirs = [...new Set([join(cwd, '.pi'), ...found.filter((path) => basename(dirname(path)) === '.pi').map(dirname)])];
  const pi = piDirs.flatMap((dir) => PI_CODE.map((name) => join(dir, name)));
  const pointers = found.filter((path) => basename(path) === '.git');
  let protect = [...pi, ...pointers];
  let lock: string[] = [];
  if (common) {
    const own = gitPath(cwd, '--absolute-git-dir') ?? common;
    const worktree = own === common ? [] : [join(cwd, '.git'), ...['commondir', 'gitdir', 'config.worktree'].map((name) => join(own, name))];
    let hooksPath: string[] = [];
    try {
      const configured = git(cwd, ['config', '--get', 'core.hooksPath']);
      if (configured) hooksPath = [resolve(gitPath(cwd, '--show-toplevel') ?? cwd, configured)];
    } catch {
      // No custom hooks path.
    }
    protect = [...protect, join(common, 'hooks'), join(common, 'config'), join(common, 'config.worktree'), join(common, 'info'), ...worktree, ...hooksPath];
    lock = [join(cwd, '.git'), own, common];
  }
  // A directory above a protected path could be renamed away and replaced, so each existing one up to the checkout is locked.
  const ancestors = protect.flatMap((path) => {
    const chain: string[] = [];
    for (let dir = dirname(path); within(dir, [cwd]) && dir !== cwd; dir = dirname(dir)) if (existsSync(dir)) chain.push(dir);
    return chain;
  });
  return { protect, lock: [...new Set([...lock, ...ancestors])], gitDirs: common ? [common] : [] };
}

/** Adds the worktree and returns whether it created the branch, so a failed start can remove it. */
function addWorktree(cwd: string, path: string, branch: string, base: string | undefined): boolean {
  if (branch.startsWith('-') || base?.startsWith('-')) throw new Error('worktree and base cannot start with "-".');
  let exists = true;
  try {
    git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  } catch {
    exists = false;
  }
  git(cwd, exists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, base ?? 'HEAD']);
  return !exists;
}

function report(job: Job): string {
  const state = job.status.state === 'exited' ? `exited with code ${job.status.code}` : 'was lost (its tmux session ended without an exit code)';
  const output = outputPath(job.spec.out);
  const body = job.spec.kind === 'pi' ? excerpt(output, REPORT_HEAD, REPORT_LIMIT - REPORT_HEAD) : tail(output, 60);
  // A worker that fails at startup, such as on a bad model or credential, says why only on stderr.
  const failed = job.status.state !== 'exited' || job.status.code !== 0 || !body.trim();
  const errors = failed ? tail(join(job.spec.out, 'stderr.log'), 40).trim() : '';
  return [`tmux job ${job.spec.name} (${job.spec.id}) ${state}. Full output: ${output}`, job.spec.wake ?? '', `<output>\n${body.trim()}\n</output>`, errors ? `<stderr>\n${errors}\n</stderr>` : ''].filter(Boolean).join('\n\n');
}

function describe(job: Job): string {
  const state = job.status.state === 'exited' ? `exited ${job.status.code}` : job.status.state;
  return `${job.spec.id}  ${job.spec.kind}  ${state}  ${job.spec.name}\n  follow: tail -f ${outputPath(job.spec.out)}`;
}

function resolveModel(ctx: ExtensionContext, model: string | undefined): string | undefined {
  if (model === undefined) return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
  const slash = model.indexOf('/');
  if (slash < 1 || !ctx.modelRegistry.find(model.slice(0, slash), model.slice(slash + 1))) {
    throw new Error(`Unknown model "${model}". Pass provider/id exactly as \`pi --list-models\` prints it, or omit model to use the parent's model.`);
  }
  return model;
}

/** Resolves symlinks in the longest existing prefix, so a path that does not exist yet still compares by where it would land. */
function landing(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(landing(parent), relative(parent, absolute));
}

const within = (path: string, roots: string[]): boolean =>
  roots.some((root) => {
    const inside = relative(landing(root), landing(path));
    return inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
  });

// macOS cannot apply a second Seatbelt profile inside a sandbox, so a sandboxed worker there asks the root Pi to launch for it.
const brokering = (): boolean => process.platform === 'darwin' && process.env[SANDBOX_ENV] === '1';

/** Starts a job under its own sandbox, or writes it as a request for the root Pi when this process cannot. */
function start(root: string, spec: JobSpec, files: Record<string, string> = {}, resolved: Record<string, string> = {}): Job {
  const jobDir = join(root, spec.id);
  // A job started from inside another uses its top-level job's agent directory, which that start already created.
  const top = insideJob() ? (process.env[TOP_DIR_ENV] ?? jobDir) : jobDir;
  if (!insideJob()) makeJobAgentDir(getAgentDir(), jobAgentDir(jobDir), resolved);
  // Every job gets a private temp directory, since the shared ones hold code unsandboxed programs load, and writes
  // credentials only to its top-level job's copy.
  const policy: SandboxPolicy = { ...spec.policy, jobDir, credentials: jobAgentDir(top), writable: [...new Set([...spec.policy.writable, join(jobDir, 'tmp')])] };
  // A writable path that holds Pi's agent directory would let the job rewrite Pi's own code and settings.
  const holder = policy.writable.find((path) => within(policy.agentDir, [path]));
  if (holder) throw new Error(`pstack will not let a job write ${holder}, because it contains Pi's agent directory ${policy.agentDir}. Run Pi from a project directory.`);
  spec = { ...spec, sweep: sweepFor(policy) };
  policy.checkouts = spec.sweep.roots;
  // bubblewrap binds only paths that exist, so the private temp directory exists before the sandbox is built.
  mkdirSync(join(jobDir, 'tmp'), { recursive: true });
  if (brokering()) return request(root, { ...spec, policy }, files);
  return launch(root, { ...spec, policy, argv: sandboxed(spec.command, policy) }, files);
}

/** The checkouts a job may write, and the protected paths in them, which its wrapper sweeps after it for code that appeared. */
const sweepFor = (policy: SandboxPolicy): JobSpec['sweep'] => ({
  // A job's own session, nested, temp, and agent directories live under Pi's agent directory. A worktree does too, and is a checkout.
  roots: policy.writable.filter((path) => (basename(path) === 'worktree' || !within(path, [policy.agentDir])) && !within(path, policy.gitDirs)),
  protect: policy.protect.filter((path) => within(path, policy.writable)),
});

const readGrant = (out: string): string[] => {
  try {
    const grant: unknown = JSON.parse(readFileSync(join(out, 'granted.json'), 'utf8'));
    return isStrings(grant) ? grant : [];
  } catch {
    return [];
  }
};

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

const tmuxKill = (socket: string, session: string): void => {
  try {
    execFileSync('tmux', ['-S', socket, 'kill-session', '-t', `=${session}`], { stdio: 'ignore' });
  } catch {
    // Already gone.
  }
};

function hasSession(socket: string, session: string): boolean {
  try {
    execFileSync('tmux', ['-S', socket, 'has-session', '-t', `=${session}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Launches the requests that sandboxed workers under one of this session's jobs wrote. A request may write only inside
 * what the root granted the top-level job, so no worker can hand a descendant more than it was given. The root only
 * reads from the request directory, which a worker controls, and writes results under the top-level job.
 */
export function serveRequests(top: Job, socket: string, nested: string, requesterDone: boolean, depth = 0, grant: string[] = top.spec.policy.writable): void {
  // A worker could link its nested directory back up its own tree, so only real directories are followed, and not far.
  if (depth > 8 || !existsSync(nested) || !lstatSync(nested).isDirectory()) return;
  for (const name of readdirSync(nested)) {
    try {
      const dir = join(nested, name);
      // A worker could link an entry back up its own tree, so only real directories are followed.
      if (!lstatSync(dir).isDirectory()) continue;
      const spec = readSpec(dir);
      const policy = spec?.policy;
      // A worker writes these files, so anything malformed is skipped instead of stopping every other request.
      if (!spec || !policy || (spec.kind !== 'pi' && spec.kind !== 'command') || typeof spec.cwd !== 'string' || !isStrings(spec.command) || spec.command.length === 0) continue;
      if (!isStrings(policy.writable) || !isStrings(policy.protect) || !isStrings(policy.lock) || !isStrings(policy.gitDirs)) continue;
      const out = resultsDir(top.dir, dir);
      const stopped = existsSync(join(dir, 'stop'));
      const done = existsSync(exitPath(out)) || stopped;
      // A request's own requests may write only what the root granted it, recorded where no worker can write.
      const own = readGrant(out);
      serveRequests(top, socket, join(dir, 'nested'), requesterDone || done, depth + 1, own);
      if (!spec.brokered || existsSync(exitPath(out))) continue;
      const session = brokeredSession(dir);
      if (existsSync(join(out, 'launched'))) {
        if (requesterDone || stopped) tmuxKill(socket, session);
        else if (!hasSession(socket, session)) settleBrokered(out, 137, 'pstack lost this job: its tmux session ended without an exit code.');
        continue;
      }
      if (requesterDone || stopped) continue;
      if (spec.kind === 'pi' && depth > 0) {
        settleBrokered(out, 126, 'pstack refused to start this Pi worker. A worker started by another worker cannot start workers of its own.');
        continue;
      }
      const writable = policy.writable.map(landing);
      const refused = [...writable.filter((path) => !within(path, grant)), ...(within(spec.cwd, [top.spec.cwd, ...grant]) ? [] : [`cwd ${spec.cwd}`])];
      if (refused.length) {
        settleBrokered(out, 126, `pstack refused to launch this job. It asked to write outside what the job that requested it may write: ${refused.join(', ')}`);
        continue;
      }
      // The sandbox is built from the paths just validated, so swapping a link afterwards changes nothing.
      const granted: SandboxPolicy = {
        writable,
        protect: [...policy.protect, ...top.spec.policy.protect],
        lock: [...policy.lock, ...top.spec.policy.lock],
        gitDirs: [...policy.gitDirs, ...top.spec.policy.gitDirs],
        checkouts: [],
        credentials: jobAgentDir(top.dir),
        agentDir: getAgentDir(),
        jobDir: dir,
      };
      granted.checkouts = sweepFor(granted).roots;
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'granted.json'), JSON.stringify(writable));
      launchBrokered(top.dir, dir, spec, sweepFor(granted), sandboxed(spec.command, granted), socket);
    } catch {
      // One request failing must not stop the others.
    }
  }
}

export default function pstack(pi: ExtensionAPI) {
  let watcher: ReturnType<typeof setInterval> | undefined;
  const stoppedSeries = new Set<string>();
  // Jobs a tmux_jobs wait call is blocking on. Their report goes back as that call's result, not as a wake.
  const awaited = new Set<string>();

  // Reports a finished job whose wake was just claimed, restarting it first when it is a heartbeat that exited cleanly.
  const finish = (job: Job): string => {
    if (!job.spec.repeat) return report(job);
    // A heartbeat repeats only while it exits cleanly, so a failing command cannot wake the session in a tight loop.
    if (job.status.state !== 'exited' || job.status.code !== 0) return `${report(job)}\n\nThis heartbeat did not exit cleanly, so it was not restarted.`;
    try {
      if (stoppedSeries.has(job.spec.series)) return report(job);
      // The next run gets its own temp directory in place of this one's.
      const policy = { ...job.spec.policy, writable: job.spec.policy.writable.filter((path) => path !== join(job.dir, 'tmp')) };
      start(jobsRoot(), { ...job.spec, policy, id: newJobId(job.spec.name), brokered: false, createdAt: new Date().toISOString() });
      return report(job);
    } catch (error) {
      return `${report(job)}\n\nThis heartbeat could not be restarted: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const deliverFinished = (ctx: ExtensionContext): void => {
    const jobs = list(jobsRoot(), ctx.sessionManager.getSessionId());
    for (const job of jobs) {
      if (job.spec.wake === null || job.status.state === 'running' || awaited.has(job.spec.id) || !claimWake(job)) continue;
      pi.sendMessage({ customType: 'pstack-job', content: finish(job), display: true }, { triggerTurn: true, deliverAs: 'followUp' });
    }
    if (ctx.hasUI) {
      const running = jobs.filter((job) => job.status.state === 'running').length;
      ctx.ui.setStatus('pstack', running ? `tmux jobs: ${running} running` : undefined);
    }
  };

  const interactive = (ctx: ExtensionContext): boolean => ctx.mode === 'tui' || ctx.mode === 'rpc';

  // Only macOS brokers nested jobs. On Linux a worker starts its own under bubblewrap, so a request there is never served.
  const serve = (ctx: ExtensionContext): void => {
    if (process.platform !== 'darwin' || brokering()) return;
    const owner = ctx.sessionManager.getSessionId();
    for (const top of list(jobsRoot(), owner)) if (top.spec.kind === 'pi') serveRequests(top, tmuxSocket(owner), join(top.dir, 'nested'), top.status.state !== 'running');
  };

  // Carries refreshed OAuth tokens between your credentials and each top-level job's copy, once more after the job ends.
  const syncCredentials = (ctx: ExtensionContext): void => {
    if (insideJob()) return;
    for (const job of list(jobsRoot(), ctx.sessionManager.getSessionId())) {
      const copy = jobAgentDir(job.dir);
      if (!existsSync(join(copy, 'auth.json')) || existsSync(join(job.dir, 'tokens-synced'))) continue;
      if (syncTokens(getAgentDir(), copy) && job.status.state !== 'running') writeFileSync(join(job.dir, 'tokens-synced'), '');
    }
  };

  // Each step runs on its own, so one failing does not stop the others.
  const tick = (ctx: ExtensionContext): void => {
    for (const step of [() => syncCredentials(ctx), () => serve(ctx), () => interactive(ctx) && deliverFinished(ctx)]) {
      try {
        step();
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(`pstack job watcher: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    }
  };

  pi.on('session_start', async (_event, ctx) => {
    clearInterval(watcher);
    watcher = setInterval(() => tick(ctx), POLL_MS);
  });

  pi.on('session_shutdown', async (_event, ctx) => {
    clearInterval(watcher);
    watcher = undefined;
    // A print-mode worker's leftover jobs, such as a dev server it never stopped, end with it.
    if (interactive(ctx)) return;
    try {
      execFileSync('tmux', ['-S', tmuxSocket(ctx.sessionManager.getSessionId()), 'kill-server'], { stdio: 'ignore' });
    } catch {
      // It started no jobs.
    }
  });

  // A print-mode run would exit while its jobs still run, so it waits for them and continues with their reports.
  pi.on('agent_before_settle', async (event, ctx) => {
    if (interactive(ctx)) return;
    const owner = ctx.sessionManager.getSessionId();
    const pending = () => list(jobsRoot(), owner).filter((job) => job.spec.wake !== null && !job.spec.repeat && !existsSync(join(job.dir, 'woken')));
    if (pending().length === 0) return;
    while (pending().some((job) => job.status.state === 'running')) await new Promise((done) => setTimeout(done, POLL_MS));
    syncCredentials(ctx);
    const finished = pending().filter(claimWake);
    return {
      entries: [...event.entries, ...finished.map((job) => ({ type: 'custom_message' as const, customType: 'pstack-job', content: finish(job), display: true }))],
      continue: true,
    };
  });

  pi.on('before_agent_start', async (event) => {
    const options = event.systemPromptOptions;
    for (const rule of [...rules, skillsHint]) if (!options.promptGuidelines.includes(rule)) options.promptGuidelines.push(rule);
    const models = modelsFile(getAgentDir());
    if (existsSync(models)) options.sections['pstack-models'] = `Role lines from ${models}, written by /skill:setup-pstack:\n${readFileSync(models, 'utf8').trim()}`;
  });

  if (!startedByWorker()) {
    pi.registerTool({
      name: 'pi_spawn',
      label: 'Spawn Pi',
      description:
        'Start a separate Pi process in its own tmux session, inside a Seatbelt (macOS) or bubblewrap (Linux) sandbox, with a standalone brief. It runs in parallel and does not see this conversation. When it exits you are woken with its final report. Each call starts one fresh instance; to start several, call pi_spawn several times in one message. A Pi it starts can start workers too, and those workers cannot.',
      promptSnippet: 'Start a parallel Pi instance in tmux with a standalone brief, then get woken with its report',
      promptGuidelines: [
        'Use pi_spawn wherever a pstack skill says to spawn a worker, delegate, explorer, reviewer, or Pi instance. Pi has no subagents.',
        'Write each pi_spawn brief so it stands alone. The spawned Pi sees only the brief, never this conversation.',
      ],
      parameters: Type.Object({
        name: Type.String({ description: 'Short label for the job, such as "explorer-auth" or "runner-2".' }),
        brief: Type.String({ description: 'The complete standalone prompt for the spawned Pi.' }),
        agent: Type.Optional(stringEnum(AGENTS, `Role instructions from pstack agents/<agent>.md, appended to the spawned system prompt. Roles:\n${agentRoles.join('\n')}`)),
        model: Type.Optional(Type.String({ description: 'provider/id as `pi --list-models` prints it. Omit to use this session model.' })),
        thinking: Type.Optional(stringEnum(THINKING, 'Thinking level. Omit to use the model default.')),
        readonly: Type.Optional(Type.Boolean({ description: 'Deny writes to the project and remove the edit and write tools. Temp directories stay writable. Default false.' })),
        worktree: Type.Optional(Type.String({ description: 'Branch for a new git worktree the spawned Pi works in, created from base. Writes are confined to that worktree.' })),
        base: Type.Optional(Type.String({ description: "Ref the new worktree branch starts from. Default is this session's current HEAD, not the repository's default branch, so pass the default branch to start from it." })),
        cwd: Type.Optional(Type.String({ description: 'Working directory inside this project when no worktree is requested. Default this session cwd.' })),
        resume: Type.Optional(Type.String({ description: 'Job id of a finished pi_spawn job whose session the brief continues. Use only when that session holds state too costly to move.' })),
        wake: Type.Optional(Type.Boolean({ description: 'Wake this session with the report when the job exits. Default true.' })),
      }),
      async execute(_id, params, _signal, _update, ctx) {
        const root = jobsRoot();
        const id = newJobId(params.name);
        const dir = join(root, id);
        const owner = ctx.sessionManager.getSessionId();
        const prior = params.resume === undefined ? undefined : read(root, params.resume, owner);
        if (params.resume !== undefined && (prior === undefined || prior.spec.kind !== 'pi' || prior.status.state === 'running')) {
          throw new Error(`resume needs a finished pi_spawn job id from this session, got "${params.resume}".`);
        }
        if (params.resume !== undefined && params.worktree !== undefined) throw new Error('resume continues in the earlier job checkout, so it cannot take a worktree.');
        // A resumed worker keeps the model, thinking level, role, and readonly it started with unless the call says otherwise.
        const earlier = prior?.spec.command ?? [];
        const model = resolveModel(ctx, params.model ?? flagValue(earlier, '--model'));
        const thinking = params.thinking ?? flagValue(earlier, '--thinking');
        const priorRole = flagValue(earlier, '--append-system-prompt') && prior ? join(prior.dir, 'agent.md') : undefined;
        // Refreshing the worker's credentials now, under Pi's lock, means a worker rarely has to refresh one itself.
        const provider = model?.slice(0, model.indexOf('/'));
        const chosen = model && provider ? ctx.modelRegistry.find(provider, model.slice(model.indexOf('/') + 1)) : undefined;
        if (chosen) await ctx.modelRegistry.getApiKeyAndHeaders(chosen).catch(() => undefined);
        // A job's credentials copy holds no commands, so the worker's own provider gets its command resolved here, once.
        const resolved: Record<string, string> = {};
        if (provider && !insideJob() && commandProviders(getAgentDir()).includes(provider)) {
          const key = await ctx.modelRegistry.getApiKeyForProvider(provider).catch(() => undefined);
          if (key) resolved[provider] = key;
        }
        const base = prior?.spec.cwd ?? projectPath(ctx, params.cwd);
        const readonly = params.readonly ?? earlier.includes('--exclude-tools');
        // The job directory itself stays read-only to the worker, so it cannot rewrite its own spec or exit code.
        const sessionDir = (prior && flagValue(earlier, '--session-dir')) || join(dir, 'session');
        const writable = [sessionDir, join(dir, 'nested')];
        let createdBranch = false;
        try {
          for (const path of writable) mkdirSync(path, { recursive: true });
          const cwd = params.worktree !== undefined && prior === undefined ? join(dir, 'worktree') : base;
          if (cwd !== base && params.worktree !== undefined) createdBranch = addWorktree(base, cwd, params.worktree, params.base);
          const common = gitPath(cwd, '--git-common-dir');
          if (!readonly) writable.push(cwd, ...(common ? [common] : []));
          const guarded = protectedPaths(cwd, common);
          const piCommand = process.argv[1] && isAbsolute(process.argv[1]) ? [process.execPath, process.argv[1]] : ['pi'];
          const argv = [
            ...piCommand,
            '-p',
            '--session-dir',
            sessionDir,
            ...(prior ? ['--continue'] : []),
            ...(model ? ['--model', model] : []),
            ...(thinking ? ['--thinking', thinking] : []),
            ...(params.agent || priorRole ? ['--append-system-prompt', join(dir, 'agent.md')] : []),
            ...(readonly ? ['--exclude-tools', 'edit,write'] : []),
            ctx.isProjectTrusted() ? '--approve' : '--no-approve',
            `@${join(dir, 'brief.md')}`,
          ];
          const files: Record<string, string> = { 'brief.md': params.brief };
          if (params.agent) files['agent.md'] = stripFrontmatter(readFileSync(join(packageRoot, 'agents', `${params.agent}.md`), 'utf8'));
          else if (priorRole) files['agent.md'] = readFileSync(priorRole, 'utf8');
          const spec: JobSpec = {
            id,
            name: params.name,
            kind: 'pi',
            cwd,
            argv: [],
            command: argv,
            policy: { writable, protect: guarded.protect, lock: guarded.lock, gitDirs: guarded.gitDirs, checkouts: [], credentials: '', agentDir: getAgentDir(), jobDir: dir },
            brokered: false,
            owner,
            wake: params.wake === false ? null : 'Review this report against the brief and inspect the artifacts it names before you rely on it.',
            repeat: false,
            series: id,
            socket: tmuxSocket(owner),
            sweep: { roots: [], protect: [] },
            out: dir,
            createdAt: new Date().toISOString(),
          };
          const job = start(root, spec, files, resolved);
          return text(`Started ${describe(job)}\n  cwd: ${cwd}${spec.wake ? '\nYou will be woken with its report when it exits. Keep working or end your turn.' : ''}`);
        } catch (error) {
          rmSync(dir, { recursive: true, force: true });
          if (params.worktree !== undefined && gitPath(base, '--git-common-dir')) {
            git(base, ['worktree', 'prune']);
            if (createdBranch) git(base, ['branch', '-D', params.worktree]);
          }
          throw error;
        }
      },
    });
  }

  pi.registerTool({
    name: 'tmux_run',
    label: 'Run in tmux',
    description:
      'Run a shell command in its own tmux session, inside the pstack sandbox, instead of a background shell. Use it for watchers, dev servers, long builds, and heartbeat timers. With wake set, you are woken with that message and the output tail when the command exits. With repeat, the command restarts each time it exits cleanly, so `sleep 3600` plus a wake message is an hourly tick.',
    promptSnippet: 'Run a long-lived or watched command in tmux and get woken when it exits',
    promptGuidelines: ['Use tmux_run for any command that would otherwise run in the background. Never background a command with &, nohup, setsid, or disown.'],
    parameters: Type.Object({
      name: Type.String({ description: 'Short label, such as "watch-pr-123" or "dev-server".' }),
      command: Type.String({ description: 'Shell command, run with bash -c.' }),
      cwd: Type.Optional(Type.String({ description: 'Working directory inside this project. Default this session cwd. The command may write only here, in its git directory, and in temp directories.' })),
      wake: Type.Optional(Type.String({ description: 'Message to wake this session with when the command exits. Omit for a server you will stop yourself.' })),
      repeat: Type.Optional(Type.Boolean({ description: 'Restart the command after each clean exit and wake each time. Requires wake. Stop it with tmux_jobs stop.' })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      if (params.repeat && params.wake === undefined) throw new Error('repeat needs a wake message, or nothing would ever notice the ticks.');
      const root = jobsRoot();
      const id = newJobId(params.name);
      const owner = ctx.sessionManager.getSessionId();
      const cwd = projectPath(ctx, params.cwd);
      const common = gitPath(cwd, '--git-common-dir');
      const guarded = protectedPaths(cwd, common);
      const policy = { writable: [cwd, ...(common ? [common] : [])], protect: guarded.protect, lock: guarded.lock, gitDirs: guarded.gitDirs, checkouts: [], credentials: '', agentDir: getAgentDir(), jobDir: join(root, id) };
      const spec: JobSpec = {
        id,
        name: params.name,
        kind: 'command',
        cwd,
        argv: [],
        command: ['bash', '-c', params.command],
        policy,
        brokered: false,
        owner,
        wake: params.wake ?? null,
        repeat: params.repeat ?? false,
        series: id,
        socket: tmuxSocket(owner),
        sweep: { roots: [], protect: [] },
        out: join(root, id),
        createdAt: new Date().toISOString(),
      };
      try {
        return text(`Started ${describe(start(root, spec))}`);
      } catch (error) {
        rmSync(join(root, id), { recursive: true, force: true });
        throw error;
      }
    },
  });

  pi.registerTool({
    name: 'tmux_jobs',
    label: 'tmux jobs',
    description:
      "Inspect or control this session's pi_spawn and tmux_run jobs. list shows every job with its state and a command to follow its output. output prints the last lines of one job. wait blocks until the named jobs (default all running) exit or the timeout passes, then returns their reports. stop ends jobs, and every later run of a repeating one, and suppresses their wake.",
    parameters: Type.Object({
      action: stringEnum(['list', 'output', 'wait', 'stop'] as const),
      ids: Type.Optional(Type.Array(Type.String(), { description: 'Job ids. Required for output and stop.' })),
      lines: Type.Optional(Type.Number({ description: 'Lines for output. Default 80.' })),
      timeout_seconds: Type.Optional(Type.Number({ description: 'Longest wait. Default 1800.' })),
    }),
    async execute(_id, params, signal, update, ctx) {
      const root = jobsRoot();
      const owner = ctx.sessionManager.getSessionId();
      const named = (): Job[] => {
        if (!params.ids?.length) throw new Error(`${params.action} needs ids.`);
        return params.ids.map((id) => {
          const job = read(root, id, owner);
          if (!job) throw new Error(`No job ${id} in this session.`);
          return job;
        });
      };
      switch (params.action) {
        case 'list': {
          const jobs = list(root, owner);
          return text(jobs.length ? jobs.map(describe).join('\n') : 'No jobs in this session.');
        }
        case 'output':
          return text(
            named()
              .map((job) => `${describe(job)}\n${tail(outputPath(job.spec.out), params.lines ?? 80)}`)
              .join('\n\n'),
          );
        case 'stop': {
          const series = new Set(named().map((job) => job.spec.series));
          // Recorded before stopping, so a run that finishes meanwhile is not restarted into a run this stop misses.
          for (const id of series) stoppedSeries.add(id);
          // Every run in the series, finished ones included, so a run that just exited is not restarted after the stop.
          const jobs = list(root, owner).filter((job) => series.has(job.spec.series));
          await Promise.all(jobs.map(stop));
          return text(`Stopped ${jobs.map((job) => job.spec.id).join(', ')}.`);
        }
        case 'wait': {
          const ids = params.ids?.length
            ? params.ids
            : list(root, owner)
                // A heartbeat never stops on its own, so waiting on everything leaves heartbeats out.
                .filter((job) => job.status.state === 'running' && !job.spec.repeat)
                .map((job) => job.spec.id);
          const deadline = Date.now() + (params.timeout_seconds ?? 1800) * 1000;
          const current = () => ids.map((id) => read(root, id, owner)).filter((job): job is Job => job !== undefined);
          for (const id of ids) awaited.add(id);
          try {
            while (current().some((job) => job.status.state === 'running') && Date.now() < deadline && !signal?.aborted) {
              update?.(text(`Waiting on ${current().filter((job) => job.status.state === 'running').length} job(s)...`));
              await new Promise((done) => setTimeout(done, POLL_MS));
            }
            const jobs = current();
            // A job whose wake the watcher already delivered is reported plainly, without restarting a heartbeat twice.
            const reports = jobs.map((job) => (job.status.state === 'running' ? `${describe(job)}\n  still running` : claimWake(job) ? finish(job) : report(job)));
            return text(reports.join('\n\n') || 'No jobs to wait on.');
          } finally {
            for (const id of ids) awaited.delete(id);
          }
        }
        default: {
          const unreachable: never = params.action;
          throw new Error(`Unknown action ${String(unreachable)}`);
        }
      }
    },
  });
}
