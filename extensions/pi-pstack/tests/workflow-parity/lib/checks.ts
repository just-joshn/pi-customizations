// Reusable contract checks. Each one reads only run artifacts and enforces a rule an upstream playbook or skill states.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { type Check, check, fail, type Outcome, pass, type Src, src, when } from './check.ts';
import { PKG } from './driver.ts';
import { type Receipt, type RunDir, type RunView, type Session, STEP_LINE, type ToolCall, type WorkerView } from './view.ts';

export const GEN = join(PKG, 'generated', 'skills');
export const PINNED_REVISION = (JSON.parse(readFileSync(join(PKG, 'generated', 'upstream-lock.json'), 'utf8')) as { revision: string }).revision;
export const READONLY_TOOLS = ['read', 'grep', 'find', 'ls', 'bash_readonly', 'pstack_evidence'];
export const FAMILY_OF = (model: string): string => model.slice(model.indexOf('/') + 1).split(/[-.]/)[0] as string;

// ---- plumbing

const READERS = /\b(cat|head|tail|sed|less|bat|nl)\b/;

/** Order of the first tool call that opens the file, or -1. A read of the path or a shell reader naming it counts. */
export function openedAt(session: Session | null, suffix: string): number {
  if (session === null) return -1;
  const call = session.toolCalls.find((entry) => (entry.name === 'read' && String(entry.args['path'] ?? '').endsWith(suffix)) || (entry.name === 'bash' && READERS.test(String(entry.args['command'] ?? '')) && String(entry.args['command'] ?? '').includes(suffix)));
  return call?.order ?? -1;
}

export const skillFile = (name: string) => `generated/skills/${name}/SKILL.md`;
export const playbookFile = (name: string) => `generated/skills/poteto-mode/playbooks/${name}.md`;

export function playbookSource(name: string): string[] {
  const text = readFileSync(join(GEN, 'poteto-mode', 'playbooks', `${name}.md`), 'utf8');
  const prose = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
  return [...prose.matchAll(/^\d+\. .*$(?:\n(?:[ \t].*|$))*/gm)].map((match) => match[0].trimEnd());
}

const MARKER = /\s*\((?:evidence|skip): [^)]*\)/g;
const normalize = (text: string) => text.replace(MARKER, '').replace(/[ \t]+$/gm, '').trimEnd();

export function primaryRun(view: RunView, playbook?: string): RunDir | undefined {
  return (playbook === undefined ? undefined : view.runs.find((run) => run.runJson?.['playbook'] === playbook)) ?? view.runs[0];
}

export const finalReply = (view: RunView): string =>
  [...view.parent.messages].reverse().find((message) => message.role === 'assistant' && message.text.trim() !== '' && message.text !== '(script complete)' && !message.text.startsWith('waiting for worker '))?.text ?? '';


export function allWorkers(view: RunView): WorkerView[] {
  return view.runs.flatMap((run) => run.workers);
}

export const assignmentOf = (worker: WorkerView) => worker.assignment as { role?: string; model?: string; kind?: string; workspace?: { mode?: string; path?: string; inputCommit?: string }; skills?: string[]; capabilities?: { mcp?: string }; watch?: { argv?: string[]; cwd?: string }; thinkingLevel?: string | null };

// ---- verification of receipts, independent of pstack_evidence

export function verifyReceipt(run: RunDir, receipt: Receipt): string | null {
  if (receipt.verdict !== 'pass') return `receipt ${receipt.id} verdict is ${receipt.verdict}`;
  if (receipt.artifacts.length === 0) return `receipt ${receipt.id} has no artifacts`;
  for (const artifact of receipt.artifacts) {
    const path = isAbsolute(artifact.path) ? artifact.path : resolve(run.dir, artifact.path);
    if (!existsSync(path)) return `receipt ${receipt.id} artifact ${artifact.path} is missing`;
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (digest !== artifact.sha256) return `receipt ${receipt.id} artifact ${artifact.path} sha256 ${digest.slice(0, 12)} is not ${artifact.sha256.slice(0, 12)}`;
  }
  return null;
}

// ---- TODO.md contract (spec 11.1; poteto-mode "Playbooks")

const TODO_SRC = src('poteto-mode/SKILL.md', 'Start the run with `node <pi-pstack>/scripts/start-run.mjs');
const SKIP_SRC = src('poteto-mode/SKILL.md', 'A step you choose not to do stays in the list as');

export interface TodoOptions {
  playbook: string;
  /** Steps that may never be skipped (the playbook says so). */
  mandatory?: number[];
  /** Steps that may be skipped only with a reason, and whose reason must mention this pattern. */
  skipReason?: Record<number, RegExp>;
}

