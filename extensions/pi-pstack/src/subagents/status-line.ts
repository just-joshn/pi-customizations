import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { ShellOptions, ShellResult } from './shell-command.ts';
import type { TaskSnapshot } from './task-snapshots.ts';

export type Decorations = Readonly<Record<string, string>>;
type HookBase = Readonly<{ session_id: string; transcript_path?: string; cwd: string }>;
export type StatusLineSources = Readonly<{
  tasks: () => readonly TaskSnapshot[];
  command: () => Promise<string | undefined>;
  trusted: () => boolean;
  enabled: () => boolean;
  columns: () => number;
  base: () => HookBase;
  run: (command: string, options: ShellOptions) => Promise<ShellResult>;
  log: (message: string) => void;
  apply: (decorations: Decorations) => void;
}>;

const firstPollMs = 300;
const pollIntervalMs = 5000;
const commandTimeoutMs = 5000;
const maxTokenSamples = 16;
const DecorationSchema = Type.Object({ id: Type.String(), content: Type.String() });

function parseDecorations(stdout: string, log: (message: string) => void): Record<string, string> {
  const entries = stdout.split('\n').flatMap((line): [string, string][] => {
    if (!line.trim()) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      log(`subagentStatusLine emitted non-JSON line: ${line}`);
      return [];
    }
    if (Value.Check(DecorationSchema, parsed)) return [[parsed.id, parsed.content]];
    const error = Value.Errors(DecorationSchema, parsed)[0];
    log(`subagentStatusLine emitted invalid schema: ${error ? `${error.instancePath || '/'} ${error.message}` : 'invalid value'}`);
    return [];
  });
  return Object.fromEntries(entries);
}

export class StatusLinePoller {
  private readonly sources: StatusLineSources;
  private readonly samples = new Map<string, number[]>();
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private busy = false;

  constructor(sources: StatusLineSources) {
    this.sources = sources;
  }

  start(): void {
    this.stop();
    this.timers.push(setTimeout(() => void this.tick(), firstPollMs));
    const repeat = () => {
      void this.tick();
      this.timers.splice(0, this.timers.length, setTimeout(repeat, pollIntervalMs));
    };
    this.timers.push(setTimeout(repeat, pollIntervalMs));
  }

  stop(): void {
    for (const timer of this.timers.splice(0)) clearTimeout(timer);
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    const tasks = this.sources.tasks();
    this.recordSamples(tasks);
    if (!tasks.length) {
      this.sources.apply({});
      return;
    }
    this.busy = true;
    try {
      const decorations = await this.decorate(tasks);
      const live = new Set(tasks.map((task) => task.id));
      this.sources.apply(Object.fromEntries(Object.entries(decorations).filter(([id]) => live.has(id))));
    } catch (error) {
      this.sources.log(`subagentStatusLine tick failed: ${String(error)}`);
    } finally {
      this.busy = false;
    }
  }

  private recordSamples(tasks: readonly TaskSnapshot[]): void {
    const live = new Set(tasks.map((task) => task.id));
    for (const id of this.samples.keys()) if (!live.has(id)) this.samples.delete(id);
    for (const task of tasks) this.samples.set(task.id, [...(this.samples.get(task.id) ?? []), task.tokenCount].slice(-maxTokenSamples));
  }

  private async decorate(tasks: readonly TaskSnapshot[]): Promise<Record<string, string>> {
    if (!this.sources.enabled()) return {};
    if (!this.sources.trusted()) {
      this.sources.log('Skipping subagentStatusLine execution - workspace trust not accepted');
      return {};
    }
    const command = await this.sources.command();
    if (command === undefined) return {};
    const base = this.sources.base();
    const input = JSON.stringify({ ...base, columns: this.sources.columns(), tasks: tasks.map((task) => this.taskInput(task)) });
    const result = await this.sources.run(command, { cwd: base.cwd, input, env: { ...process.env, CLAUDE_PROJECT_DIR: base.cwd }, timeoutMs: commandTimeoutMs });
    if (result.code !== 0) {
      this.sources.log(`subagentStatusLine exited ${result.code}: ${result.stderr}`);
      return {};
    }
    return parseDecorations(result.stdout, this.sources.log);
  }

  private taskInput({ agentType: _agentType, ...task }: TaskSnapshot) {
    return { ...task, label: task.description, tokenSamples: this.samples.get(task.id) ?? [] };
  }
}
