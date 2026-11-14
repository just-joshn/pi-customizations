// Reusable contract checks. Each one reads only run artifacts and enforces a rule an upstream playbook or skill states.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { skillBlock } from '../../../src/skill-block.ts';
import { type Check, check, checkAbsence, fail, type Outcome, pass, type Src, src, when } from './check.ts';
import { PKG } from './driver.ts';
import { type Receipt, type RunDir, type RunView, type Session, STEP_LINE, type ToolCall, type WorkerView } from './view.ts';

export const GEN = join(PKG, 'generated', 'skills');
export const PINNED_REVISION = (JSON.parse(readFileSync(join(PKG, 'generated', 'upstream-lock.json'), 'utf8')) as { revision: string }).revision;
export const READONLY_TOOLS = ['read', 'grep', 'find', 'ls', 'bash_readonly', 'pstack_evidence'];
export const FAMILY_OF = (model: string): string => model.slice(model.indexOf('/') + 1).split(/[-.]/)[0] as string;

// ---- plumbing

const READERS = /\b(cat|head|tail|sed|less|bat|nl)\b/;

/** First full native skill expansion or tool call opening the file, or -1. */
export function openedAt(session: Session | null, suffix: string): number {
  if (session === null) return -1;
  const skill = /(?:^|\/)([a-z0-9-]+)\/SKILL\.md$/.exec(suffix)?.[1];
  const expanded = skill === undefined ? undefined : session.messages.find((message) => message.role === 'user' && expandedSkill(message.text, skill) !== undefined);
  const call = session.toolCalls.find((entry) => (entry.name === 'read' && String(entry.args['path'] ?? '').endsWith(suffix)) || (entry.name === 'bash' && READERS.test(String(entry.args['command'] ?? '')) && shellCommands(String(entry.args['command'] ?? '')).some((command) => command.includes(suffix) || readsInDirectory(command, suffix))));
  return expanded === undefined ? (call?.order ?? -1) : Math.min(expanded.order, call?.order ?? Number.POSITIVE_INFINITY);
}

/**
 * The command, plus its body once per word of each `for VAR in WORDS; do BODY; done` it holds, with the variable replaced:
 * `for s in how why; do cat generated/skills/$s/SKILL.md; done` opens both SKILL.md files without writing either path out.
 */
