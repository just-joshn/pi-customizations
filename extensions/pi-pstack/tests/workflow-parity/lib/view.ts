// Reads only what a run leaves behind: Pi session files, the run directory, plan files, and git state. Nothing here
// knows how a run was produced, so the scripted and the real-model driver feed the same checkers.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type Json = Record<string, unknown>;

export interface ToolCall {
  /** Position of the assistant message in the session, for ordering across tools. */
  order: number;
  name: string;
  args: Json;
  resultText: string;
  isError: boolean;
}

export interface Message {
  order: number;
  role: string;
  text: string;
  customType?: string;
  details?: Json;
}

export interface Session {
  file: string;
  cwd: string | null;
  messages: Message[];
  toolCalls: ToolCall[];
  /** The model that answered, as provider/id, from the assistant messages. */
  models: string[];
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: string; text?: string } => typeof part === 'object' && part !== null)
    .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('\n');
};

export function readJsonl(path: string): Json[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Json);
}

export function loadSession(file: string): Session {
  const entries = readJsonl(file);
  const messages: Message[] = [];
  const calls = new Map<string, ToolCall>();
  const toolCalls: ToolCall[] = [];
  const models = new Set<string>();
  let cwd: string | null = null;
  let order = 0;
  for (const entry of entries) {
    if (entry['type'] === 'session') {
      cwd = typeof entry['cwd'] === 'string' ? entry['cwd'] : null;
      continue;
    }
    if (entry['type'] === 'custom_message') {
      messages.push({ order: order++, role: 'custom', text: textOf(entry['content']), customType: String(entry['customType']), ...(typeof entry['details'] === 'object' && entry['details'] !== null ? { details: entry['details'] as Json } : {}) });
      continue;
    }
    if (entry['type'] !== 'message') continue;
    const message = entry['message'] as Json;
    const role = String(message['role']);
    messages.push({ order: order++, role, text: textOf(message['content']) });
    if (role === 'assistant') {
      if (typeof message['provider'] === 'string' && typeof message['model'] === 'string') models.add(`${message['provider']}/${message['model']}`);
      for (const part of message['content'] as Json[]) {
        if (part['type'] !== 'toolCall') continue;
        const call: ToolCall = { order: order - 1, name: String(part['name']), args: (part['arguments'] ?? {}) as Json, resultText: '', isError: false };
        calls.set(String(part['id']), call);
        toolCalls.push(call);
      }
    }
    if (role === 'toolResult') {
      const call = calls.get(String(message['toolCallId']));
      if (call !== undefined) {
        call.resultText = textOf(message['content']);
        call.isError = message['isError'] === true;
      }
    }
  }
  return { file, cwd, messages, toolCalls, models: [...models] };
}

export interface Receipt {
  id: string;
  runId: string;
  target: string;
  kind: string;
  verdict: string;
  commit: string | null;
  artifacts: { path: string; sha256: string }[];
  [key: string]: unknown;
}

export interface WorkerView {
  id: string;
  dir: string;
  assignment: Json;
  brief: string | null;
  state: Json | null;
  report: string | null;
  session: Session | null;
  worktree: string | null;
  evidenceFiles: string[];
  /** The last assistant text in the worker's session. */
  finalText: string;
}

export interface TodoStep {
  n: number;
  state: 'open' | 'done' | 'skipped';
  /** The complete step text: first line and nested lines, without the checkbox prefix. */
  text: string;
  evidence: string[];
  skip: string | null;
}

export interface RunDir {
  id: string;
  dir: string;
  runJson: Json | null;
  todoText: string | null;
  steps: TodoStep[];
  decisions: string[][] | null;
  events: Json[];
  receipts: Receipt[];
  workers: WorkerView[];
}

export interface Snapshot {
  t: number;
  /** Position in the driver's one observation sequence, shared with claims. */
  seq: number;
  text: string;
}

export interface Claim {
  runId: string;
  workerId: string;
  seq: number;
}

export interface GitState {
  head: string;
  /** Tracked or untracked files changed in the main working tree, excluding .pi/. */
  dirty: string[];
  /** Commits on the main checkout's current branch after the base commit. */
  commitsSinceBase: string[];
  branches: string[];
  worktrees: { path: string; branch: string | null; head: string }[];
  /** Commits each branch holds beyond the base commit, newest first. */
  branchCommits: Record<string, string[]>;
  /** Uncommitted files per registered worktree path. */
  worktreeDirty: Record<string, string[]>;
}

export interface RunView {
  family: string;
  driver: 'scripted' | 'real';
  repo: string;
  sandbox: string;
  base: string;
  /** models.json roles the run was configured with, null when the file is absent. */
  models: Record<string, string | string[]> | null;
  parent: Session;
  runs: RunDir[];
  plans: { path: string; text: string }[];
  /** Distinct TODO.md contents the driver saw, per run id, oldest first. */
  todoHistory: Record<string, Snapshot[]>;
  /** When the driver first saw each worker's claim directory, in the same sequence as todoHistory. */
  claims: Claim[];
  git: GitState;
  pkg: string;
  /** The text of the user's first message to the parent. */
  prompt: string;
}

export const STEP_LINE = /^- \[( |x|X|~)\] (\d+)\. /;

