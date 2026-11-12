// Runs one workflow in the real Pi binary, over RPC, in a throwaway git repo, and returns what the run left behind.
// Two drivers share this code and the checkers. The scripted driver loads fixtures/scenario-model.ts, a model that
// replays a scenario. The real driver (PSTACK_E2E_REAL_MODEL=<provider>/<id>) lets that model decide.
import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { type Claim, type GitState, type Json, loadGit, loadPlans, loadRun, loadSession, type RunView, type Session, type Snapshot } from './view.ts';

export const PKG = resolve(import.meta.dirname, '../../..');
export const PI = process.env['PSTACK_E2E_PI'] || '/Users/josh-desktop/.pi/agent/bin/pi';
export const SCENARIO_MODEL = join(PKG, 'tests/workflow-parity/fixtures/scenario-model.ts');
export const REAL_MODEL = process.env['PSTACK_E2E_REAL_MODEL'] ?? '';
/**
 * Sandboxes live under a folder named for this checkout, never under a shared `pstack-wf-*` name: several checkouts
 * run this suite on one machine, and a cleanup that sweeps another checkout's sandboxes must not reach these.
 */
export const SANDBOX_ROOT = join(tmpdir(), `pstack-parity-${createHash('sha256').update(PKG).digest('hex').slice(0, 8)}`);
export const REAL_MODEL_B = process.env['PSTACK_E2E_REAL_MODEL_B'] ?? '';

export interface Commit {
  message: string;
  files: Record<string, string | null>;
}

export interface Ctx {
  sandbox: string;
  repo: string;
  pkg: string;
  base: string;
  /** Every commit of the fixture history, oldest first. */
  commits: string[];
  runId: string;
  /** Absolute path of a generated skill's SKILL.md, a playbook, or any file under generated/skills. */
  skill: (name: string) => string;
  playbook: (name: string) => string;
  agentDir: string;
  sessionsDir: string;
}

export type ModelRoles = Record<string, string | string[]>;

export interface Scenario {
  actors: Record<string, unknown[]>;
}

export interface RunSpec {
  family: string;
  history: Commit[];
  /** The text sent as the user's first message, normally a slash command. */
  prompt: (ctx: Ctx) => string;
  /** Later user messages, each sent once the run is quiet again: a chat with more than one turn. */
  followUps?: (ctx: Ctx) => string[];
  scenario: (ctx: Ctx) => Scenario;
  runId: string;
  roles?: ModelRoles;
  /** Files placed into the sandbox's agent directory before the run, relative to it. */
  agentFiles?: Record<string, string>;
  /** Called after the repo exists and before Pi starts, for fixtures that live outside the repo. */
  prepare?: (ctx: Ctx) => void;
  /** Removes anything the run left outside the sandbox. */
  cleanup?: (ctx: Ctx) => void;
  timeoutMs?: number;
}

export const SCRIPTED_ROLES: ModelRoles = {
  'feature, refactoring': 'sim/grok-sim',
  'bug-fix': 'sim/grok-sim',
  'perf-issue': 'sim/grok-sim',
  hillclimb: 'sim/deepseek-sim',
  'judgment and prose': 'sim/claude-sim',
  'hardest tasks': 'sim/claude-sim',
  'how explorer': 'sim/deepseek-sim',
  'how explainer': 'sim/claude-sim',
  'why investigators': 'sim/deepseek-sim',
  'why synthesizer': 'sim/claude-sim',
  'reflect tooling': 'sim/deepseek-sim',
  'reflect judgment, divergent, synthesizer': 'sim/claude-sim',
  'arena runners': ['sim/claude-sim', 'sim/grok-sim'],
  'arena cross-judge pool': ['sim/claude-sim', 'sim/grok-sim'],
  'swarm workers': 'sim/deepseek-sim',
  'architect runners': ['sim/claude-sim', 'sim/grok-sim'],
  'interrogate reviewers': ['sim/claude-sim', 'sim/grok-sim', 'sim/deepseek-sim'],
};