export function shellCommands(command: string): string[] {
  const expanded = [...command.matchAll(/\bfor\s+(\w+)\s+in\s+([^;\n]+?)\s*[;\n]\s*do\b([\s\S]*?)(?:;\s*done\b|\bdone\b|$)/g)].flatMap((loop) =>
    (loop[2] as string).split(/\s+/).filter(Boolean).map((word) => (loop[3] as string).replace(new RegExp(`\\$\\{${loop[1]}\\}|\\$${loop[1]}\\b`, 'g'), word.replace(/^["']|["']$/g, ''))),
  );
  return [command, ...expanded];
}

/**
 * `cd <dir> && cat src/x.js`, or `B=<dir>; cat $B/src/x.js`, opens `<dir>/src/x.js` without ever writing the joined path. A suffix of the
 * form `<name>/worktree/<file>` is opened that way when one shell command names the worktree directory and the file under it, and reads.
 */
function readsInDirectory(command: string, suffix: string): boolean {
  let cwd = '';
  const variables = new Map<string, string>();
  for (const raw of command.split(/&&|;|\n/)) {
    const part = raw.replace(/\$\{(\w+)\}|\$(\w+)/g, (reference, braced: string | undefined, bare: string | undefined) => variables.get(braced ?? bare ?? '') ?? reference);
    const assigned = /^\s*(\w+)=["']?([^"'\s]+)["']?\s*$/.exec(part);
    if (assigned !== null) variables.set(assigned[1] as string, assigned[2] as string);
    const cd = /^\s*cd\s+["']?([^"'\s]+)["']?\s*$/.exec(part);
    if (cd !== null) cwd = resolve(cwd || '/', cd[1] as string);
    const read = /^\s*(?:cat|head|tail|sed|less|bat|nl)\s+(.+)$/.exec(part);
    if (read !== null && (read[1] as string).split(/\s+/).some((word) => {
      const path = word.replace(/^["']|["']$/g, '');
      return (isAbsolute(path) || cwd !== '') && resolve(cwd || '/', path).endsWith(suffix);
    })) return true;
  }
  const at = suffix.indexOf('/worktree/');
  if (at === -1) return false;
  const directory = suffix.slice(0, at + '/worktree'.length);
  const file = suffix.slice(at + '/worktree/'.length);
  return command.includes(directory) && new RegExp(`(^|[\\s"'/=:$}])${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s"';&|)])`).test(command);
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

const isFiller = (message: { text: string }) => message.text.trim() === '' || message.text === '(script complete)' || message.text.startsWith('waiting for worker ');

/**
 * A wake opens a turn of its own. When the parent had already collected that worker, or had already given a longer reply, that turn only
 * acknowledges ("Collected. Same report, so the answer stands"): it is not the answer the user reads, and the answer is the reply before it.
 * A wake for a worker not yet collected, answered by a reply longer than everything before it, is where the answer comes.
 */
function isRedundantWakeTurn(view: RunView, assistant: { order: number; text: string }): boolean {
  const trigger = [...view.parent.messages].reverse().find((message) => message.order < assistant.order && (message.role === 'user' || message.role === 'custom'));
  if (trigger?.customType !== 'pstack-worker') return false;
  const workerId = trigger.details?.['workerId'];
  const lastSteer = Math.max(-1, ...view.parent.toolCalls.filter((call) => call.name === 'pstack_worker' && call.args['action'] === 'steer' && call.args['workerId'] === workerId && call.order < trigger.order).map((call) => call.order));
  const collectedBefore = view.parent.toolCalls.some((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === workerId && !call.isError && call.order > lastSteer && call.order < trigger.order && /settled/.test(call.resultText));
  const longerBefore = view.parent.messages.some((message) => message.role === 'assistant' && message.order < trigger.order && !isFiller(message) && message.text.trim().length > assistant.text.trim().length);
  const worked = view.parent.toolCalls.some((call) => call.order > trigger.order && call.order < assistant.order && !(call.name === 'pstack_worker' && ['collect', 'inspect'].includes(String(call.args['action']))));
  return collectedBefore || (longerBefore && !worked);
}

export function finalReply(view: RunView): string {
  const replies = [...view.parent.messages].reverse().filter((message) => message.role === 'assistant' && !isFiller(message));
  return (replies.find((message) => !isRedundantWakeTurn(view, message)) ?? replies[0])?.text ?? '';
}

/**
 * A candidate's brief names the candidate: its id, "Candidate 2", and its own run directory. Two briefs are the same prompt when only
 * that identity differs, so the comparison blanks it out before looking.
 */
export function withoutOwnIdentity(brief: string, worker: WorkerView): string {
  const number = /(\d+)$/.exec(worker.id)?.[1];
  const names = [worker.id, ...(number === undefined ? [] : [`${worker.id.replace(/[-_ ]?\d+$/, '')} ${number}`])];
  let text = brief.replaceAll(worker.dir, '<own>');
  for (const name of names) text = text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[- _]/g, '[-_ ]'), 'gi'), '<own>');
  return text.replace(/(<own>)(\/worktree)?/g, '<own>');
}

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
    }, 'adaptation'),
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
          if (call.name === 'write' || call.name === 'edit') return true;
          if (call.name !== 'bash') return false;
          return String(call.args['command']).split(/&&|;|\n|\|/).some((command) => {
            if (!command.includes(`${found?.id ?? '?'}/TODO.md`)) return false;
            return />{1,2}\s*["']?[^\s"';&|]*\/TODO\.md\b/.test(command) || /\b(?:sed\s+-i|tee\s+|mv\s+)/.test(command) || /\bcp\s+.*\/TODO\.md["']?\s*$/.test(command);
          });
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
  const examples = ['shipping', 'autopilot-full', 'autopilot-stack', 'orchestrate'].includes(playbook) ? ['control-ui', 'control-cli'] : [];
  const ownerSkills = playbook.startsWith('autopilot-') ? ['deslop', 'show-me-your-work'] : [];
  const named = skillsNamedBy(playbook).filter((entry) => ![...optional, ...examples, ...ownerSkills].includes(entry.name) && !conditionalLeaves.includes(entry.name));
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

function expandedSkill(prompt: string, skill: string): string | undefined {
  const location = new RegExp(`<skill name="${skill}" location="([^"]+)">`).exec(prompt)?.[1];
  if (location === undefined || !isAbsolute(location) || !location.endsWith(skillFile(skill))) return undefined;
  const block = skillBlock(skill, join(GEN, skill, 'SKILL.md'))?.replaceAll(join(GEN, skill), dirname(location));
  return block !== undefined && prompt.includes(block) ? block : undefined;
}

export function skillRequest(prompt: string): string {
  let request = prompt;
  for (;;) {
    const name = /^<skill name="([a-z0-9-]+)" location=/.exec(request)?.[1];
    const block = name === undefined ? undefined : expandedSkill(request, name);
    if (block === undefined || !request.startsWith(block)) return request;
    request = request.slice(block.length).trimStart();
  }
}

export function promptHasSkill(prompt: string, skill: string, requestRequired = true): boolean {
  const block = expandedSkill(prompt, skill);
  return block !== undefined && prompt.startsWith(block) && (!requestRequired || skillRequest(prompt).trim().length > 0);
}

export const promptRoutes = (skill: string): Check =>
  check(`slash.${skill}`, `/${skill} reaches Pi as the expanded pstack ${skill} skill with the request`, src(`${skill}/SKILL.md`, '# '), (view) => when(promptHasSkill(view.prompt, skill), `first user message expands ${skillFile(skill)} with its absolute location and request`, `first user message was: ${view.prompt.slice(0, 160)}`));

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

export const modelIdentity = (spec: string): string => spec.replace(/:(off|minimal|low|medium|high|xhigh|max)$/, '');

export function expectedModels(view: RunView, line: string): string[] {
  const value = view.models?.[line];
  const parent = view.parent.models[0] ?? '';
  if (value === undefined) return [];
  const list = (Array.isArray(value) ? value : [value]).map(modelIdentity);
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
        if (allowed.length > 0 && !allowed.includes(modelIdentity(String(assignment.model)))) problems.push(`${worker.id} model ${String(assignment.model)} is not the "${spec.modelLine}" line (${allowed.join(' | ')})`);
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

/**
 * Files the parent wrote into the repository outside `.pi/`. A hidden file (`.pi-setup-workers.mjs`) that is in no commit and not in the
 * working tree afterwards is a scratch script the parent used to write worker files and then removed: it left nothing in the repository.
 */
export function parentProductionWrites(view: RunView, allow?: RegExp): string[] {
  const written = view.parent.toolCalls.filter((call) => (call.name === 'write' || call.name === 'edit') && !call.isError).map((call) => String(call.args['path'] ?? ''));
  const inRepo = written.filter((path) => (path.startsWith(view.repo) || !path.startsWith('/')) && !path.includes('/.pi/') && !path.startsWith('.pi/'));
  const kept = (path: string) => {
    const relativePath = path.startsWith(view.repo) ? path.slice(view.repo.length + 1) : path;
    if (allow?.test(relativePath)) return false;
    if (!basename(relativePath).startsWith('.')) return true;
    if (view.git.dirty.includes(relativePath)) return true;
    return spawnSync('git', ['-C', view.repo, 'cat-file', '-e', `HEAD:${relativePath}`]).status === 0;
  };
  return inRepo.filter(kept);
}

/** A commit's change as git's patch-id sees it, so a cherry-pick and its original compare equal. Empty for an empty commit. */
function patchId(view: RunView, sha: string): string {
  const show = spawnSync('git', ['-C', view.repo, 'show', '--format=', sha], { encoding: 'utf8' });
  return spawnSync('git', ['-C', view.repo, 'patch-id', '--stable'], { input: show.stdout, encoding: 'utf8' }).stdout.split(' ')[0] ?? '';
}

/**
 * Commits on the checkout's branch since the base that carry no worker's change. A worker's commit that the parent fast-forwarded or
 * cherry-picked into the checkout is the worker's; a commit with a change no worker branch holds, or an empty commit, is the parent's own.
 */
export function commitsNotFromWorkers(view: RunView): string[] {
  const workerShas = new Set(Object.entries(view.git.branchCommits).filter(([branch]) => branch.startsWith('pstack-run/')).flatMap(([, commits]) => commits));
  const workerPatches = new Set([...workerShas].map((sha) => patchId(view, sha)).filter((id) => id !== ''));
  return view.git.commitsSinceBase.filter((sha) => !workerShas.has(sha) && !workerPatches.has(patchId(view, sha)));
}

/** `allow` names the paths the skill has the run write beside the repository's own files (a verification skill's proof under artifacts/). */
export function repoUntouched(id: string, title: string, source: Src | Src[], allow?: RegExp): Check {
  return checkAbsence(id, title, source, (view) => {
    const dirty = view.git.dirty.filter((path) => !allow?.test(path));
    const moved = view.git.commitsSinceBase;
    const parentWrites = parentProductionWrites(view);
    return when(dirty.length === 0 && moved.length === 0 && parentWrites.length === 0, `working tree clean outside .pi/, HEAD at base, ${view.parent.toolCalls.filter((call) => call.name === 'write' || call.name === 'edit').length} parent write calls, none into the repository outside .pi/`, `dirty: ${dirty.join(', ') || 'none'}; commits since base: ${moved.length}; parent writes: ${parentWrites.join(', ') || 'none'}`);
  });
}

const SETTLED_INSPECT = /: (idle|stopped|exited|failed|aborted)\b/;

/**
 * pstack_worker's own rule: collect "only after a pstack-worker wake message or an inspect that shows the worker settled".
 * A parent that polls with inspect collects before a wake that is queued behind its running turn, and that is allowed.
 */
export function collectedOnEvidence(view: RunView, workerId: string, collect: ToolCall, wakeOrder: number): boolean {
  if (collect.order > wakeOrder) return true;
  return view.parent.toolCalls.some((call) => call.name === 'pstack_worker' && call.args['action'] === 'inspect' && call.args['workerId'] === workerId && call.order < collect.order && SETTLED_INSPECT.test(call.resultText));
}

export function settledAndCollected(id: string, source: Src | Src[], roles?: string[]): Check {
  return check(id, 'every worker settled, and the parent collected it after a pstack-worker wake or an inspect that showed it settled', source, (view) => {
    const workers = allWorkers(view).filter((worker) => assignmentOf(worker).kind !== 'watch' && (roles === undefined || roles.includes(String(assignmentOf(worker).role))));
    if (workers.length === 0) return fail('no worker');
    const problems = workers.flatMap((worker) => {
      const settles = (worker.state?.['settles'] as { phase: string }[] | undefined) ?? [];
      if (settles.length === 0 || !settles.some((settle) => settle.phase === 'idle')) return [`${worker.id} never recorded an idle settle (${JSON.stringify(settles.map((settle) => settle.phase))})`];
      const wake = view.parent.messages.find((message) => message.customType === 'pstack-worker' && message.details?.['workerId'] === worker.id);
      const collect = view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'collect' && call.args['workerId'] === worker.id && !call.isError && /"settled":\s*true|settled/.test(call.resultText));
      if (collect === undefined) return [wake === undefined ? `${worker.id}: no pstack-worker wake in the parent session, and the parent never collected a settled result` : `${worker.id}: parent never collected a settled result`];
      // The collect span allows an inspect that shows the worker settled in place of a wake, and a settle the parent already collected is sent no wake.
      return collectedOnEvidence(view, worker.id, collect, wake?.order ?? Number.POSITIVE_INFINITY) ? [] : [`${worker.id}: collected before ${wake === undefined ? 'any wake' : 'its wake'}, and no inspect had shown it settled`];
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
      const branch = `pstack-run/${run?.id}/${worker.id}`;
      if (registered === undefined && (worker.session?.cwd !== own || view.git.branchCommits[branch] === undefined)) problems.push(`${worker.id}: no registered worktree or session and retained branch evidence at ${own}`);
      else if (registered !== undefined && registered.branch !== branch) problems.push(`${worker.id}: branch ${registered.branch} is not ${branch}`);
      const sessionCwd = worker.session?.cwd;
      if (sessionCwd !== undefined && sessionCwd !== null && sessionCwd !== own) problems.push(`${worker.id}: session ran in ${sessionCwd}, not its worktree ${own}`);
    }
    const branches = writable.map((worker) => view.git.worktrees.find((tree) => tree.path === join(worker.dir, 'worktree'))?.branch ?? `pstack-run/${view.runs.find((run) => run.workers.includes(worker))?.id}/${worker.id}`);
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
      // The worker's own receipt: its file is in the worker's evidence/ under the receipt's id, or the receipt names an artifact there
      // (the parent may record it under a run-unique id, since two workers can each write a node-test receipt).
      const own = run.receipts.filter((receipt) => worker.evidenceFiles.includes(`${receipt.id}.json`) || worker.evidenceFiles.includes(`${receipt.id}.receipt.json`) || receipt.artifacts.some((artifact) => artifact.path.includes(`workers/${worker.id}/evidence/`)));
      // The worker contract has a writable worker write report.md and receipts "in the worker directory the brief names": a brief that
      // names neither report.md, a worker directory, nor evidence leaves the worker owing its final reply, which collect hands back.
      const brief = worker.brief ?? undefined;
      const asksReport = brief === undefined || /report\.md|worker directory|workers\/[\w-]+\//i.test(brief);
      const asksReceipt = brief === undefined || /receipt|pstack_evidence|\bevidence\//i.test(brief);
      if (asksReport && (worker.report === null || worker.report.trim() === '')) return [`${worker.id}: no report.md, and its brief asks for one`];
      if (!asksReport && (worker.report === null || worker.report.trim() === '') && worker.finalText.trim() === '') return [`${worker.id}: no report.md and no final reply`];
      return asksReceipt && own.length === 0 ? [`${worker.id}: no receipt recorded from its evidence/ (${worker.evidenceFiles.join(', ') || 'empty'}), and its brief asks for one`] : [];
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
/** The reply names at least `min` distinct repository files, every `file:line` it gives is inside its file, and none of the files it names is missing. */
export function fileReferencesResolve(id: string, source: Src | Src[], options: { min: number; from?: (view: RunView) => string }): Check {
  return check(id, `the reply references at least ${options.min} repository files, and every file it names exists and every line it gives is inside its file`, source, (view) => {
    const text = (options.from ?? finalReply)(view);
    if (text.trim() === '') return { inconclusive: 'no presented text to resolve references from' };
    const tracked = readdirSync(view.repo, { recursive: true }).map(String).filter((path) => !path.startsWith('.') && !path.includes('node_modules') && /\.[a-z]+$/.test(path));
    const resolve = (file: string) => (file.includes('/') ? (existsSync(join(view.repo, file)) ? file : undefined) : tracked.find((path) => path === file || path.endsWith(`/${file}`)));
    // A bare name that is no repository file (Node.js, a library) is prose; a path with a directory is a claim about this repository.
    const refs = [...text.matchAll(/(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.(?:js|ts|json|md|mjs|tla|sh|py|css|html))(?::(\d+))?/g)]
      .map((match) => ({ file: match[1] as string, line: match[2] === undefined ? null : Number(match[2]) }))
      .filter((ref) => ref.file.includes('/') || resolve(ref.file) !== undefined);
    const bad = refs.filter((ref) => {
      const path = resolve(ref.file);
      if (path === undefined) return true;
      return ref.line !== null && (ref.line < 1 || ref.line > readFileSync(join(view.repo, path), 'utf8').split('\n').length);
    });
    const files = new Set(refs.map((ref) => resolve(ref.file)).filter((path) => path !== undefined));
    return when(files.size >= options.min && bad.length === 0, `${files.size} repository files referenced (${[...files].slice(0, 4).join(', ')}), every reference resolves`, bad.length > 0 ? `unresolved: ${bad.map((ref) => `${ref.file}${ref.line === null ? '' : `:${ref.line}`}`).join(', ')}` : `only ${files.size} files referenced`);
  });
}

export function citationsResolve(id: string, source: Src | Src[], options: { min: number; from?: (view: RunView) => string } = { min: 1 }): Check {
  return check(id, `the reply\'s file:line citations each resolve in the repository (at least ${options.min} required)`, source, (view) => {
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

/** A shell command that ran and returned non-zero is the shell's answer (a probe for a path, a grep with no match), not a failed tool. */
const RAN_AND_EXITED_NONZERO = /\n\nCommand exited with code [1-9]\d*\s*$/;

export function noToolErrors(id: string, source: Src | Src[], allow: RegExp[] = []): Check {
  return checkAbsence(id, 'no parent tool call failed unexpectedly: a bash command that ran and exited non-zero is an answer, not a failure', source, (view) => {
    const errors = view.parent.toolCalls.filter((call: ToolCall) => call.isError && !(call.name === 'bash' && RAN_AND_EXITED_NONZERO.test(call.resultText)) && !allow.some((pattern) => pattern.test(call.resultText) || pattern.test(JSON.stringify(call.args))));
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

/**
 * The brief carries a worker's findings when its opening is there verbatim, or when most of its substantive lines are. A brief template
 * puts the findings under its own headings and the model may demote or retitle the findings' headings and trim a path, so the opening is
 * not the only place the text survives. A brief that holds a summary or a one-line mention carries almost none of the lines.
 */
export function carries(brief: string, findings: string, probe: (text: string) => string): boolean {
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
  const whole = flat(brief);
  if (whole.includes(probe(findings))) return true;
  const lines = findings.split('\n').map(flat).filter((line) => line.length >= 40 && !line.startsWith('#'));
  return lines.length >= 3 && lines.filter((line) => whole.includes(line)).length / lines.length >= 0.6;
}

/** The brief of each later worker contains the final text of each earlier worker (findings filled into the template). */
export function briefCarries(id: string, title: string, source: Src | Src[], later: string[], earlier: string[]): Check {
  return check(id, title, source, (view) => {
    const sources = allWorkers(view).filter((worker) => earlier.includes(String(assignmentOf(worker).role)));
    const targets = allWorkers(view).filter((worker) => later.includes(String(assignmentOf(worker).role)));
    const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
    const probe = (text: string) => flat(text).slice(0, 80);
    const missing = targets.flatMap((target) => sources.filter((entry) => !carries(target.brief ?? '', entry.finalText, probe)).map((entry) => `${target.id} brief lacks ${entry.id}'s findings`));
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
  return checkAbsence(id, title, source, (view) => {
    const opened = names.filter((name) => openedAt(view.parent, skillFile(name)) !== -1);
    return when(opened.length === 0, `parent opened none of ${names.join(', ')}`, `parent opened ${opened.join(', ')}`);
  });
}

export function replyLacks(id: string, title: string, source: Src | Src[], patterns: RegExp[]): Check {
  return checkAbsence(id, title, source, (view) => {
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
    const entries = (Array.isArray(configured) ? configured : configured === undefined ? [] : [configured]).map(modelIdentity);
    const parent = view.parent.models[0] ?? '';
    const used = workers.map((worker) => {
      const model = String(assignmentOf(worker).model);
      return modelIdentity(model === 'inherit-parent' ? parent : model);
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

// ---- git evidence, read independently of the product

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * The playbook's writable delegate: the poteto worker in a worktree. The playbooks name a role, never a worker id, so a run's
 * delegate is whatever it called that worker.
 */
export function delegateOf(view: RunView): WorkerView | undefined {
  return allWorkers(view).find((worker) => assignmentOf(worker).kind !== 'watch' && assignmentOf(worker).role === 'poteto' && assignmentOf(worker).workspace?.mode === 'worktree');
}

/**
 * The delegate's own commits, oldest first: its branch beyond the commit it was spawned at (the checkout beyond that commit when the
 * branch was merged and deleted). A commit the parent made before the spawn is the parent's, not the delegate's; see `workflowCommits`.
 */
export function delegateCommits(view: RunView): string[] {
  const delegate = delegateOf(view);
  const run = delegate === undefined ? undefined : view.runs.find((entry) => entry.workers.includes(delegate));
  if (delegate === undefined || run === undefined) return [];
  if (typeof assignmentOf(delegate).workspace?.inputCommit !== 'string') return `pstack-run/${run.id}/${delegate.id}` in view.git.branchCommits ? branchCommits(view, run.id, delegate.id) : checkoutCommits(view);
  return delegateOwnCommits(view);
}

/** Commits the parent made on the checkout before it spawned the delegate, oldest first: the delegate's input commit beyond the base. */
export function parentSpawnCommits(view: RunView): string[] {
  const delegate = delegateOf(view);
  const input = delegate === undefined ? undefined : assignmentOf(delegate).workspace?.inputCommit;
  if (typeof input !== 'string') return [];
  const listed = spawnSync('git', ['-C', view.repo, 'rev-list', '--reverse', `${view.base}..${input}`], { encoding: 'utf8' });
  return listed.status === 0 ? listed.stdout.split('\n').filter(Boolean) : [];
}

/** Every commit of the workflow in order: what the parent committed before it spawned the delegate, then the delegate's own. */
export const workflowCommits = (view: RunView): string[] => [...parentSpawnCommits(view), ...delegateCommits(view)];

/**
 * Workflow-level red-first: across the whole workflow, whoever wrote it, the first commit holds only tests and fails, and the last
 * one changes source and passes. A failing test the parent committed before the spawn counts here and is not credited to the delegate.
 */
export function redFirst(view: RunView, commits: string[] = workflowCommits(view)): { ok: boolean; detail: string } {
  if (commits.length < 2) return { ok: false, detail: `${commits.length} commits in the workflow, want the test and the fix apart` };
  const first = commits[0] as string;
  const last = commits.at(-1) as string;
  const firstFiles = filesChanged(view, first);
  const lastFiles = filesChanged(view, last);
  const red = runAtCommit(view, first, 'node --test');
  const green = runAtCommit(view, last, 'node --test');
  const ok = firstFiles.every(isTestFile) && lastFiles.some((file) => !isTestFile(file)) && red.status !== 0 && green.status === 0;
  return { ok, detail: ok ? `commit 1 (${firstFiles.join(',')}) fails, last (${lastFiles.join(',')}) passes` : `first touches ${firstFiles.join(',')} exit ${red.status}; last touches ${lastFiles.join(',')} exit ${green.status}` };
}

/** The receipts a TODO step owns: the ones it cites, and the ones whose target is the step ("3", "step-3"). */
export function stepReceipts(run: RunDir | undefined, n: number): Receipt[] {
  if (run === undefined) return [];
  const cited = run.steps.find((step) => step.n === n)?.evidence ?? [];
  return run.receipts.filter((receipt) => cited.includes(receipt.id) || [`${n}`, `step-${n}`, `step${n}`].includes(receipt.target.trim().toLowerCase()));
}

/** A full or abbreviated SHA (7 or more characters) as a prefix of one of `commits`. */
export const namesCommit = (sha: string | null | undefined, commits: string[]): boolean => typeof sha === 'string' && /^[0-9a-f]{7,40}$/.test(sha) && commits.some((commit) => commit.startsWith(sha));

/** The text of a receipt's first artifact, whether its path is absolute or relative to the run directory; empty when unreadable. */
export function artifactText(run: RunDir | undefined, receipt: Receipt | undefined): string {
  const path = receipt?.artifacts[0]?.path;
  if (run === undefined || path === undefined) return '';
  try {
    return readFileSync(isAbsolute(path) ? path : resolve(run.dir, path), 'utf8');
  } catch {
    return '';
  }
}

/** The text of every artifact a receipt names, joined; empty files and unreadable ones contribute nothing. */
export function artifactsText(run: RunDir | undefined, receipt: Receipt | undefined): string {
  if (run === undefined || receipt === undefined) return '';
  return receipt.artifacts
    .map((artifact) => {
      try {
        return readFileSync(isAbsolute(artifact.path) ? artifact.path : resolve(run.dir, artifact.path), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

/** Commits the delegate made itself: its branch beyond the commit it was spawned at, oldest first. */
export function delegateOwnCommits(view: RunView): string[] {
  const delegate = delegateOf(view);
  const run = delegate === undefined ? undefined : view.runs.find((entry) => entry.workers.includes(delegate));
  const input = delegate === undefined ? undefined : assignmentOf(delegate).workspace?.inputCommit;
  if (delegate === undefined || run === undefined || typeof input !== 'string') return [];
  const branch = `pstack-run/${run.id}/${delegate.id}`;
  const listed = spawnSync('git', ['-C', view.repo, 'rev-list', '--reverse', `${input}..${branch in view.git.branchCommits ? branch : 'HEAD'}`], { encoding: 'utf8' });
  return listed.status === 0 ? listed.stdout.split('\n').filter(Boolean) : [];
}

/**
 * Whether a receipt's evidence existed before the worker was spawned, proven by the parent session's tool-call order alone: the
 * receipt was recorded before the spawn call, or an earlier tool call ran the command or wrote the artifact the receipt names (a
 * model may run the command first and record its receipts in a batch later). File modification times are never consulted, because
 * a later run, a copy, or a touch can set them to anything.
 */
export function ranBefore(view: RunView, receipt: Receipt | undefined, worker: WorkerView | undefined): boolean {
  if (receipt === undefined || worker === undefined) return false;
  const spawnAt = spawnOrder(view, worker.id);
  if (spawnAt === -1) return false;
  const recorded = recordOrder(view, receipt.id);
  if (recorded !== -1 && recorded < spawnAt) return true;
  const artifact = receipt.artifacts[0]?.path;
  const command = (receipt.command ?? []).join(' ');
  const names = [...(artifact === undefined ? [] : [basename(artifact)]), ...(command.length >= 8 ? [command] : [])];
  return view.parent.toolCalls.some((call) => call.order < spawnAt && (call.name === 'bash' || call.name === 'write') && names.some((name) => JSON.stringify(call.args).includes(JSON.stringify(name).slice(1, -1))));
}

/** Order of the parent's first `pstack_evidence record` of this receipt (by its file name), or -1. */
export function recordOrder(view: RunView, receiptId: string): number {
  const idIn = (path: string): string | undefined => {
    for (const candidate of [path, join(view.repo, path), ...view.runs.map((run) => join(run.dir, path))]) {
      try {
        const raw = JSON.parse(readFileSync(candidate, 'utf8')) as { id?: string; receipt?: { id?: string } };
        return raw.receipt?.id ?? raw.id;
      } catch {
        /* the next base */
      }
    }
    return undefined;
  };
  const named = (path: string) => basename(path).replace(/\.json$/, '').replace(/\.receipt$/, '') === receiptId || idIn(path) === receiptId;
  return view.parent.toolCalls.find((call) => call.name === 'pstack_evidence' && call.args['action'] === 'record' && !call.isError && named(String(call.args['receiptPath'] ?? '')))?.order ?? -1;
}

/** Commits on the checkout since the base, oldest first. */
export const checkoutCommits = (view: RunView): string[] => [...view.git.commitsSinceBase].reverse();

/** Commits a worker's branch holds beyond the base commit, oldest first. */
export function branchCommits(view: RunView, runId: string, workerId: string): string[] {
  return [...(view.git.branchCommits[`pstack-run/${runId}/${workerId}`] ?? [])].reverse();
}

export function filesChanged(view: RunView, sha: string): string[] {
  const result = spawnSync('git', ['-C', view.repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha], { encoding: 'utf8' });
  return result.stdout.split('\n').filter(Boolean);
}

/** Runs a shell command in a clean export of the commit and returns its exit status and output. */
export function runAtCommit(view: RunView, sha: string, command: string): { status: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wf-commit-'));
  try {
    const archive = spawnSync('sh', ['-c', `git -C ${JSON.stringify(view.repo)} archive ${sha} | tar -x -C ${JSON.stringify(dir)}`], { encoding: 'utf8' });
    if (archive.status !== 0) return { status: 127, output: archive.stderr };
    const run = spawnSync('sh', ['-c', command], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
    return { status: run.status ?? 1, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const isTestFile = (file: string): boolean => file.startsWith('test/') || /\.(test|spec)\.[jt]sx?$/.test(file);

// ---- the refactoring pin

const PIN_RUN = 'node --test --experimental-test-coverage --test-reporter=tap --test-reporter-destination=stdout --test-reporter=lcov --test-reporter-destination=.pin.lcov; status=$?; echo @@LCOV; cat .pin.lcov 2>/dev/null; exit $status';

/** The test suite run for real at a commit: whether it passed, how many tests passed, and which source files those tests executed. */
function pinAt(view: RunView, sha: string): { green: boolean; passed: number; executed: string[]; tail: string } {
  const run = runAtCommit(view, sha, PIN_RUN);
  const [tap = '', lcov = ''] = run.output.split('@@LCOV');
  const executed = lcov
    .split('end_of_record')
    .filter((record) => Number(/^LH:(\d+)/m.exec(record)?.[1] ?? 0) > 0)
    .flatMap((record) => /^SF:(.+)$/m.exec(record)?.[1] ?? []);
  return { green: run.status === 0, passed: Number(/^# pass (\d+)/m.exec(tap)?.[1] ?? 0), executed, tail: tap.trim().split('\n').slice(-6).join(' | ') };
}

/** Existing source files a commit modifies or deletes: the code whose behavior a pin has to hold. */
function changedSource(view: RunView, sha: string): string[] {
  const listed = spawnSync('git', ['-C', view.repo, 'diff-tree', '--no-commit-id', '--name-status', '-r', '--root', sha], { encoding: 'utf8' });
  return listed.stdout
    .split('\n')
    .map((line) => line.split('\t'))
    .flatMap(([status, file]) => (file !== undefined && (status === 'M' || status === 'D') && !isTestFile(file) ? [file] : []));
}

/**
 * Refactoring step 1: before any structure moved, a pin existed and was green, shown by running it on the code that precedes each structural
 * commit. A pin the parent committed before the spawn, one the delegate committed first, or an existing test that already executes the code
 * all count; one focused delegate commit is valid. A commit that adds the characterization together with the structural change proves no
 * before-change pin. Each structural commit is judged on its own pin, so independent changes each need one, and a later commit may not edit
 * the pin commits. Only a delegate-less workflow, or one with no structural commit, has nothing to judge, and it fails by name.
 */
export function pinBeforeChange(view: RunView): Outcome {
  if (delegateOf(view) === undefined) return fail('no poteto worker in a worktree, so no delegate made a structural change to pin');
  const commits = workflowCommits(view);
  const structural = commits.filter((sha) => filesChanged(view, sha).some((file) => !isTestFile(file)));
  const first = structural[0];
  if (first === undefined) return fail(`${commits.length} workflow commit(s) and none changes production source: there is no structural change`);
  const short = (sha: string) => sha.slice(0, 8);
  const problems: string[] = [];
  const together = filesChanged(view, first).filter(isTestFile);
  if (together.length > 0) problems.push(`${short(first)} changes production source and ${together.join(', ')} in one commit, so no pin was shown green before the structure moved`);
  const pinFiles = commits.slice(0, commits.indexOf(first)).flatMap((sha) => filesChanged(view, sha));
  for (const sha of commits.slice(commits.indexOf(first) + 1)) {
    const edited = filesChanged(view, sha).filter((file) => pinFiles.includes(file));
    if (edited.length > 0) problems.push(`${short(sha)} edits the pin ${edited.join(', ')}`);
  }
  let unproven = 0;
  for (const sha of structural.filter((candidate) => candidate !== first || together.length === 0)) {
    const parent = spawnSync('git', ['-C', view.repo, 'rev-parse', `${sha}^`], { encoding: 'utf8' }).stdout.trim();
    if (parent === '') {
      problems.push(`${short(sha)} has no earlier code to have pinned`);
      continue;
    }
    const pin = pinAt(view, parent);
    if (!pin.green) problems.push(`the pin is red on the code before ${short(sha)}: ${pin.tail}`);
    else if (pin.passed < 1) problems.push(`no test ran on the code before ${short(sha)}, so nothing pinned it`);
    else {
      const missed = changedSource(view, sha).filter((file) => !pin.executed.some((seen) => seen === file || seen.endsWith(`/${file}`)));
      if (missed.length > 0 && pin.executed.length === 0) unproven += 1;
      else if (missed.length > 0) problems.push(`the ${pin.passed} passing test(s) before ${short(sha)} never execute ${missed.join(', ')}, which it changes`);
    }
  }
  if (problems.length > 0) return fail(problems.join('; '));
  if (unproven > 0) return { inconclusive: 'the pin passed but the test run reported no coverage, so it is not shown to execute the changed code' };
  return pass(`${structural.length} structural commit(s), each preceded by a green pin that executes the code it changes${pinFiles.length > 0 ? `; pin committed first: ${[...new Set(pinFiles)].join(', ')}` : '; an existing test served as the pin'}`);
}

/**
 * Every commit of the worker's branch, run on its own: each unit ends in a check that passes. A commit that only adds tests and fails is
 * the failing test first, the canonical shape of sequence-verifiable-units ("the failing test first, then the fix on top"), so it is
 * excused when a later commit makes the tests pass.
 */
export function everyCommitGreen(id: string, source: Src | Src[], runId: (view: RunView) => string, workerId: string | ((view: RunView) => string), options: { min: number; command?: string; commits?: (view: RunView) => string[] }): Check {
  return check(id, `the worker's branch holds at least ${options.min} commits and every one passes \`${options.command ?? 'node --test'}\` on its own, except a test-only commit that fails and is followed by a passing one`, source, (view) => {
    const commits = options.commits?.(view) ?? branchCommits(view, runId(view), typeof workerId === 'function' ? workerId(view) : workerId);
    const results = commits.map((sha) => ({ sha, ...runAtCommit(view, sha, options.command ?? 'node --test') }));
    const lastGreen = results.findLastIndex((result) => result.status === 0);
    const red = results.filter((result, index) => result.status !== 0 && !(index < lastGreen && filesChanged(view, result.sha).every(isTestFile)));
    return when(commits.length >= options.min && red.length === 0, `${commits.length} commits, all green: ${commits.map((sha) => sha.slice(0, 8)).join(', ')}`, `commits ${commits.length}, red at ${red.map((result) => `${result.sha.slice(0, 8)}: ${result.output.slice(-120)}`).join('; ')}`);
  });
}

/**
 * The parent's own writes stay out of production source: only .pi/pstack and the sandbox scratch. `allow` names the paths the playbook
 * has the parent write itself (the failing repro, the pin, the frozen benchmark): they are the parent's evidence, not production source.
 */
export function parentWritesOnlyScratch(id: string, title: string, source: Src | Src[], allow?: RegExp): Check {
  return checkAbsence(id, title, source, (view) => {
    const production = parentProductionWrites(view, allow);
    // A commit of only the files the playbook has the parent write (the frozen benchmark, the pin) is the parent's evidence, not production code.
    const own = commitsNotFromWorkers(view).filter((sha) => allow === undefined || filesChanged(view, sha).length === 0 || !filesChanged(view, sha).every((file) => allow.test(file)));
    return when(production.length === 0 && view.git.dirty.length === 0 && own.length === 0, 'the parent wrote nothing into production source, the main checkout is clean, and every commit on it is a worker\'s', `parent wrote ${production.join(', ') || 'nothing'}; dirty ${view.git.dirty.join(', ') || 'none'}; commits the parent made itself ${own.length}`);
  });
}

// ---- chat turns in the parent session

/** Orders of the user's own messages (a wake is a custom message, not a user turn). */
export const userTurns = (view: RunView): number[] => view.parent.messages.filter((message) => message.role === 'user').map((message) => message.order);

/** Tool calls the parent made between user turn `index` and the next one. */
export function callsInTurn(view: RunView, index: number): ToolCall[] {
  const turns = userTurns(view);
  const from = turns[index] ?? Number.POSITIVE_INFINITY;
  const to = turns[index + 1] ?? Number.POSITIVE_INFINITY;
  return view.parent.toolCalls.filter((call) => call.order > from && call.order < to);
}

export const userText = (view: RunView, index: number): string => view.parent.messages.filter((message) => message.role === 'user')[index]?.text ?? '';

/** The reply that ended user turn `index`. */
export function replyOfTurn(view: RunView, index: number): string {
  const turns = userTurns(view);
  const from = turns[index] ?? Number.POSITIVE_INFINITY;
  const to = turns[index + 1] ?? Number.POSITIVE_INFINITY;
  return [...view.parent.messages].reverse().find((message) => message.role === 'assistant' && message.order > from && message.order < to && message.text.trim() !== '' && !message.text.startsWith('waiting for worker ') && message.text !== '(script complete)')?.text.trim() ?? '';
}