export function parseTodoSteps(text: string): TodoStep[] {
  const lines = text.split('\n');
  const section = lines.findIndex((line) => line === '## Original playbook steps');
  const end = lines.findIndex((line, index) => index > section && line.startsWith('## '));
  const body = section === -1 ? [] : lines.slice(section + 1, end === -1 ? lines.length : end);
  const blocks: string[][] = [];
  for (const line of body) {
    if (STEP_LINE.test(line)) blocks.push([line]);
    else blocks.at(-1)?.push(line);
  }
  return blocks.map((block) => {
    const head = STEP_LINE.exec(block[0] as string) as RegExpExecArray;
    const all = block.join('\n');
    const evidence = [...all.matchAll(/\(evidence: ([^)]+)\)/g)].flatMap((found) => (found[1] ?? '').split(/[,\s]+/).filter(Boolean));
    return {
      n: Number(head[2]),
      state: head[1] === '~' ? 'skipped' : head[1] === ' ' ? 'open' : 'done',
      text: all.slice(head[0].length).trimEnd(),
      evidence,
      skip: /\(skip: ([^)]*)\)/.exec(all)?.[1] ?? null,
    };
  });
}

function readJson(path: string): Json | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Json) : null;
}

function git(repo: string, ...args: string[]): string {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function loadWorker(dir: string, id: string): WorkerView {
  const sessionDir = join(dir, 'session');
  const files = existsSync(sessionDir) ? readdirSync(sessionDir).filter((file) => file.endsWith('.jsonl')) : [];
  const session = files.length === 0 ? null : loadSession(join(sessionDir, files[0] as string));
  const evidenceDir = join(dir, 'evidence');
  return {
    id,
    dir,
    assignment: readJson(join(dir, 'assignment.json')) ?? {},
    brief: existsSync(join(dir, 'brief.md')) ? readFileSync(join(dir, 'brief.md'), 'utf8') : null,
    state: readJson(join(dir, 'state.json')),
    report: existsSync(join(dir, 'report.md')) ? readFileSync(join(dir, 'report.md'), 'utf8') : null,
    session,
    worktree: existsSync(join(dir, 'worktree')) ? join(dir, 'worktree') : null,
    evidenceFiles: existsSync(evidenceDir) ? readdirSync(evidenceDir) : [],
    finalText: [...(session?.messages ?? [])].reverse().find((message) => message.role === 'assistant' && message.text.trim() !== '')?.text ?? '',
  };
}

export function loadRun(project: string, id: string): RunDir {
  const dir = join(project, '.pi', 'pstack', 'runs', id);
  const todoPath = join(dir, 'TODO.md');
  const todoText = existsSync(todoPath) ? readFileSync(todoPath, 'utf8') : null;
  const decisionsPath = join(dir, 'decisions.tsv');
  const eventsPath = join(dir, 'events.jsonl');
  const receiptsDir = join(dir, 'verification', 'receipts');
  const workersDir = join(dir, 'workers');
  return {
    id,
    dir,
    runJson: readJson(join(dir, 'run.json')),
    todoText,
    steps: todoText === null ? [] : parseTodoSteps(todoText),
    decisions: existsSync(decisionsPath)
      ? readFileSync(decisionsPath, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => line.split('\t'))
      : null,
    events: existsSync(eventsPath) ? readJsonl(eventsPath) : [],
    receipts: existsSync(receiptsDir)
      ? readdirSync(receiptsDir)
          .filter((file) => file.endsWith('.json'))
          .map((file) => {
            const raw = JSON.parse(readFileSync(join(receiptsDir, file), 'utf8')) as Json;
            return (raw['receipt'] ?? raw) as Receipt;
          })
      : [],
    workers: existsSync(workersDir)
      ? readdirSync(workersDir)
          .filter((name) => statSync(join(workersDir, name)).isDirectory())
          .sort()
          .map((name) => loadWorker(join(workersDir, name), name))
      : [],
  };
}

export function loadGit(repo: string, base: string): GitState {
  const status = git(repo, 'status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.slice(3))
    .filter((path) => !path.startsWith('.pi/'));
  const worktrees = git(repo, 'worktree', 'list', '--porcelain')
    .split('\n\n')
    .filter((block) => block !== '')
    .map((block) => ({
      path: /^worktree (.*)$/m.exec(block)?.[1] ?? '',
      head: /^HEAD (.*)$/m.exec(block)?.[1] ?? '',
      branch: /^branch refs\/heads\/(.*)$/m.exec(block)?.[1] ?? null,
    }));
  const lines = (text: string) => text.split('\n').filter((line) => line !== '');
  const branches = lines(git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'));
  return {
    branchCommits: Object.fromEntries(branches.map((branch) => [branch, lines(git(repo, 'rev-list', `${base}..${branch}`))])),
    worktreeDirty: Object.fromEntries(worktrees.map((tree) => [tree.path, lines(git(tree.path, 'status', '--porcelain', '--untracked-files=all')).map((line) => line.slice(3))])),
    head: git(repo, 'rev-parse', 'HEAD'),
    dirty: status,
    commitsSinceBase: git(repo, 'rev-list', `${base}..HEAD`)
      .split('\n')
      .filter((line) => line !== ''),
    branches,
    worktrees,
  };
}

export function loadPlans(project: string): { path: string; text: string }[] {
  const dir = join(project, '.pi', 'pstack', 'plans');
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.endsWith('.md'))
        .map((file) => ({ path: join(dir, file), text: readFileSync(join(dir, file), 'utf8') }))
    : [];
}

export const realpath = (path: string): string => realpathSync(path);
