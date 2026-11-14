// Pieces several families share: a writable worker script, TODO phase items, and small file fixtures.
import { join } from 'node:path';

import { type Parent, proofSteps, shQuote, Worker } from '../fixtures/dsl.ts';
import { type Check, check, fail, pass, src, when, type Src } from '../lib/check.ts';
import { finalReply, FAMILY_OF } from '../lib/checks.ts';
import { corruptArtifact, deleteReceipt, deleteStep, type Negative, reorderHistory, setStep, stripEvidence } from '../lib/mutate.ts';
import type { RunDir, RunView } from '../lib/view.ts';

export const worktreeOf = (parent: Parent, id: string) => join(parent.workerDir(id), 'worktree');

export interface Unit {
  files: Record<string, string>;
  commit: string;
}

export interface WriterOptions {
  /** One commit per unit, in order. */
  units: Unit[];
  /** Shell command run in the worktree after the last commit; its output and exit status become the worker's receipt. */
  test?: string;
  report: string;
  /** Shell commands run in the worktree before the files are written. */
  before?: string[];
  testKind?: 'test' | 'command' | 'measurement';
  receiptId?: string;
}

const COMMIT = (message: string) => `git add -A && git -c user.name=worker -c user.email=w@example.com commit -q -m ${JSON.stringify(message)}`;

/** A writable worker: units of files in its own worktree, one commit each, a receipt for its check, report.md, and a final reply. */
export function writer(parent: Parent, id: string, options: WriterOptions): Worker {
  const worker = new Worker();
  const tree = worktreeOf(parent, id);
  for (const command of options.before ?? []) worker.bash(`cd ${JSON.stringify(tree)} && ${command}`);
  for (const unit of options.units) {
    for (const [path, content] of Object.entries(unit.files)) worker.write(join(tree, path), content);
    worker.bash(`cd ${JSON.stringify(tree)} && ${COMMIT(unit.commit)}`);
  }
  if (options.test !== undefined) proofSteps(worker, parent.ctx, { id: options.receiptId ?? `${id}-check`, target: id, command: options.test, cwd: tree, kind: options.testKind ?? 'test', gitDir: tree, dir: join(parent.workerDir(id), 'evidence') }, join(parent.workerDir(id), 'evidence'));
  worker.write(join(parent.workerDir(id), 'report.md'), options.report);
  return worker.text(options.report);
}

/** The one-commit writer most families use. */
export const writes = (parent: Parent, id: string, files: Record<string, string>, commit: string, rest: Omit<WriterOptions, 'units'>): Worker => writer(parent, id, { units: [{ files, commit }], ...rest });

/** Task-specific TODO items, one per phase, appended before anything launches. */
export function phaseItems(parent: Parent, phases: string[]): Parent {
  for (const phase of phases) parent.task(phase);
  return parent;
}

export function markPhase(parent: Parent, phase: string): Parent {
  return parent.bash(`node ${shQuote(join(parent.ctx.pkg, 'scripts/start-run.mjs'))} --run-id ${parent.ctx.runId} --task ${shQuote(phase)} --task-status passed`);
}

/** Task-specific items of the run's TODO.md. */
export function taskItems(run: RunDir | undefined): { state: string; text: string }[] {
  const text = run?.todoText ?? '';
  const section = text.split('## Task-specific work')[1] ?? '';
  return section
    .split('\n')
    .map((line) => /^- \[(.)\] (.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ state: match[1] as string, text: match[2] as string }));
}

/**
 * One TODO entry per phase, in order, written before the first worker is claimed.
 * "Before launching anything" is judged on the driver's one observation sequence: the first TODO.md that holds every
 * phase must precede the first claim directory.
 */