/** Every role on the one real model, and the panels on the second when PSTACK_E2E_REAL_MODEL_B names one. */
export function realRoles(): ModelRoles {
  const second = REAL_MODEL_B || REAL_MODEL;
  return Object.fromEntries(Object.entries(SCRIPTED_ROLES).map(([role, value]) => [role, Array.isArray(value) ? value.map((_, index) => (index === 0 ? REAL_MODEL : second)) : REAL_MODEL]));
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=wf', '-c', 'user.email=wf@example.com', '-c', 'commit.gpgsign=false', '-C', repo, ...args], { encoding: 'utf8' }).trim();
}

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export function realTmux(socket: string): string[] {
  const listed = spawnSync('tmux', ['-L', socket, 'list-sessions', '-F', '#{session_name}'], { encoding: 'utf8' });
  return listed.status === 0 ? listed.stdout.split('\n').filter(Boolean) : [];
}

function buildSandbox(spec: RunSpec, driver: 'scripted' | 'real'): { ctx: Ctx; socket: string } {
  mkdirSync(SANDBOX_ROOT, { recursive: true });
  const sandbox = realpathSync(mkdtempSync(join(SANDBOX_ROOT, 'wf-')));
  const repo = join(sandbox, 'repo');
  const home = join(sandbox, 'home');
  const agentDir = join(home, '.pi', 'agent');
  const sessionsDir = join(sandbox, 'sessions');
  for (const dir of [repo, agentDir, sessionsDir, join(agentDir, 'pstack')]) mkdirSync(dir, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  const commits: string[] = [];
  for (const commit of spec.history) {
    for (const [path, content] of Object.entries(commit.files)) {
      const full = join(repo, path);
      if (content === null) rmSync(full, { force: true });
      else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', commit.message);
    commits.push(git(repo, 'rev-parse', 'HEAD'));
  }
  const ctx: Ctx = {
    sandbox,
    repo,
    pkg: PKG,
    base: commits.at(-1) as string,
    commits,
    runId: spec.runId,
    skill: (name) => join(PKG, 'generated', 'skills', name.includes('/') ? name : `${name}/SKILL.md`),
    playbook: (name) => join(PKG, 'generated', 'skills', 'poteto-mode', 'playbooks', `${name}.md`),
    agentDir,
    sessionsDir,
  };
  const settings: Json = { quietStartup: true, packages: [PKG], enableSkillCommands: false };
  if (driver === 'scripted') {
    settings['extensions'] = [SCENARIO_MODEL];
    settings['defaultProvider'] = 'sim';
    settings['defaultModel'] = 'claude-sim';
  } else {
    const [provider = '', ...id] = REAL_MODEL.split('/');
    settings['defaultProvider'] = provider;
    settings['defaultModel'] = id.join('/');
    for (const file of ['auth.json', 'models.json', 'models-store.json']) {
      const source = join(process.env['PSTACK_E2E_AGENT_DIR'] ?? join(process.env['HOME'] ?? '', '.pi', 'agent'), file);
      if (existsSync(source)) cpSync(source, join(agentDir, file));
    }
  }
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify(settings, null, 2));
  const roles = spec.roles ?? (driver === 'scripted' ? SCRIPTED_ROLES : realRoles());
  writeFileSync(join(agentDir, 'pstack', 'models.json'), JSON.stringify({ schemaVersion: 1, budget: 'large', roles }, null, 2));
  for (const [path, content] of Object.entries(spec.agentFiles ?? {})) {
    mkdirSync(dirname(join(agentDir, path)), { recursive: true });
    writeFileSync(join(agentDir, path), content);
  }
  spec.prepare?.(ctx);
  return { ctx, socket: `pstack-test-wf-${randomBytes(4).toString('hex')}` };
}

type RpcEvent = { type: string } & Json;

class Rpc {
  readonly events: RpcEvent[] = [];
  stderr = '';
  private buffer = '';
  private next = 0;
  private waiters = new Map<string, (event: RpcEvent) => void>();
  private failers = new Set<(error: Error) => void>();
  /** How pi ended, once it has; a request after that fails at once with this cause. */
  exit: string | null = null;
  readonly child: ChildProcess;
  constructor(child: ChildProcess) {
    this.child = child;
    child.once('error', (error) => this.ended(`failed to start (${error.message})`));
    child.once('close', (code, signal) => this.ended(`exited (code ${code}, signal ${signal})`));
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8');
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      for (let index = this.buffer.indexOf('\n'); index !== -1; index = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line === '') continue;
        const event = JSON.parse(line) as RpcEvent;
        this.events.push(event);
        if (event.type === 'response') this.waiters.get(String(event['id']))?.(event);
      }
    });
  }
  private ended(how: string): void {
    this.exit ??= how;
    for (const fail of [...this.failers]) fail(this.failure(`pi ${how} before it answered`));
  }
  failure(what: string): Error {
    return new Error(`${what}; pi stderr tail:\n${this.stderr.slice(-2000) || '(empty)'}`);
  }
  request(command: Json, timeoutMs = 30_000): Promise<RpcEvent> {
    this.next += 1;
    const id = `r${this.next}`;
    const type = String(command['type']);
    return new Promise((done, fail) => {
      if (this.exit !== null) return fail(this.failure(`pi ${this.exit} before ${type} was sent`));
      const settle = () => {
        clearTimeout(timer);
        this.waiters.delete(id);
        this.failers.delete(failed);
      };
      const failed = (error: Error) => {
        settle();
        fail(new Error(`${type}: ${error.message}`, { cause: error }));
      };
      const timer = setTimeout(() => failed(this.failure(`no answer within ${timeoutMs} ms`)), timeoutMs);
      this.failers.add(failed);
      this.waiters.set(id, (event) => {
        settle();
        done(event);
      });
      this.child.stdin?.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }
}

const WORKING = new Set(['starting', 'running', 'cancelling', 'stopping']);

/** A worker's assignment is written by the model, so it may be read half-written: that is not a watch. */
function isWatch(assignment: string): boolean {
  try {
    return (JSON.parse(readFileSync(assignment, 'utf8')) as Json)['kind'] === 'watch';
  } catch {
    return false;
  }
}

function workerPhases(repo: string): string[] {
  const runs = join(repo, '.pi', 'pstack', 'runs');
  if (!existsSync(runs)) return [];
  return readdirSync(runs).flatMap((runId) => {
    const workers = join(runs, runId, 'workers');
    if (!existsSync(workers)) return [];
    return readdirSync(workers).flatMap((id) => {
      const assignment = join(workers, id, 'assignment.json');
      // A watch is a timer the run arms and the parent steps away from: it never holds the run open.
      if (isWatch(assignment)) return [];
      const claim = join(workers, id, 'claim');
      const statePath = join(workers, id, 'state.json');
      if (!existsSync(statePath)) return [existsSync(claim) ? 'starting' : 'unspawned'];
      try {
        return [String((JSON.parse(readFileSync(statePath, 'utf8')) as Json)['phase'])];
      } catch {
        return ['starting'];
      }
    });
  });
}

function observeRuns(repo: string, history: Record<string, Snapshot[]>, claims: Claim[]): () => void {
  let seq = 0;
  const timer = setInterval(() => {
    try {
      observe();
    } catch {
      // A file the run is replacing or removing at this instant; the next tick sees its settled state.
    }
  }, 10);
  const observe = () => {
    const runs = join(repo, '.pi', 'pstack', 'runs');
    if (!existsSync(runs)) return;
    for (const id of readdirSync(runs)) {
      const path = join(runs, id, 'TODO.md');
      if (existsSync(path)) {
        const text = readFileSync(path, 'utf8');
        const seen = (history[id] ??= []);
        if (seen.at(-1)?.text !== text) seen.push({ t: Date.now(), seq: seq++, text });
      }
      const workers = join(runs, id, 'workers');
      if (!existsSync(workers)) continue;
      for (const workerId of readdirSync(workers)) if (existsSync(join(workers, workerId, 'claim')) && !claims.some((claim) => claim.runId === id && claim.workerId === workerId)) claims.push({ runId: id, workerId, seq: seq++ });
    }
  };
  return () => clearInterval(timer);
}

export interface Meta {
  family: string;
  driver: 'scripted' | 'real';
  base: string;
  parentSessionFile: string | null;
  prompt: string;
  timedOut: boolean;
  tmuxSocket: string;
  piStderr: string;
}

export interface RunOutcome {
  sandbox: string;
  view: RunView;
  meta: Meta;
  cleanup: () => void;
}

export interface DriverOptions {
  /** The pi binary; the suite's own pi unless a test drives a stand-in. */
  pi?: string;
  /** How long one RPC request may go unanswered. */
  rpcTimeoutMs?: number;
}

/** Runs the workflow; a run that fails leaves no sandbox behind, because its error already carries pi's stderr. */
export async function runWorkflow(spec: RunSpec, driver: 'scripted' | 'real', options: DriverOptions = {}): Promise<RunOutcome> {
  if (driver === 'real' && REAL_MODEL === '') throw new Error('PSTACK_E2E_REAL_MODEL is not set');
  const built = buildSandbox(spec, driver);
  try {
    return await execute(spec, driver, options, built);
  } catch (error) {
    spec.cleanup?.(built.ctx);
    removeSandbox(built.ctx.sandbox);
    throw error;
  }
}

async function execute(spec: RunSpec, driver: 'scripted' | 'real', options: DriverOptions, { ctx, socket }: { ctx: Ctx; socket: string }): Promise<RunOutcome> {
  const scenarioPath = join(ctx.sandbox, 'scenario.json');
  if (driver === 'scripted') writeFileSync(scenarioPath, JSON.stringify(spec.scenario(ctx), null, 2));
  const prompt = spec.prompt(ctx);
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: join(ctx.sandbox, 'home'), PI_CODING_AGENT_DIR: ctx.agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PSTACK_TMUX_SOCKET: socket };
  for (const name of Object.keys(env).filter((key) => key.startsWith('PSTACK_') && key !== 'PSTACK_TMUX_SOCKET')) delete env[name];
  for (const name of ['PI_CODING_AGENT_SESSION_DIR', 'PI_SESSION_FILE', 'TMUX']) delete env[name];
  if (driver === 'scripted') env['PSTACK_SCENARIO'] = scenarioPath;
  const model = driver === 'scripted' ? 'sim/claude-sim' : REAL_MODEL;
  const child = spawn(options.pi ?? PI, ['--mode', 'rpc', '--offline', '--session-dir', ctx.sessionsDir, '--model', model], { cwd: ctx.repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const rpc = new Rpc(child);
  const history: Record<string, Snapshot[]> = {};
  const claims: Claim[] = [];
  const stopObserving = observeRuns(ctx.repo, history, claims);
  const timeoutMs = spec.timeoutMs ?? (driver === 'scripted' ? 120_000 : 900_000);
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  let parentSessionFile: string | null = null;
  try {
    const state = await rpc.request({ type: 'get_state' }, options.rpcTimeoutMs);
    parentSessionFile = ((state['data'] as Json | undefined)?.['sessionFile'] as string | undefined) ?? null;
    const untilQuiet = async (): Promise<boolean> => {
      let quietSince = Date.now();
      let seen = rpc.events.length;
      let workerSignature = '';
      while (true) {
        await sleep(300);
        const signature = JSON.stringify(workerPhases(ctx.repo));
        if (rpc.events.length !== seen || signature !== workerSignature) {
          seen = rpc.events.length;
          workerSignature = signature;
          quietSince = Date.now();
        }
        if (Date.now() > deadline) return false;
        if (Date.now() - quietSince < 2_500) continue;
        const parent = ((await rpc.request({ type: 'get_state' }, options.rpcTimeoutMs))['data'] ?? {}) as Json;
        const idle = parent['isStreaming'] === false && parent['pendingMessageCount'] === 0;
        if (idle && !workerPhases(ctx.repo).some((phase) => WORKING.has(phase))) return true;
      }
    };
    for (const message of [prompt, ...(spec.followUps?.(ctx) ?? [])]) {
      const accepted = await rpc.request({ type: 'prompt', message }, options.rpcTimeoutMs);
      if (accepted['success'] !== true) throw new Error(`prompt rejected: ${JSON.stringify(accepted)}`);
      if (!(await untilQuiet())) {
        timedOut = true;
        break;
      }
    }
  } finally {
    stopObserving();
    if (child.exitCode === null) {
      child.stdin?.end();
      await new Promise<void>((done) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          done();
        }, 10_000);
        child.once('close', () => {
          clearTimeout(timer);
          done();
        });
      });
    }
    spawnSync('tmux', ['-L', socket, 'kill-server'], { stdio: 'ignore' });
    rmSync(join(process.env['TMUX_TMPDIR'] || '/tmp', `tmux-${process.getuid?.()}`, socket), { force: true });
  }
  requireSandbox(ctx.sandbox, 'after pi stopped', rpc.stderr);
  if (!timedOut && (parentSessionFile === null || !existsSync(parentSessionFile))) throw rpc.failure(`pi ${rpc.exit ?? 'ran'} but left no session file${parentSessionFile === null ? '' : ` at ${parentSessionFile}`}`);
  const meta: Meta = { family: spec.family, driver, base: ctx.base, parentSessionFile, prompt, timedOut, tmuxSocket: socket, piStderr: rpc.stderr.slice(-4000) };
  writeFileSync(join(ctx.sandbox, 'meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(join(ctx.sandbox, 'todo-history.json'), JSON.stringify(history, null, 2));
  writeFileSync(join(ctx.sandbox, 'claims.json'), JSON.stringify(claims, null, 2));
  writeFileSync(join(ctx.sandbox, 'git.json'), JSON.stringify(loadGit(ctx.repo, ctx.base), null, 2));
  const view = loadView(ctx.sandbox);
  return {
    sandbox: ctx.sandbox,
    view,
    meta,
    cleanup: () => {
      spec.cleanup?.(ctx);
      removeSandbox(ctx.sandbox);
    },
  };
}

/** A sandbox another process deleted is reported as that, not as the ENOENT of whichever file is read next. */
export function requireSandbox(sandbox: string, when: string, stderr = ''): void {
  if (!existsSync(join(sandbox, 'repo')) || !existsSync(join(sandbox, 'sessions'))) throw new Error(`sandbox ${sandbox} is gone or gutted ${when}: something outside this run removed it${stderr === '' ? '' : `; pi stderr tail:\n${stderr.slice(-2000)}`}`);
}

/** Removes a sandbox, including worker worktrees git has registered under it. */
export function removeSandbox(sandbox: string): void {
  rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** The view of a sandbox on disk. Mutation tests copy a sandbox and load the copy. */
export function loadView(sandbox: string): RunView {
  const meta = JSON.parse(readFileSync(join(sandbox, 'meta.json'), 'utf8')) as Meta;
  const repo = join(sandbox, 'repo');
  const runsDir = join(repo, '.pi', 'pstack', 'runs');
  const modelsPath = join(sandbox, 'home', '.pi', 'agent', 'pstack', 'models.json');
  const sessionFiles = readdirSync(join(sandbox, 'sessions')).filter((file) => file.endsWith('.jsonl'));
  const parentFile = meta.parentSessionFile !== null && existsSync(meta.parentSessionFile) ? meta.parentSessionFile : join(sandbox, 'sessions', sessionFiles[0] ?? 'missing.jsonl');
  const parent: Session = existsSync(parentFile) ? loadSession(parentFile) : { file: parentFile, cwd: null, messages: [], toolCalls: [], models: [] };
  return {
    family: meta.family,
    driver: meta.driver,
    repo,
    sandbox,
    base: meta.base,
    models: existsSync(modelsPath) ? ((JSON.parse(readFileSync(modelsPath, 'utf8')) as { roles: Record<string, string | string[]> }).roles ?? null) : null,
    parent,
    runs: existsSync(runsDir)
      ? readdirSync(runsDir)
          .sort()
          .map((id) => loadRun(repo, id))
      : [],
    plans: loadPlans(repo),
    todoHistory: existsSync(join(sandbox, 'todo-history.json')) ? (JSON.parse(readFileSync(join(sandbox, 'todo-history.json'), 'utf8')) as Record<string, Snapshot[]>) : {},
    claims: existsSync(join(sandbox, 'claims.json')) ? (JSON.parse(readFileSync(join(sandbox, 'claims.json'), 'utf8')) as Claim[]) : [],
    git: JSON.parse(readFileSync(join(sandbox, 'git.json'), 'utf8')) as GitState,
    pkg: PKG,
    prompt: parent.messages.find((message) => message.role === 'user')?.text ?? meta.prompt,
  };
}
