// Mutations of a finished run's artifacts. Each one models a way a run can break its contract, so a checker that
// passes the mutated run is not a checker.
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { immutableTodoBlock, readTodoLedger, replaceTodoLedger, type TodoLedgerEntry, type TodoStatus, upstreamSteps } from '../../../src/todo.ts';
import { loadView, requireSandbox } from './driver.ts';
import { loadGit, type RunView } from './view.ts';

export interface Negative {
  name: string;
  /** Edits a private copy of the sandbox. */
  mutate: (sandbox: string, view: RunView) => void;
  /** Check ids that must FAIL on the mutated run. */
  fails: string[];
  /**
   * Check ids that must still PASS: the mutation moves the run to another branch the skill allows, so the checker has
   * to accept that branch, not only the branch the scripted scenario took.
   */
  passes?: string[];
}

/** Rewrites the original sandbox path inside every text file of the copy, so receipts and sessions point into the copy. */
function relocate(dir: string, from: string, to: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === '.git' || name === 'node_modules') continue;
    const stat = lstatSync(path);
    if (stat.isDirectory()) relocate(path, from, to);
    else if (stat.isFile() && stat.size < 5_000_000 && !name.endsWith('.txt')) {
      const bytes = readFileSync(path);
      if (bytes.includes(0)) continue;
      const text = bytes.toString('utf8');
      if (text.includes(from)) writeFileSync(path, text.replaceAll(from, to));
    }
  }
}