export function todoChecks(options: TodoOptions): Check[] {
  const { playbook } = options;
  const book = src(`poteto-mode/playbooks/${playbook}.md`, playbookSource(playbook)[0]?.split('\n')[0]?.slice(0, 30) ?? '###');
  const run = (view: RunView) => primaryRun(view, playbook);
  return [
    check(`todo.${playbook}.run-from-playbook`, `a run for the ${playbook} playbook exists with run.json and TODO.md pinned to the upstream revision`, TODO_SRC, (view) => {
      const found = run(view);
      if (found === undefined || found.runJson === null || found.todoText === null) return fail(`no run directory with run.json and TODO.md under .pi/pstack/runs (found ${view.runs.map((entry) => entry.id).join(', ') || 'none'})`);
      const json = found.runJson;
      const okJson = json['schemaVersion'] === 1 && json['playbook'] === playbook && json['upstreamRevision'] === PINNED_REVISION && typeof json['title'] === 'string';
      return when(okJson && found.todoText.includes(`Source playbook: ${playbook}.md`) && found.todoText.includes(`Upstream revision: ${PINNED_REVISION}`), `run ${found.id}: playbook=${String(json['playbook'])} revision=${String(json['upstreamRevision']).slice(0, 12)}`, `run.json ${JSON.stringify(json)} or the TODO.md header does not name ${playbook}.md at ${PINNED_REVISION.slice(0, 12)}`);
    }),
    check(`todo.${playbook}.steps-verbatim-in-order`, 'the original playbook steps appear in TODO.md in source order, numbered from 1, with their complete text', [TODO_SRC, book], (view) => {
      const found = run(view);
      if (found?.todoText == null) return fail('no TODO.md');
      const expected = playbookSource(playbook);
      if (expected.length === 0) return found.todoText.includes('has no numbered steps') ? pass(`${playbook}.md has no numbered steps and TODO.md says so`) : fail('playbook has no numbered steps but TODO.md does not say so');
      const wrong = expected.flatMap((step, index) => {
        const actual = found.steps[index];
        if (actual === undefined) return [`step ${index + 1} is missing`];
        const want = normalize(step.replace(/^\d+\. /, ''));
        return actual.n === index + 1 && normalize(actual.text) === want ? [] : [`step ${index + 1} differs (${normalize(actual.text).slice(0, 50)} vs ${want.slice(0, 50)})`];
      });
      if (found.steps.length > expected.length) wrong.push(`${found.steps.length - expected.length} extra step(s) under Original playbook steps`);
      return when(wrong.length === 0, `${expected.length} steps match the playbook text in order`, wrong.join('; '));
    }),
    check(`todo.${playbook}.initial-states-open`, 'the first TODO.md the run wrote has every original step open', TODO_SRC, (view) => {
      const first = view.todoHistory[run(view)?.id ?? '']?.[0];
      if (first === undefined) return fail('the driver never saw a TODO.md');
      const states = first.text.split('\n').filter((line) => STEP_LINE.test(line)).map((line) => STEP_LINE.exec(line)?.[1]);
      return when(states.length > 0 && states.every((state) => state === ' '), `${states.length} steps open in the first snapshot`, `first snapshot has states ${JSON.stringify(states)}`);
    }),
    check(`todo.${playbook}.every-step-resolved`, 'every original step ends done with evidence or skipped with a reason, none open', [TODO_SRC, SKIP_SRC], (view) => {
      const found = run(view);
      if (found === undefined) return fail('no run');
      const open = found.steps.filter((step) => step.state === 'open').map((step) => step.n);
      return when(found.steps.length > 0 && open.length === 0, `${found.steps.length} steps, all resolved`, `open steps: ${open.join(', ') || '(no steps parsed)'}`);
    }),
    check(`todo.${playbook}.done-steps-proven`, 'each done step cites receipts that are recorded and re-verify (files exist, sha256 match, verdict pass)', TODO_SRC, (view) => {
      const found = run(view);
      if (found === undefined) return fail('no run');
      const problems = found.steps
        .filter((step) => step.state === 'done')
        .flatMap((step) => {
          if (step.evidence.length === 0) return [`step ${step.n} is done with no (evidence: <receipt id>)`];
          return step.evidence.flatMap((id) => {
            const receipt = found.receipts.find((entry) => entry.id === id);
            if (receipt === undefined) return [`step ${step.n} cites ${id}, which is not recorded under verification/receipts`];
            const problem = verifyReceipt(found, receipt);
            return problem === null ? [] : [`step ${step.n}: ${problem}`];
          });
        });
      const done = found.steps.filter((step) => step.state === 'done').length;
      return when(problems.length === 0 && done > 0, `${done} done steps, every cited receipt re-verifies`, problems.join('; ') || 'no step is done');
    }),
    check(`todo.${playbook}.skips-explained`, 'a skipped step names its reason, and no mandatory step is skipped', [SKIP_SRC, book], (view) => {
      const found = run(view);
      if (found === undefined) return fail('no run');
      const problems = found.steps
        .filter((step) => step.state === 'skipped')
        .flatMap((step) => {
          if (step.skip === null || step.skip.trim() === '') return [`step ${step.n} skipped with no reason`];
          if (options.mandatory?.includes(step.n)) return [`step ${step.n} is mandatory and was skipped`];
          const pattern = options.skipReason?.[step.n];
          return pattern === undefined || pattern.test(step.skip) ? [] : [`step ${step.n} skip reason "${step.skip}" does not match ${pattern}`];
        });
      return when(problems.length === 0, `skips: ${found.steps.filter((step) => step.state === 'skipped').map((step) => step.n).join(', ') || 'none'}`, problems.join('; '));
    }),
    check(`todo.${playbook}.resolved-in-order`, 'step N is not resolved before step N-1 is resolved', TODO_SRC, (view) => {
      const found = run(view);
      const snapshots = view.todoHistory[found?.id ?? ''] ?? [];
      if (snapshots.length === 0) return fail('the driver never saw a TODO.md');
      const resolvedAt = new Map<number, number>();
      snapshots.forEach((snapshot, index) => {
        for (const line of snapshot.text.split('\n')) {
          const match = STEP_LINE.exec(line);
          if (match !== null && match[1] !== ' ' && !resolvedAt.has(Number(match[2]))) resolvedAt.set(Number(match[2]), index);
        }
      });
      const numbers = [...resolvedAt.keys()].sort((a, b) => a - b);
      const early = numbers.filter((n, position) => position > 0 && (resolvedAt.get(n) as number) < (resolvedAt.get(numbers[position - 1] as number) as number));
      return when(early.length === 0, `resolution order over ${snapshots.length} snapshots follows the source order`, `steps resolved before their predecessor: ${early.join(', ')}`);
    }),
    check(`todo.${playbook}.parent-sole-writer`, 'no worker writes the run TODO.md', src('poteto-mode/SKILL.md', 'You are its only writer'), (view) => {
      const found = run(view);
      const writers = allWorkers(view).filter((worker) =>
        (worker.session?.toolCalls ?? []).some((call) => {
          const args = JSON.stringify(call.args);
          if (!args.includes(`${found?.id ?? '?'}/TODO.md`)) return false;
          return call.name === 'write' || call.name === 'edit' || (call.name === 'bash' && /(>|sed -i|tee |mv |cp )/.test(String(call.args['command'])));
        }),
      );
      return when(writers.length === 0, `${allWorkers(view).length} workers, none touched TODO.md`, `workers that wrote TODO.md: ${writers.map((worker) => worker.id).join(', ')}`);
    }),
  ];
}