export function phasesBeforeLaunch(id: string, source: Src | Src[], phasesAsWritten: RegExp[], options: { allResolved?: boolean } = {}): Check {
  // A phase named "Fan out" is a TODO entry however it is written: "Fan out", "fan-out", "arena-fan-out" (the skill gives the phase names, not their spelling).
  const phases = phasesAsWritten.map((phase) => ({ source: phase.source, test: (text: string) => new RegExp(phase.source.replaceAll('-', ' '), 'i').test(text.replace(/[-_]+/g, ' ')) }));
  return check(id, `TODO.md lists one entry per phase (${phases.map((phase) => phase.source).join(', ')}) in order, before the first worker is spawned${options.allResolved === true ? ', and each ends resolved' : ''}`, source, (view: RunView) => {
    const run = view.runs[0];
    const items = taskItems(run);
    const positions = phases.map((phase) => items.findIndex((item) => phase.test(item.text)));
    if (positions.includes(-1)) return fail(`phases with no TODO entry: ${phases.filter((_, index) => positions[index] === -1).map((phase) => phase.source).join(', ')}; items: ${items.map((item) => item.text).join(' | ')}`);
    if (positions.some((position, index) => index > 0 && position < (positions[index - 1] as number))) return fail(`phase entries are out of order: ${positions.join(',')}`);
    const history = view.todoHistory[run?.id ?? ''] ?? [];
    const first = history.find((snapshot) => phases.every((phase) => snapshot.text.split('## Task-specific work')[1]?.split('\n').some((line) => /^- \[.\] /.test(line) && phase.test(line))));
    const claim = Math.min(...view.claims.map((entry) => entry.seq));
    if (first === undefined) return fail('the driver never saw a TODO.md holding every phase');
    if (Number.isFinite(claim) && first.seq > claim) return fail(`the phases appeared (seq ${first.seq}) after the first worker claim (seq ${claim})`);
    if (options.allResolved === true) {
      const open = items.filter((_, index) => positions.includes(index) && items[index]?.state === ' ');
      if (open.length > 0) return fail(`unresolved phases: ${open.map((item) => item.text).join(', ')}`);
    }
    return pass(`${phases.length} phase entries in order, first seen at seq ${first.seq} before claim seq ${Number.isFinite(claim) ? claim : 'none'}`);
  });
}

export const familiesOf = (models: string[]): Set<string> => new Set(models.map(FAMILY_OF));

export function replyHas(id: string, title: string, source: Src | Src[], patterns: { name: string; pattern: RegExp }[]): Check {
  return check(id, title, source, (view: RunView) => {
    const reply = finalReply(view);
    const missing = patterns.filter(({ pattern }) => !pattern.test(reply)).map(({ name }) => name);
    return when(missing.length === 0, `reply has ${patterns.map(({ name }) => name).join(', ')}`, `reply lacks ${missing.join(', ')}; reply starts: ${reply.slice(0, 100)}`);
  });
}

export { src };

/** The generic ways a run can break the TODO.md contract, for a run whose steps `done` ended done with the receipts `receipts` cite. */
export function todoNegatives(runId: string, playbook: string, options: { done: number[]; receipts: Record<number, string>; evidenceOf?: (n: number) => string }): Negative[] {
  const [first = 1, second = 2] = options.done;
  const last = options.done.at(-1) as number;
  const prefix = `todo.${playbook}`;
  return [
    { name: 'a step was left open', mutate: (sandbox) => setStep(sandbox, runId, first, 'pending', stripEvidence), fails: [`${prefix}.every-step-resolved`] },
    { name: 'a step is done with no receipt id', mutate: (sandbox) => setStep(sandbox, runId, second, 'passed', stripEvidence), fails: [`${prefix}.done-steps-proven`] },
    { name: 'a step cites a receipt that was never recorded', mutate: (sandbox) => deleteReceipt(sandbox, runId, options.receipts[last] as string), fails: [`${prefix}.done-steps-proven`] },
    { name: 'the artifact changed after the receipt hashed it', mutate: (sandbox) => corruptArtifact(sandbox, runId, options.receipts[second] as string), fails: [`${prefix}.done-steps-proven`] },
    { name: 'a step was skipped with no reason', mutate: (sandbox) => setStep(sandbox, runId, first, 'skipped', stripEvidence), fails: [`${prefix}.skips-explained`] },
    { name: 'steps were resolved out of order', mutate: (sandbox) => reorderHistory(sandbox, runId, last), fails: [`${prefix}.resolved-in-order`] },
    { name: 'a playbook step was deleted from TODO.md', mutate: (sandbox) => deleteStep(sandbox, runId, second), fails: [`${prefix}.steps-verbatim-in-order`] },
  ];
}
