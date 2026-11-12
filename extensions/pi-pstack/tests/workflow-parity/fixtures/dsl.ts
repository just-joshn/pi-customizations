// Builders for scripted scenarios. A scenario is what a model that follows the skill would do, written as tool calls.
import { join } from 'node:path';

import { playbookSource } from '../lib/checks.ts';
import type { Ctx } from '../lib/driver.ts';

type Args = Record<string, unknown>;

/** Single-quotes text for sh, so `$(...)` and backticks inside it stay text. */
export const shQuote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;

export class Actor {
  readonly steps: unknown[] = [];
  call(tool: string, args: Args): this {
    this.steps.push({ tool, args });
    return this;
  }
  /** Several tool calls in one assistant message. */
  together(...calls: { tool: string; args: Args }[]): this {
    this.steps.push(calls);
    return this;
  }
  read(path: string): this {
    return this.call('read', { path });
  }
  bash(command: string): this {
    return this.call('bash', { command });
  }
  write(path: string, content: string): this {
    return this.call('write', { path, content });
  }
  edit(path: string, oldText: string, newText: string): this {
    return this.call('edit', { path, edits: [{ oldText, newText }] });
  }
  /** Says something and calls tools in the same assistant message. */
  say(text: string, ...calls: { tool: string; args: Args }[]): this {
    this.steps.push({ say: text, calls });
    return this;
  }
  text(text: string): this {
    this.steps.push({ text });
    return this;
  }
  wait(workerId: string, count = 1): this {
    this.steps.push({ await: { wake: workerId, count } });
    return this;
  }
}

export interface AssignmentFields {
  role: string;
  model: string;
  workspace: Args;
  kind?: 'pi' | 'watch';
  thinkingLevel?: string | null;
  skills?: string[];
  capabilities?: Args;
  watch?: Args;
}

export interface ProofOptions {
  /** Takes the receipt's commit from this checkout's HEAD when the command has run. */
  gitDir?: string;
  /** Overrides the verdict the exit status implies, for a check whose pass means a defect reproduced. */
  verdict?: 'pass' | 'fail' | 'inconclusive';
  reason?: string;
  id: string;
  target: string;
  /** Shell command run in `cwd`; its output is the artifact and its exit status the verdict. */
  command: string;
  cwd?: string;
  kind?: 'test' | 'command' | 'screenshot' | 'trace' | 'review' | 'measurement' | 'other';
  commit?: string;
  /** Where the receipt and artifact go. Defaults to the run's verification directory. */
  dir?: string;
}