// ---- skills and principle leaves

/** Names of skill directories under generated/skills a playbook step names in bold or backticks. */
export function skillsNamedBy(playbook: string): { name: string; steps: number[] }[] {
  const dirs = new Set(readdirSync(GEN));
  const steps = playbookSource(playbook);
  const found = new Map<string, number[]>();
  steps.forEach((step, index) => {
    for (const match of step.matchAll(/(?:\*\*|`)(principle-[a-z-]+|[a-z][a-z-]+?)(?:\*\*|`)(?: principle skill| skill)?/g)) {
      const raw = match[1] as string;
      const name = dirs.has(raw) ? raw : dirs.has(`principle-${raw}`) ? `principle-${raw}` : undefined;
      if (name !== undefined && name !== 'poteto-mode') found.set(name, [...new Set([...(found.get(name) ?? []), index + 1])]);
    }
  });
  return [...found.entries()].map(([name, list]) => ({ name, steps: list }));
}

export function parentReads(id: string, title: string, source: Src | Src[], names: string[], options: { beforeFirstSpawn?: boolean } = {}): Check {
  return check(id, title, source, (view) => {
    const missing = names.filter((name) => openedAt(view.parent, skillFile(name)) === -1);
    if (missing.length > 0) return fail(`parent never opened ${missing.map(skillFile).join(', ')}`);
    if (options.beforeFirstSpawn === true) {
      const spawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn')?.order ?? Number.POSITIVE_INFINITY;
      const late = names.filter((name) => openedAt(view.parent, skillFile(name)) > spawn);
      if (late.length > 0) return fail(`${late.join(', ')} opened only after the first worker spawn`);
    }
    return pass(`parent opened ${names.join(', ')}`);
  });
}

export function playbookReads(playbook: string, optional: string[] = [], conditionalLeaves: string[] = []): Check[] {
  const book = src(`poteto-mode/playbooks/${playbook}.md`, playbookSource(playbook)[0]?.split('\n')[0]?.slice(0, 30) ?? '###');
  const named = skillsNamedBy(playbook).filter((entry) => !optional.includes(entry.name) && !conditionalLeaves.includes(entry.name));
  const leaves = named.filter((entry) => entry.name.startsWith('principle-')).map((entry) => entry.name);
  const skills = named.filter((entry) => !entry.name.startsWith('principle-')).map((entry) => entry.name);
  return [
    check(`reads.${playbook}.poteto-mode-and-playbook`, `the parent opens poteto-mode SKILL.md and playbooks/${playbook}.md`, TODO_SRC, (view) => {
      const missing = [skillFile('poteto-mode'), playbookFile(playbook)].filter((suffix) => openedAt(view.parent, suffix) === -1);
      return when(missing.length === 0, 'poteto-mode and the playbook were opened', `not opened: ${missing.join(', ')}`);
    }),
    ...(skills.length === 0 ? [] : [parentReads(`reads.${playbook}.named-skills`, `the parent opens each skill the playbook steps name (${skills.join(', ')})`, book, skills)]),
    ...(leaves.length === 0 ? [] : [parentReads(`reads.${playbook}.principle-leaves`, `the parent opens each principle leaf the playbook steps apply (${leaves.join(', ')})`, src('poteto-mode/SKILL.md', 'Read the leaf skill in full for any principle you apply'), leaves)]),
  ];
}

