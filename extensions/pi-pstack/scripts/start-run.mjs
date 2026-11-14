import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { createTodo, replaceTodoLedger, validateTodoSource } from '../src/todo.ts';

const UPSTREAM_REVISION = '3dbd22ff12742fb28c9700b9760baa29ed41dc13';
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLAYBOOKS = join(PACKAGE_ROOT, 'vendor/upstream-pstack/skills/poteto-mode/playbooks');

function git(cwd, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function atomic(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function coordinator(runDir, owner) {
  if ((process.env.PSTACK_WORKER === '1' && dirname(resolve(process.env.PSTACK_RUN_ROOT ?? '')) === dirname(runDir)) ||
    (owner !== null && owner !== (process.env.PI_SESSION_FILE ?? null))) throw new Error('Only the run coordinator may update its TODO.md');
}

function withTodoLock(project, action) {
  const state = join(project, '.pi/pstack');
  mkdirSync(state, { recursive: true });
  const lock = join(state, 'todo.lock');
  mkdirSync(lock);
  try {
    return action(join(state, 'active-run'));
  } finally {
    rmSync(lock, { recursive: true });
  }
}

export function startRun({ playbook, title, runId = randomUUID(), cwd = process.cwd(), parentSessionFile = process.env.PI_SESSION_FILE ?? null }) {
  if (!IDENTIFIER.test(runId)) throw new Error('Invalid run id');
  if (!IDENTIFIER.test(playbook)) throw new Error('Invalid playbook id');
  if (typeof title !== 'string' || !title.trim() || /[\r\n]/.test(title)) throw new Error('Title must be a nonempty single line');
  const source = readFileSync(join(PLAYBOOKS, `${playbook}.md`));
  const project = git(cwd, 'rev-parse', '--show-toplevel') ?? resolve(cwd);
  const runDir = join(project, '.pi/pstack/runs', runId);
  coordinator(runDir, null);
  return withTodoLock(project, (active) => {
    if (existsSync(runDir)) throw new Error(`EEXIST: run ${runId} already exists`);
    if (existsSync(active)) throw new Error(`Archive active run ${readFileSync(active, 'utf8').trim()} before starting another`);
    const manifest = {
      schemaVersion: 1, runId, title, playbook, upstreamRevision: UPSTREAM_REVISION,
      createdAt: new Date().toISOString(), parentSessionFile, inputCommit: git(cwd, 'rev-parse', 'HEAD'),
    };
    mkdirSync(runDir, { recursive: true });
    atomic(join(runDir, 'run.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    atomic(join(runDir, 'TODO.md'), createTodo(title, playbook, UPSTREAM_REVISION, source));
    atomic(active, `${runId}\n`);
    return runDir;
  });
}

export function updateRun({ runId, step, status, evidence, skip, requiredProof, task, taskStatus, archive, cwd = process.cwd() }) {
  if (!IDENTIFIER.test(runId)) throw new Error('Invalid run id');
  const project = git(cwd, 'rev-parse', '--show-toplevel') ?? resolve(cwd);
  const runDir = join(project, '.pi/pstack/runs', runId);
  return withTodoLock(project, (active) => {
    const run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
    coordinator(runDir, run.parentSessionFile);
    if (!existsSync(active) || readFileSync(active, 'utf8') !== `${runId}\n`) throw new Error(`Run ${runId} is not the active coordinator TODO`);
    if (!IDENTIFIER.test(run.playbook) || run.upstreamRevision !== UPSTREAM_REVISION) throw new Error('Run does not name the pinned upstream playbook');
    const path = join(runDir, 'TODO.md');
    const bytes = readFileSync(path);
    const ledger = validateTodoSource(bytes, readFileSync(join(PLAYBOOKS, `${run.playbook}.md`)), run.playbook, UPSTREAM_REVISION);
    if (archive) {
      atomic(join(runDir, 'TODO.archived.md'), bytes);
      rmSync(active);
    } else if (task !== undefined) {
      if (!task.trim() || /[\r\n]/.test(task)) throw new Error('Task must be a nonempty single line');
      let text = bytes.toString('utf8');
      if (taskStatus === undefined) text += `- [ ] ${task}\n`;
      else {
        if (taskStatus !== 'passed') throw new Error('Task status must be passed');
        const marker = '## Task-specific work\n';
        const start = text.indexOf(marker) + marker.length;
        const body = text.slice(start);
        if (!body.includes(`- [ ] ${task}\n`)) throw new Error('Unknown pending task');
        text = text.slice(0, start) + body.replace(`- [ ] ${task}\n`, `- [x] ${task}\n`);
      }
      atomic(path, text);
    } else {
      const entry = ledger.find((item) => item.n === Number(step));
      if (entry === undefined) throw new Error(`Unknown source step ${step}`);
      entry.status = status;
      if (requiredProof !== undefined) entry.requiredProof = requiredProof;
      entry.evidence = evidence === undefined ? [] : evidence.split(',').filter(Boolean);
      if (status === 'passed' && entry.evidence.length === 0) throw new Error('A passed step requires evidence receipt IDs');
      entry.skip = skip === undefined ? null : `skip: ${skip}`;
      atomic(path, replaceTodoLedger(bytes.toString('utf8'), ledger));
    }
    return runDir;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      playbook: { type: 'string' }, title: { type: 'string' }, 'run-id': { type: 'string' }, 'parent-session-file': { type: 'string' },
      step: { type: 'string' }, status: { type: 'string' }, evidence: { type: 'string' }, skip: { type: 'string' }, 'required-proof': { type: 'string' }, task: { type: 'string' }, 'task-status': { type: 'string' }, archive: { type: 'boolean' },
    } });
    console.log(values.playbook !== undefined
      ? startRun({ playbook: values.playbook, title: values.title, runId: values['run-id'], parentSessionFile: values['parent-session-file'] })
      : updateRun({ runId: values['run-id'], step: values.step, status: values.status, evidence: values.evidence, skip: values.skip, requiredProof: values['required-proof'], task: values.task, taskStatus: values['task-status'], archive: values.archive }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