export function withCopy<T>(sandbox: string, mutate: Negative['mutate'], use: (view: RunView) => T): T {
  const copy = `${sandbox}-mutant-${Math.random().toString(36).slice(2, 8)}`;
  requireSandbox(sandbox, 'before a negative case copied it');
  cpSync(sandbox, copy, { recursive: true, verbatimSymlinks: true });
  relocate(copy, sandbox, copy);
  try {
    const original = loadView(sandbox);
    mutate(copy, original);
    return use(loadView(copy));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

const runDir = (sandbox: string, runId: string) => join(sandbox, 'repo', '.pi', 'pstack', 'runs', runId);
const edit = (path: string, change: (text: string) => string) => writeFileSync(path, change(readFileSync(path, 'utf8')));

/** Mutates the separate ledger to plant invalid status or evidence claims. */
export function setStep(sandbox: string, runId: string, n: number, status: TodoStatus, change: (entry: TodoLedgerEntry) => TodoLedgerEntry = (entry) => entry): void {
  edit(join(runDir(sandbox, runId), 'TODO.md'), (text) => {
    const ledger = readTodoLedger(text).map((entry) => (entry.n === n ? change({ ...entry, status }) : entry));
    return text.replace(/(## Status ledger\n\n```json\n)[\s\S]*?(\n```\n\n## Task-specific work\n)/, `$1${JSON.stringify(ledger, null, 2)}$2`);
  });
}

export const stripEvidence = (entry: TodoLedgerEntry): TodoLedgerEntry => ({ ...entry, evidence: [] });

export function deleteStep(sandbox: string, runId: string, n: number): void {
  edit(join(runDir(sandbox, runId), 'TODO.md'), (text) => {
    const block = upstreamSteps(immutableTodoBlock(Buffer.from(text))).steps.find((entry) => entry.n === n)?.text;
    return block === undefined ? text : text.replace(block, '');
  });
}

export function deleteReceipt(sandbox: string, runId: string, id: string): void {
  rmSync(join(runDir(sandbox, runId), 'verification', 'receipts', `${id}.json`), { force: true });
}

/** Changes an artifact's bytes after the receipt recorded its sha256. */
export function corruptArtifact(sandbox: string, runId: string, id: string): void {
  const recorded = JSON.parse(readFileSync(join(runDir(sandbox, runId), 'verification', 'receipts', `${id}.json`), 'utf8')) as { receipt: { artifacts: { path: string }[] } };
  appendFileSync(recorded.receipt.artifacts[0]?.path as string, '\ntampered\n');
}

export function patchReceipt(sandbox: string, runId: string, id: string, patch: Record<string, unknown>): void {
  const path = join(runDir(sandbox, runId), 'verification', 'receipts', `${id}.json`);
  const recorded = JSON.parse(readFileSync(path, 'utf8')) as { receipt: Record<string, unknown> };
  recorded.receipt = { ...recorded.receipt, ...patch };
  writeFileSync(path, JSON.stringify(recorded));
}

export function patchAssignment(sandbox: string, runId: string, workerId: string, patch: (assignment: Record<string, unknown>) => void): void {
  const path = join(runDir(sandbox, runId), 'workers', workerId, 'assignment.json');
  const assignment = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  patch(assignment);
  writeFileSync(path, JSON.stringify(assignment, null, 2));
}

export function removeWorker(sandbox: string, runId: string, workerId: string): void {
  rmSync(join(runDir(sandbox, runId), 'workers', workerId), { recursive: true, force: true });
}

/** A copy of a worker under another id, as if the run had spawned one more worker like it. */
export function cloneWorker(sandbox: string, runId: string, from: string, to: string, patch: Record<string, unknown>): void {
  const workers = join(runDir(sandbox, runId), 'workers');
  cpSync(join(workers, from), join(workers, to), { recursive: true });
  patchAssignment(sandbox, runId, to, (assignment) => Object.assign(assignment, { workerId: to }, patch));
}

export function appendToBrief(sandbox: string, runId: string, workerId: string, text: string): void {
  appendFileSync(join(runDir(sandbox, runId), 'workers', workerId, 'brief.md'), text);
}

export function workerSessionFile(sandbox: string, runId: string, workerId: string): string {
  const dir = join(runDir(sandbox, runId), 'workers', workerId, 'session');
  return join(dir, readdirSync(dir).find((file) => file.endsWith('.jsonl')) as string);
}

/** Appends an assistant tool call and its successful result, as if the worker had run that tool. */
export function appendToolCall(sessionFile: string, tool: string, args: Record<string, unknown>): void {
  const id = `forged-${Math.random().toString(36).slice(2, 8)}`;
  const stamp = new Date().toISOString();
  const lines = [
    { type: 'message', id: `${id}a`, parentId: null, timestamp: stamp, message: { role: 'assistant', content: [{ type: 'toolCall', id, name: tool, arguments: args }], provider: 'sim', model: 'forged', stopReason: 'toolUse', timestamp: Date.now() } },
    { type: 'message', id: `${id}b`, parentId: `${id}a`, timestamp: stamp, message: { role: 'toolResult', toolCallId: id, toolName: tool, content: [{ type: 'text', text: 'ok' }], isError: false, timestamp: Date.now() } },
  ];
  appendFileSync(sessionFile, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

/** Rewrites every occurrence of `from` in a session file, to move a read or a citation away from what the contract needs. */
export function rewriteSession(sessionFile: string, from: string | RegExp, to: string): void {
  edit(sessionFile, (text) => text.replaceAll(from as string, to));
}

export function parentSession(sandbox: string): string {
  const meta = JSON.parse(readFileSync(join(sandbox, 'meta.json'), 'utf8')) as { parentSessionFile: string | null };
  if (meta.parentSessionFile !== null && existsSync(meta.parentSessionFile)) return meta.parentSessionFile;
  const dir = join(sandbox, 'sessions');
  return join(dir, readdirSync(dir).find((file) => file.endsWith('.jsonl')) as string);
}

/** Removes the pstack-worker wake messages from the parent session. */
export function dropWakes(sandbox: string): void {
  edit(parentSession(sandbox), (text) =>
    text
      .split('\n')
      .filter((line) => !line.includes('"customType":"pstack-worker"'))
      .join('\n'),
  );
}

export function setSessionCwd(sessionFile: string, cwd: string): void {
  edit(sessionFile, (text) => text.replace(/"cwd":"[^"]*"/, `"cwd":${JSON.stringify(cwd)}`));
}

/** Changes a tracked file in the main checkout, then re-reads git state the way the driver did. */
export function dirtyRepo(sandbox: string, file: string, extra = '\n// stray edit\n'): void {
  appendFileSync(join(sandbox, 'repo', file), extra);
  refreshGit(sandbox);
}

export function addUntracked(sandbox: string, file: string): void {
  mkdirSync(join(sandbox, 'repo', file, '..'), { recursive: true });
  writeFileSync(join(sandbox, 'repo', file), 'x\n');
  refreshGit(sandbox);
}

export function refreshGit(sandbox: string): void {
  const meta = JSON.parse(readFileSync(join(sandbox, 'meta.json'), 'utf8')) as { base: string };
  writeFileSync(join(sandbox, 'git.json'), JSON.stringify(loadGit(join(sandbox, 'repo'), meta.base)));
}

export function patchGit(sandbox: string, patch: (git: Record<string, unknown>) => void): void {
  const path = join(sandbox, 'git.json');
  const git = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  patch(git);
  writeFileSync(path, JSON.stringify(git));
}

export function overwrite(path: string, change: (text: string) => string): void {
  edit(path, change);
}

export const exists = existsSync;

/** Rewrites the driver's TODO.md timeline so step n is resolved before the steps ahead of it. */
export function reorderHistory(sandbox: string, runId: string, n: number): void {
  const path = join(sandbox, 'todo-history.json');
  const history = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { t: number; seq: number; text: string }[]>;
  const final = history[runId]?.at(-1)?.text ?? '';
  const ledger = readTodoLedger(final);
  const pending = ledger.map((entry): TodoLedgerEntry => ({ ...entry, status: 'pending', skip: null, evidence: [] }));
  const open = replaceTodoLedger(final, pending);
  const partial = replaceTodoLedger(
    final,
    pending.map((entry) => (entry.n === n ? (ledger.find((original) => original.n === n) as TodoLedgerEntry) : entry)),
  );
  history[runId] = [
    { t: 1, seq: 1, text: open },
    { t: 2, seq: 2, text: partial },
    { t: 3, seq: 3, text: final },
  ];
  writeFileSync(path, JSON.stringify(history));
}

/** Rewrites text only inside the parent's last substantive assistant message, the reply the user reads. */
export function rewriteFinalReply(sandbox: string, from: string | RegExp, to: string | ((match: string, ...groups: string[]) => string)): void {
  const file = parentSession(sandbox);
  const lines = readFileSync(file, 'utf8').split('\n');
  const isReply = (entry: { type?: string; message?: { role?: string; content?: { type: string; text?: string }[] } }) => entry.type === 'message' && entry.message?.role === 'assistant' && (entry.message.content ?? []).some((part) => part.type === 'text' && (part.text ?? '').trim() !== '' && part.text !== '(script complete)' && !(part.text ?? '').startsWith('waiting for worker '));
  let index = -1;
  lines.forEach((line, position) => {
    if (line !== '' && isReply(JSON.parse(line))) index = position;
  });
  if (index === -1) throw new Error('no reply to rewrite');
  const entry = JSON.parse(lines[index] as string) as { message: { content: { type: string; text?: string }[] } };
  for (const part of entry.message.content) if (part.type === 'text' && part.text !== undefined) part.text = typeof from === 'string' ? part.text.replaceAll(from, to as string) : part.text.replace(from, to as (match: string, ...groups: string[]) => string);
  lines[index] = JSON.stringify(entry);
  writeFileSync(file, lines.join('\n'));
}

/** Collapses a worker branch into one commit on the base, so the test no longer lands before the fix. */
export function squashBranch(sandbox: string, branch: string): void {
  const repo = join(sandbox, 'repo');
  const meta = JSON.parse(readFileSync(join(sandbox, 'meta.json'), 'utf8')) as { base: string };
  const run = (command: string) => spawnSync('sh', ['-c', command], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const tree = run(`git rev-parse ${JSON.stringify(`${branch}^{tree}`)}`);
  const squashed = run(`git -c user.name=m -c user.email=m@x commit-tree ${tree} -p ${meta.base} -m squashed`);
  run(`git update-ref ${JSON.stringify(`refs/heads/${branch}`)} ${squashed}`);
  refreshGit(sandbox);
}

/** Collapses a worker branch into one commit on the base that leaves out `file`: one focused commit, with no pin of the delegate's own. */
export function squashBranchWithout(sandbox: string, branch: string, file: string): void {
  const repo = join(sandbox, 'repo');
  const meta = JSON.parse(readFileSync(join(sandbox, 'meta.json'), 'utf8')) as { base: string };
  const index = join(sandbox, 'squash.index');
  const run = (command: string) => spawnSync('sh', ['-c', command], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: index } }).stdout.trim();
  run(`git read-tree ${JSON.stringify(branch)} && git update-index --force-remove ${JSON.stringify(file)}`);
  const tree = run('git write-tree');
  const squashed = run(`git -c user.name=m -c user.email=m@x commit-tree ${tree} -p ${meta.base} -m squashed`);
  rmSync(index, { force: true });
  run(`git update-ref ${JSON.stringify(`refs/heads/${branch}`)} ${squashed}`);
  refreshGit(sandbox);
}

/** Collapses the main checkout's commits since the base into one. */
export function squashMain(sandbox: string): void {
  const repo = join(sandbox, 'repo');
  const meta = JSON.parse(readFileSync(join(sandbox, 'meta.json'), 'utf8')) as { base: string };
  spawnSync('sh', ['-c', `git reset --soft ${meta.base} && git -c user.name=m -c user.email=m@x commit -q -m squashed`], { cwd: repo });
  refreshGit(sandbox);
}

/** A worker whose spawn was refused: its assignment and brief are on disk, and it never started, so it has no state, claim, session, or worktree. */
export function unspawnWorker(sandbox: string, runId: string, workerId: string): void {
  const dir = join(runDir(sandbox, runId), 'workers', workerId);
  for (const name of readdirSync(dir)) if (name !== 'assignment.json' && name !== 'brief.md') rmSync(join(dir, name), { recursive: true, force: true });
}

/** Points one of the run's model-rule lines at another model, as the operator's models.json would. */
export function setRoleLine(sandbox: string, line: string, value: string | string[]): void {
  const path = join(sandbox, 'home', '.pi', 'agent', 'pstack', 'models.json');
  const config = JSON.parse(readFileSync(path, 'utf8')) as { roles: Record<string, string | string[]> };
  config.roles[line] = value;
  writeFileSync(path, JSON.stringify(config, null, 2));
}