export const promptRoutes = (skill: string): Check =>
  check(`slash.${skill}`, `/${skill} reaches Pi as the pstack ${skill} skill prompt with the request`, src(`${skill}/SKILL.md`, '# '), (view) => when(view.prompt.includes(`Use the pstack \`${skill}\` skill for this request.`) && view.prompt.includes(skillFile(skill)) && /Request: \S/.test(view.prompt), `first user message routes to ${skillFile(skill)}`, `first user message was: ${view.prompt.slice(0, 160)}`));

// ---- workers

export interface WorkerSpec {
  /** A worker matches when its role is one of these. */
  role: string | string[];
  min: number;
  max?: number;
  mode: 'readonly' | 'worktree' | 'container-or-worktree';
  /** Role line of models.json the model must follow. */
  modelLine?: string;
  /** Readonly workers read the repository root. */
  rootPath?: boolean;
  mcpInherit?: boolean;
  /** Restrict the match to workers whose id satisfies this. */
  id?: RegExp;
}

export function expectedModels(view: RunView, line: string): string[] {
  const value = view.models?.[line];
  const parent = view.parent.models[0] ?? '';
  const stripLevel = (spec: string) => spec.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, '');
  if (value === undefined) return [];
  const list = (Array.isArray(value) ? value : [value]).map(stripLevel);
  return list.flatMap((entry) => (entry === 'auto' || entry === 'inherit-parent' ? ['inherit-parent', parent] : entry === parent ? [entry, 'inherit-parent'] : [entry]));
}

export const matching = (view: RunView, spec: WorkerSpec): WorkerView[] => {
  const roles = Array.isArray(spec.role) ? spec.role : [spec.role];
  return allWorkers(view).filter((worker) => roles.includes(String(assignmentOf(worker).role)) && (spec.id === undefined || spec.id.test(worker.id)));
};

export function workersCheck(id: string, title: string, source: Src | Src[], spec: WorkerSpec): Check {
  return check(id, title, source, (view) => {
    const found = matching(view, spec);
    if (found.length < spec.min || (spec.max !== undefined && found.length > spec.max)) return fail(`${found.length} ${[spec.role].flat().join('/')} worker(s), want ${spec.min}${spec.max === undefined ? '+' : `..${spec.max}`}; workers: ${allWorkers(view).map((worker) => `${worker.id}(${String(assignmentOf(worker).role)})`).join(', ') || 'none'}`);
    const problems: string[] = [];
    for (const worker of found) {
      const assignment = assignmentOf(worker);
      const mode = assignment.workspace?.mode;
      const modeOk = spec.mode === 'container-or-worktree' ? mode === 'worktree' || mode === 'container' : mode === spec.mode;
      if (!modeOk) problems.push(`${worker.id} workspace.mode ${String(mode)} is not ${spec.mode}`);
      if (spec.rootPath === true && assignment.workspace?.path !== view.repo) problems.push(`${worker.id} readonly path ${String(assignment.workspace?.path)} is not the repository root ${view.repo}`);
      if (spec.mcpInherit === true && assignment.capabilities?.mcp === 'none') problems.push(`${worker.id} sets capabilities.mcp none`);
      if (spec.modelLine !== undefined) {
        const allowed = expectedModels(view, spec.modelLine);
        if (allowed.length > 0 && !allowed.includes(String(assignment.model))) problems.push(`${worker.id} model ${String(assignment.model)} is not the "${spec.modelLine}" line (${allowed.join(' | ')})`);
      }
    }
    return when(problems.length === 0, `${found.map((worker) => `${worker.id}:${String(assignmentOf(worker).role)}:${String(assignmentOf(worker).workspace?.mode)}:${String(assignmentOf(worker).model)}`).join(', ')}`, problems.join('; '));
  });
}

const WRITE_TOOLS = new Set(['write', 'edit', 'bash']);

export function readonlyEnforced(id: string, source: Src | Src[], roles: string[]): Check {
  return check(id, `readonly workers (${roles.join(', ')}) ran only read-class tools and every write-class call was refused`, source, (view) => {
    const workers = allWorkers(view).filter((worker) => assignmentOf(worker).workspace?.mode === 'readonly' && roles.includes(String(assignmentOf(worker).role)));
    if (workers.length === 0) return fail('no readonly worker of those roles');
    const bad = workers.flatMap((worker) =>
      (worker.session?.toolCalls ?? [])
        .filter((call) => !READONLY_TOOLS.includes(call.name) && !(WRITE_TOOLS.has(call.name) && call.isError))
        .map((call) => `${worker.id} ran ${call.name}`),
    );
    const sessionless = workers.filter((worker) => worker.session === null).map((worker) => worker.id);
    return when(bad.length === 0 && sessionless.length === 0, `${workers.length} readonly workers, tool calls ${[...new Set(workers.flatMap((worker) => (worker.session?.toolCalls ?? []).map((call) => call.name)))].join(', ')}`, [...bad, ...sessionless.map((worker) => `${worker} left no session file`)].join('; '));
  });
}