export class Parent extends Actor {
  readonly ctx: Ctx;
  readonly runDir: string;
  constructor(ctx: Ctx) {
    super();
    this.ctx = ctx;
    this.runDir = join(ctx.repo, '.pi', 'pstack', 'runs', ctx.runId);
  }
  readSkill(name: string): this {
    return this.read(this.ctx.skill(name));
  }
  readReference(skill: string, file: string): this {
    return this.read(join(this.ctx.pkg, 'generated', 'skills', skill, 'references', file));
  }
  readPlaybook(name: string): this {
    return this.read(this.ctx.playbook(name));
  }
  /** Reads poteto-mode and the playbook, then starts the run, as poteto-mode's Playbooks section directs. */
  beginPlaybook(playbook: string, title: string): this {
    return this.readSkill('poteto-mode')
      .readPlaybook(playbook)
      .bash(`node ${join(this.ctx.pkg, 'scripts', 'start-run.mjs')} --playbook ${playbook} --title ${JSON.stringify(title)} --run-id ${this.ctx.runId}`);
  }
  stepLine(playbook: string, n: number): string {
    return (playbookSource(playbook)[n - 1] as string).split('\n')[0] as string;
  }
  private todo(): string {
    return join(this.runDir, 'TODO.md');
  }
  done(playbook: string, n: number, ...receipts: string[]): this {
    const line = this.stepLine(playbook, n);
    return this.edit(this.todo(), `- [ ] ${line}`, `- [x] ${line} (evidence: ${receipts.join(', ')})`);
  }
  skip(playbook: string, n: number, reason: string): this {
    const line = this.stepLine(playbook, n);
    return this.edit(this.todo(), `- [ ] ${line}`, `- [~] ${line} (skip: ${reason})`);
  }
  /** Appends a task-specific item under `## Task-specific work`. */
  task(text: string): this {
    return this.bash(`printf '%s\\n' ${shQuote(`- [ ] ${text}`)} >> ${JSON.stringify(this.todo())}`);
  }
  /** Writes brief.md and assignment.json and returns the spawn call, so several spawns can go out in one message. */
  stage(workerId: string, fields: AssignmentFields, brief: string): { tool: string; args: Args } {
    const runId = this.ctx.runId;
    const dir = join(this.ctx.repo, '.pi', 'pstack', 'runs', runId, 'workers', workerId);
    const assignment: Args = { schemaVersion: 1, runId, workerId, kind: fields.kind ?? 'pi', role: fields.role, model: fields.model, thinkingLevel: fields.thinkingLevel ?? null, workspace: fields.workspace, skills: fields.skills ?? [] };
    if ((fields.kind ?? 'pi') === 'pi') assignment['brief'] = 'brief.md';
    if (fields.capabilities !== undefined) assignment['capabilities'] = fields.capabilities;
    if (fields.watch !== undefined) assignment['watch'] = fields.watch;
    if ((fields.kind ?? 'pi') === 'pi') this.write(join(dir, 'brief.md'), brief);
    this.write(join(dir, 'assignment.json'), `${JSON.stringify(assignment, null, 2)}\n`);
    return { tool: 'pstack_worker', args: { action: 'spawn', runId, assignmentPath: join(dir, 'assignment.json') } };
  }
  spawn(workerId: string, fields: AssignmentFields, brief: string): this {
    return this.together(this.stage(workerId, fields, brief));
  }
  /** Spawns every staged worker in one assistant message. */
  fire(...calls: { tool: string; args: Args }[]): this {
    return this.together(...calls);
  }
  collect(...workerIds: string[]): this {
    return this.together(...workerIds.map((workerId) => ({ tool: 'pstack_worker', args: { action: 'collect', runId: this.ctx.runId, workerId } })));
  }
  worktreePath(workerId: string): string {
    return join(this.runDir, 'workers', workerId, 'worktree');
  }
  workerDir(workerId: string): string {
    return join(this.runDir, 'workers', workerId);
  }
  readonly(path = this.ctx.repo): Args {
    return { mode: 'readonly', path };
  }
  worktree(inputCommit = this.ctx.base): Args {
    return { mode: 'worktree', inputCommit };
  }
  /** Runs a command, keeps its output as the artifact, writes a receipt from its exit status, and records it. */
  proof(options: ProofOptions): this {
    return proofSteps(this, this.ctx, options, join(this.runDir, 'verification', 'artifacts'));
  }
  /** Appends a decision row with the package's own show-me-your-work helper. */
  decision(phase: string, decision: string, why: string, evidence: string, result: string, file = join(this.runDir, 'decisions.tsv')): this {
    const script = join(this.ctx.pkg, 'generated', 'skills', 'show-me-your-work', 'scripts', 'log.sh');
    return this.bash(['bash', script, JSON.stringify(file), ...[phase, decision, why, evidence, result].map((cell) => JSON.stringify(cell))].join(' '));
  }
}

/** A worker script. Its steps run in the worker's own Pi process, so every path is absolute. */
export class Worker extends Actor {}

export function scenario(parent: Parent, workers: Record<string, Worker> = {}): { actors: Record<string, unknown[]> } {
  return { actors: { parent: parent.steps, ...Object.fromEntries(Object.entries(workers).map(([id, worker]) => [id, worker.steps])) } };
}

/** The steps that run a command, hash its output, write a receipt, and record it with pstack_evidence. */
export function proofSteps<T extends Actor>(actor: T, ctx: Ctx, options: ProofOptions, defaultDir: string): T {
  const dir = options.dir ?? defaultDir;
  const artifact = join(dir, `${options.id}.txt`);
  const receipt = join(dir, `${options.id}.receipt.json`);
  const helper = join(ctx.pkg, 'tests', 'workflow-parity', 'fixtures', 'receipt.mjs');
  const script = [
    `mkdir -p ${JSON.stringify(dir)}`,
    `cd ${JSON.stringify(options.cwd ?? ctx.repo)}`,
    `( ${options.command} ) > ${JSON.stringify(artifact)} 2>&1; code=$?`,
    `node ${JSON.stringify(helper)} --out ${JSON.stringify(receipt)} --run-id ${ctx.runId} --id ${options.id} --target ${JSON.stringify(options.target)} --kind ${options.kind ?? 'command'} ${options.commit === undefined ? '' : `--commit ${options.commit}`} ${options.gitDir === undefined ? '' : `--git ${JSON.stringify(options.gitDir)}`} ${options.verdict === undefined ? '' : `--verdict ${options.verdict}`} ${options.reason === undefined ? '' : `--reason ${JSON.stringify(options.reason)}`} --exit $code --cmd ${shQuote(options.command)} --artifact ${JSON.stringify(artifact)}`,
    'exit 0',
  ].join('\n');
  actor.bash(script);
  actor.call('pstack_evidence', { action: 'record', runId: ctx.runId, receiptPath: receipt });
  return actor;
}