export function repoUntouched(id: string, title: string, source: Src | Src[]): Check {
  return check(id, title, source, (view) => {
    const dirty = view.git.dirty;
    const moved = view.git.commitsSinceBase;
    const parentWrites = view.parent.toolCalls.filter((call) => (call.name === 'write' || call.name === 'edit') && !call.isError && !/\/\.pi\/pstack\/|^\/tmp\/|\/tmp\//.test(String(call.args['path'] ?? '')) && !String(call.args['path'] ?? '').startsWith('.pi/pstack/'));
    return when(dirty.length === 0 && moved.length === 0 && parentWrites.length === 0, `working tree clean outside .pi/, HEAD at base, ${view.parent.toolCalls.filter((call) => call.name === 'write' || call.name === 'edit').length} parent write calls all under .pi/pstack or /tmp`, `dirty: ${dirty.join(', ') || 'none'}; commits since base: ${moved.length}; parent writes: ${parentWrites.map((call) => String(call.args['path'])).join(', ') || 'none'}`);
  });
}

export function settledAndCollected(id: string, source: Src | Src[], roles?: string[]): Check {
  return check(id, 'every worker settled, the parent was woken by a pstack-worker message, and collected it after that wake', source, (view) => {
    const workers = allWorkers(view).filter((worker) => assignmentOf(worker).kind !== 'watch' && (roles === undefined || roles.includes(String(assignmentOf(worker).role))));
    if (workers.length === 0) return fail('no worker');
    const problems = workers.flatMap((worker) => {
      const settles = (worker.state?.['settles'] as { phase: string }[] | undefined) ?? [];
      if (settles.length === 0 || !settles.some((settle) => settle.phase === 'idle')) return [`${worker.id} never recorded an idle settle (${JSON.stringify(settles.map((settle) => settle.phase))})`];
      const wake = view.parent.messages.find((message) => message.customType === 'pstack-worker' && message.details?.['workerId'] === worker.id);
      const collect = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === worker.id && !call.isError && /"settled":\s*true|settled/.test(call.resultText));
      if (wake === undefined) return [`${worker.id}: no pstack-worker wake in the parent session`];
      if (collect === undefined) return [`${worker.id}: parent never collected a settled result`];
      return collect.order > wake.order ? [] : [`${worker.id}: collected before its wake`];
    });
    return when(problems.length === 0, `${workers.length} workers woke and were collected: ${workers.map((worker) => worker.id).join(', ')}`, problems.join('; '));
  });
}

export function worktreeIsolation(id: string, source: Src | Src[]): Check {
  return check(id, 'writable workers have distinct worktrees and branches at their inputCommit, and each worker session ran inside its own worktree', source, (view) => {
    const writable = allWorkers(view).filter((worker) => assignmentOf(worker).workspace?.mode === 'worktree');
    if (writable.length === 0) return fail('no worktree worker');
    const paths = new Set<string>();
    const problems: string[] = [];
    for (const worker of writable) {
      const own = join(worker.dir, 'worktree');
      const run = view.runs.find((entry) => entry.workers.includes(worker));
      if (paths.has(own)) problems.push(`${worker.id} shares ${own}`);
      paths.add(own);
      const registered = view.git.worktrees.find((tree) => tree.path === own);
      if (registered === undefined) problems.push(`${worker.id}: git has no worktree at ${own}`);
      else if (registered.branch !== `pstack-run/${run?.id}/${worker.id}`) problems.push(`${worker.id}: branch ${registered.branch} is not pstack-run/${run?.id}/${worker.id}`);
      const sessionCwd = worker.session?.cwd;
      if (sessionCwd !== undefined && sessionCwd !== null && sessionCwd !== own) problems.push(`${worker.id}: session ran in ${sessionCwd}, not its worktree ${own}`);
    }
    const branches = writable.map((worker) => view.git.worktrees.find((tree) => tree.path === join(worker.dir, 'worktree'))?.branch);
    if (new Set(branches).size !== branches.length) problems.push('two workers share a branch');
    return when(problems.length === 0, `${writable.length} worktree workers, ${paths.size} distinct worktrees and branches`, problems.join('; '));
  });
}

export function writableWorkerRecords(id: string, source: Src | Src[], roles?: string[]): Check {
  return check(id, 'a writable worker leaves report.md and recorded receipts; a readonly worker leaves its report as its final reply', source, (view) => {
    const workers = allWorkers(view).filter((worker) => assignmentOf(worker).kind !== 'watch' && (roles === undefined || roles.includes(String(assignmentOf(worker).role))));
    if (workers.length === 0) return fail('no worker');
    const problems = workers.flatMap((worker) => {
      if (assignmentOf(worker).workspace?.mode === 'readonly') return worker.finalText.trim() === '' ? [`${worker.id}: readonly worker has no final reply`] : [];
      const run = view.runs.find((entry) => entry.workers.includes(worker)) as RunDir;
      const own = run.receipts.filter((receipt) => worker.evidenceFiles.includes(`${receipt.id}.json`) || worker.evidenceFiles.includes(`${receipt.id}.receipt.json`));
      if (worker.report === null || worker.report.trim() === '') return [`${worker.id}: no report.md`];
      return own.length === 0 ? [`${worker.id}: no receipt recorded from its evidence/ (${worker.evidenceFiles.join(', ') || 'empty'})`] : [];
    });
    return when(problems.length === 0, `${workers.length} workers left their records`, problems.join('; '));
  });
}

// ---- reply and logs

export function replySections(id: string, title: string, source: Src | Src[], sections: string[]): Check {
  return check(id, title, source, (view) => {
    const reply = finalReply(view);
    const missing = sections.filter((section) => !new RegExp(`^\\s*(?:#{1,4}\\s*|\\*\\*)${section}\\b`, 'mi').test(reply));
    return when(missing.length === 0, `final reply has ${sections.join(', ')}`, `missing sections ${missing.join(', ')}; reply starts: ${reply.slice(0, 120)}`);
  });
}

/** Every file:line citation in the text names a real file at the base commit and a line inside it. */
export function citationsResolve(id: string, source: Src | Src[], options: { min: number; from?: (view: RunView) => string } = { min: 1 }): Check {
  return check(id, `the reply cites at least ${options.min} file:line references, and each resolves in the repository`, source, (view) => {
    const text = (options.from ?? finalReply)(view);
    const cites = [...text.matchAll(/(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.(?:js|ts|json|md|mjs|tla|sh|py|css|html)):(\d+)/g)].map((match) => ({ file: match[1] as string, line: Number(match[2]) }));
    const bad = cites.filter((cite) => {
      const path = join(view.repo, cite.file);
      if (!existsSync(path)) return !existsSync(join(view.sandbox, cite.file));
      return cite.line < 1 || cite.line > readFileSync(path, 'utf8').split('\n').length;
    });
    return when(cites.length >= options.min && bad.length === 0, `${cites.length} citations resolve (${cites.slice(0, 3).map((cite) => `${cite.file}:${cite.line}`).join(', ')})`, bad.length > 0 ? `unresolved: ${bad.map((cite) => `${cite.file}:${cite.line}`).join(', ')}` : `only ${cites.length} citations`);
  });
}

export const DECISION_HEADER = ['ts', 'phase', 'decision', 'why', 'evidence', 'result'];

export function decisionLog(id: string, source: Src | Src[], options: { run?: string; min: number; phases?: RegExp }): Check {
  return check(id, 'decisions.tsv has the show-me-your-work header, six single-line cells per row, ISO timestamps, and evidence pointers', source, (view) => {
    const run = view.runs.find((entry) => options.run === undefined || entry.id === options.run) ?? view.runs[0];
    const rows = run?.decisions;
    if (rows == null) return fail('no decisions.tsv in the run directory');
    const [header, ...body] = rows;
    const problems: string[] = [];
    if (JSON.stringify(header) !== JSON.stringify(DECISION_HEADER)) problems.push(`header is ${JSON.stringify(header)}`);
    if (body.length < options.min) problems.push(`${body.length} rows, want at least ${options.min}`);
    body.forEach((row, index) => {
      if (row.length !== 6) problems.push(`row ${index + 1} has ${row.length} cells`);
      else {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(row[0] as string)) problems.push(`row ${index + 1} ts ${row[0]}`);
        if ((row[4] as string).trim() === '') problems.push(`row ${index + 1} has no evidence pointer`);
        if (options.phases !== undefined && !options.phases.test(row[1] as string)) problems.push(`row ${index + 1} phase ${row[1]}`);
      }
    });
    const stamps = body.map((row) => row[0] as string);
    if (stamps.some((stamp, index) => index > 0 && stamp < (stamps[index - 1] as string))) problems.push('timestamps go backwards, so the log is not append-only');
    return when(problems.length === 0, `${body.length} rows`, problems.join('; '));
  });
}

export function noToolErrors(id: string, source: Src | Src[], allow: RegExp[] = []): Check {
  return check(id, 'no parent tool call failed unexpectedly', source, (view) => {
    const errors = view.parent.toolCalls.filter((call: ToolCall) => call.isError && !allow.some((pattern) => pattern.test(call.resultText) || pattern.test(JSON.stringify(call.args))));
    return when(errors.length === 0, `${view.parent.toolCalls.length} tool calls, none failed`, errors.map((call) => `${call.name}: ${call.resultText.slice(0, 120)}`).join(' | '));
  });
}

// ---- recorded receipts

export function receiptsFor(id: string, title: string, source: Src | Src[], match: (receipt: Receipt, run: RunDir) => boolean, min: number): Check {
  return check(id, title, source, (view) => {
    const hits = view.runs.flatMap((run) => run.receipts.filter((receipt) => match(receipt, run)).map((receipt) => ({ run, receipt })));
    const problems = hits.map(({ run, receipt }) => verifyReceipt(run, receipt)).filter((problem): problem is string => problem !== null);
    return when(hits.length >= min && problems.length === 0, `${hits.length} matching receipts re-verify: ${hits.map(({ receipt }) => receipt.id).join(', ')}`, problems.join('; ') || `${hits.length} matching receipts, want ${min}`);
  });
}

export type { Outcome };

// ---- ordering of tool calls across the parent session

export const spawnOrder = (view: RunView, workerId: string): number => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes(`/workers/${workerId}/`))?.order ?? -1;
export const collectOrder = (view: RunView, workerId: string): number => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === workerId && !call.isError)?.order ?? -1;

const idsOf = (view: RunView, roles: string[]) => allWorkers(view).filter((worker) => roles.includes(String(assignmentOf(worker).role))).map((worker) => worker.id);

/** All workers of these roles were spawned from one assistant message ("in a single message"). */
export function spawnedTogether(id: string, source: Src | Src[], roles: string[], filter: (workerId: string) => boolean = () => true): Check {
  return check(id, `the ${roles.join('/')} workers were spawned in a single assistant message`, source, (view) => {
    const ids = idsOf(view, roles).filter(filter);
    const orders = ids.map((workerId) => spawnOrder(view, workerId));
    return when(ids.length >= 2 && !orders.includes(-1) && new Set(orders).size === 1, `${ids.join(', ')} spawned at message ${orders[0]}`, `spawn message order per worker: ${ids.map((workerId, index) => `${workerId}@${orders[index]}`).join(', ') || 'none'}`);
  });
}

/** Every worker of the later roles was spawned after every worker of the earlier roles was collected. */
export function spawnedAfterCollect(id: string, title: string, source: Src | Src[], later: string[], earlier: string[]): Check {
  return check(id, title, source, (view) => {
    const first = Math.min(...idsOf(view, later).map((workerId) => spawnOrder(view, workerId)));
    const lastCollect = Math.max(...idsOf(view, earlier).map((workerId) => collectOrder(view, workerId)));
    return when(Number.isFinite(first) && Number.isFinite(lastCollect) && lastCollect !== -1 && first > lastCollect, `${later.join('/')} spawned at ${first}, after ${earlier.join('/')} collected at ${lastCollect}`, `${later.join('/')} first spawn ${first}, ${earlier.join('/')} last collect ${lastCollect}`);
  });
}

/** The brief of each later worker contains the final text of each earlier worker (findings filled into the template). */
export function briefCarries(id: string, title: string, source: Src | Src[], later: string[], earlier: string[]): Check {
  return check(id, title, source, (view) => {
    const sources = allWorkers(view).filter((worker) => earlier.includes(String(assignmentOf(worker).role)));
    const targets = allWorkers(view).filter((worker) => later.includes(String(assignmentOf(worker).role)));
    const probe = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 80);
    const missing = targets.flatMap((target) => sources.filter((entry) => !(target.brief ?? '').replace(/\s+/g, ' ').includes(probe(entry.finalText))).map((entry) => `${target.id} brief lacks ${entry.id}'s findings`));
    return when(targets.length > 0 && sources.length > 0 && missing.length === 0, `${targets.map((worker) => worker.id).join(', ')} brief carries ${sources.map((worker) => worker.id).join(', ')}`, missing.join('; ') || 'no workers to compare');
  });
}

/** The parent ran every one of these shell patterns before its first worker spawn. */
export function parentRanBeforeSpawn(id: string, title: string, source: Src | Src[], patterns: RegExp[]): Check {
  return check(id, title, source, (view) => {
    const spawn = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn')?.order ?? Number.POSITIVE_INFINITY;
    const bash = view.parent.toolCalls.filter((call) => call.name === 'bash' && call.order < spawn).map((call) => String(call.args['command']));
    const missing = patterns.filter((pattern) => !bash.some((command) => pattern.test(command)));
    return when(missing.length === 0, `parent ran ${patterns.map(String).join(', ')} before the first spawn`, `not run before the first spawn: ${missing.map(String).join(', ')}`);
  });
}

export function parentNeverOpened(id: string, title: string, source: Src | Src[], names: string[]): Check {
  return check(id, title, source, (view) => {
    const opened = names.filter((name) => openedAt(view.parent, skillFile(name)) !== -1);
    return when(opened.length === 0, `parent opened none of ${names.join(', ')}`, `parent opened ${opened.join(', ')}`);
  });
}

export function replyLacks(id: string, title: string, source: Src | Src[], patterns: RegExp[]): Check {
  return check(id, title, source, (view) => {
    const reply = finalReply(view);
    const hit = patterns.filter((pattern) => pattern.test(reply));
    return when(reply !== '' && hit.length === 0, 'the reply contains none of the banned forms', `the reply contains ${hit.map(String).join(', ')}`);
  });
}

/** A PR number or commit the reply cites exists in the repository history or in a tool result a worker or the parent saw. */
export function noInventedSources(id: string, source: Src | Src[]): Check {
  return check(id, 'every PR number and commit the reply cites exists in git history or in a tool result the run saw', source, (view) => {
    const reply = finalReply(view);
    const seen = [view.parent, ...allWorkers(view).map((worker) => worker.session)].flatMap((session) => session?.toolCalls.map((call) => call.resultText) ?? []).join('\n');
    const prs = [...new Set([...reply.matchAll(/(?<![\w&])#(\d{1,6})\b/g)].map((match) => match[1] as string))];
    const known = (n: string) => seen.includes(`#${n}`);
    const shas = [...new Set([...reply.matchAll(/\b([0-9a-f]{7,40})\b/g)].map((match) => match[1] as string).filter((sha) => /\d/.test(sha) && /[a-f]/.test(sha)))];
    const unknownShas = shas.filter((sha) => !seen.includes(sha) && !allWorkers(view).some((worker) => worker.finalText.includes(sha)));
    const unknownPrs = prs.filter((n) => !known(n));
    return when(unknownPrs.length === 0 && unknownShas.length === 0 && (prs.length > 0 || shas.length > 0), `${prs.length} PR numbers and ${shas.length} commits all appear in tool results`, `not in any tool result: PRs ${unknownPrs.join(', ') || 'none'}, commits ${unknownShas.join(', ') || 'none'}${prs.length + shas.length === 0 ? '; the reply cites no source at all' : ''}`);
  });
}

/** A panel role: the workers of that role run on the models the line lists, each entry used, from at least two families when the line has them. */
export function panelCheck(id: string, title: string, source: Src | Src[], options: { role: string; line: string; mode: 'worktree' | 'readonly' }): Check {
  return check(id, title, source, (view) => {
    const workers = allWorkers(view).filter((worker) => assignmentOf(worker).role === options.role);
    const configured = view.models?.[options.line];
    const entries = (Array.isArray(configured) ? configured : configured === undefined ? [] : [configured]).map((entry) => entry.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, ''));
    const parent = view.parent.models[0] ?? '';
    const used = workers.map((worker) => {
      const model = String(assignmentOf(worker).model);
      return model === 'inherit-parent' ? parent : model;
    });
    const problems: string[] = [];
    if (workers.length < Math.max(2, entries.length === 0 ? 2 : Math.min(entries.length, 2))) problems.push(`${workers.length} ${options.role} workers`);
    for (const worker of workers) if (assignmentOf(worker).workspace?.mode !== options.mode) problems.push(`${worker.id} workspace ${String(assignmentOf(worker).workspace?.mode)} is not ${options.mode}`);
    const outside = used.filter((model) => !entries.includes(model));
    if (entries.length > 0 && outside.length > 0) problems.push(`models outside the "${options.line}" line: ${outside.join(', ')}`);
    const unused = entries.filter((entry) => !used.includes(entry));
    if (workers.length >= entries.length && unused.length > 0) problems.push(`line entries with no worker: ${unused.join(', ')}`);
    const families = new Set(used.map(FAMILY_OF));
    const available = new Set(entries.map(FAMILY_OF));
    if (families.size < Math.min(2, available.size)) problems.push(`one model family only (${[...families].join(', ')}): two labels on one family are not independent review`);
    return when(problems.length === 0, `${workers.length} ${options.role} workers on ${used.join(', ')} (${families.size} families)`, problems.join('; '));
  });
}

/** Every spawn of these roles happens before the parent's first collect, "one after another without waiting". */
export function fanOutBeforeCollect(id: string, source: Src | Src[], roles: string[]): Check {
  return check(id, `all ${roles.join('/')} workers are spawned before the parent waits on or collects any of them`, source, (view) => {
    const ids = idsOf(view, roles);
    const spawns = ids.map((workerId) => spawnOrder(view, workerId));
    const collects = ids.map((workerId) => collectOrder(view, workerId)).filter((order) => order !== -1);
    const firstCollect = Math.min(...collects);
    return when(ids.length >= 2 && !spawns.includes(-1) && Math.max(...spawns) < firstCollect, `${ids.length} spawns (last at ${Math.max(...spawns)}) precede the first collect (${firstCollect})`, `spawn orders ${spawns.join(',')}, first collect ${firstCollect}`);
  });
}

/** The sentence-level contract of a brief: every listed pattern appears in the brief of each worker of the role. */
export function briefsContain(id: string, title: string, source: Src | Src[], roles: string[], patterns: { name: string; pattern: RegExp }[]): Check {
  return check(id, title, source, (view) => {
    const workers = allWorkers(view).filter((worker) => roles.includes(String(assignmentOf(worker).role)));
    const gaps = workers.flatMap((worker) => patterns.filter(({ pattern }) => !pattern.test(worker.brief ?? '')).map(({ name }) => `${worker.id} brief lacks ${name}`));
    return when(workers.length > 0 && gaps.length === 0, `${workers.length} briefs carry ${patterns.map(({ name }) => name).join(', ')}`, gaps.join('; ') || 'no workers');
  });
}

/** The parent opened these repository files (by suffix) with read or a shell reader. */
export function parentOpenedFiles(id: string, title: string, source: Src | Src[], suffixes: (view: RunView) => string[]): Check {
  return check(id, title, source, (view) => {
    const wanted = suffixes(view);
    const missing = wanted.filter((suffix) => openedAt(view.parent, suffix) === -1);
    return when(wanted.length > 0 && missing.length === 0, `parent opened ${wanted.length} files`, `parent never opened ${missing.join(', ')}`);
  });
}
