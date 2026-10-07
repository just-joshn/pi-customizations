import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import { CrewMessageEnd, TextPart } from './schemas.ts';

export const CREW = ['investigator', 'builder', 'reviewer'] as const;
export type CrewRole = (typeof CREW)[number];

export const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));

const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls', 'bash'];
const ROLE_TOOLS: Readonly<Record<CrewRole, readonly string[]>> = {
  investigator: READ_ONLY_TOOLS,
  reviewer: READ_ONLY_TOOLS,
  builder: ['read', 'edit', 'write', 'bash', 'grep', 'find', 'ls'],
};
const MODEL_ENV: Readonly<Record<CrewRole, string>> = {
  investigator: 'CAVECREW_INVESTIGATOR_MODEL',
  builder: 'CAVECREW_BUILDER_MODEL',
  reviewer: 'CAVECREW_REVIEWER_MODEL',
};
const MAX_OUTPUT_CHARS = 50_000;
const KILL_GRACE_MS = 5000;

export interface CrewUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly total: number };
}

export interface CrewRun {
  readonly role: CrewRole;
  readonly model: string | null;
  readonly exitCode: number;
  readonly output: string;
  readonly stderr: string;
  readonly turns: number;
  readonly usage: CrewUsage;
}

export function agentPrompt(role: CrewRole, agentsDir: string = AGENTS_DIR): string {
  return readFileSync(join(agentsDir, `cavecrew-${role}.md`), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
}

export function crewModel(role: CrewRole, env: NodeJS.ProcessEnv, parentModel: string | null): string | null {
  const override = env[MODEL_ENV[role]]?.trim();
  return override && !/\p{Cc}/u.test(override) ? override : parentModel;
}

export function crewArgs(args: { role: CrewRole; model: string | null; promptFile: string; task: string }): string[] {
  const argv = ['--mode', 'json', '-p', '--no-session', '--tools', ROLE_TOOLS[args.role].join(',')];
  if (args.model) argv.push('--model', args.model);
  argv.push('--append-system-prompt', args.promptFile, `Task: ${args.task}`);
  return argv;
}

export function piInvocation(args: string[]): { command: string; args: string[] } {
  const script = process.argv[1];
  if (script && !script.startsWith('/$bunfs/') && existsSync(script)) return { command: process.execPath, args: [script, ...args] };
  return /^(node|bun)(\.exe)?$/i.test(basename(process.execPath)) ? { command: 'pi', args } : { command: process.execPath, args };
}

const emptyUsage = (): CrewUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

type CrewUsageInput = NonNullable<Static<typeof CrewMessageEnd>['message']['usage']>;

export interface CrewProgress {
  readonly usage: CrewUsage;
  readonly turns: number;
  readonly output: string;
}

function assistantText(content: readonly unknown[] | undefined): string {
  return (content ?? []).flatMap((part) => (Check(TextPart, part) ? [part.text] : [])).join('');
}

function addUsage(total: CrewUsage, usage: CrewUsageInput | undefined): CrewUsage {
  const cost = usage?.cost;
  return {
    input: total.input + (usage?.input ?? 0),
    output: total.output + (usage?.output ?? 0),
    cacheRead: total.cacheRead + (usage?.cacheRead ?? 0),
    cacheWrite: total.cacheWrite + (usage?.cacheWrite ?? 0),
    totalTokens: total.totalTokens + (usage?.totalTokens ?? 0),
    cost: {
      input: total.cost.input + (cost?.input ?? 0),
      output: total.cost.output + (cost?.output ?? 0),
      cacheRead: total.cost.cacheRead + (cost?.cacheRead ?? 0),
      cacheWrite: total.cost.cacheWrite + (cost?.cacheWrite ?? 0),
      total: total.cost.total + (cost?.total ?? 0),
    },
  };
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    // Non-JSON stdout from the child carries no assistant message.
    return null;
  }
}

export function accumulate(run: CrewProgress, line: string): CrewProgress {
  const event = parseLine(line);
  if (!Check(CrewMessageEnd, event)) return run;
  const text = assistantText(event.message.content);
  return { usage: addUsage(run.usage, event.message.usage), turns: run.turns + 1, output: text || run.output };
}

function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process group is already gone or unsupported; fall back to the direct child.
    child.kill(signal);
  }
}

export function collect(args: { command: string; argv: string[]; cwd: string; signal: AbortSignal | undefined }): Promise<{ exitCode: number; run: CrewProgress; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(args.command, args.argv, {
      cwd: args.cwd,
      env: { ...process.env, CAVEMAN_DEFAULT_MODE: 'ultracave' },
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let run: CrewProgress = { usage: emptyUsage(), turns: 0, output: '' };
    let stderr = '';
    let buffer = '';
    let killTimer: NodeJS.Timeout | undefined;
    const abort = (): void => {
      killTree(child, 'SIGTERM');
      killTimer = setTimeout(() => killTree(child, 'SIGKILL'), KILL_GRACE_MS);
    };
    args.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const lines = (buffer + chunk).split('\n');
      buffer = lines.pop() ?? '';
      run = lines.reduce(accumulate, run);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      args.signal?.removeEventListener('abort', abort);
      clearTimeout(killTimer);
      resolve({ exitCode: code ?? 1, run: buffer.trim() ? accumulate(run, buffer) : run, stderr });
    });
  });
}

export async function runCrew(args: { role: CrewRole; task: string; cwd: string; model: string | null; signal: AbortSignal | undefined }): Promise<CrewRun> {
  if (args.signal?.aborted) throw new Error(`cavecrew-${args.role} aborted`);
  const dir = mkdtempSync(join(tmpdir(), 'cavecrew-'));
  const promptFile = join(dir, `cavecrew-${args.role}.md`);
  try {
    writeFileSync(promptFile, agentPrompt(args.role), { mode: 0o600 });
    const invocation = piInvocation(crewArgs({ role: args.role, model: args.model, promptFile, task: args.task }));
    const { exitCode, run, stderr } = await collect({ command: invocation.command, argv: invocation.args, cwd: args.cwd, signal: args.signal });
    if (args.signal?.aborted) throw new Error(`cavecrew-${args.role} aborted`);
    const output = run.output.length > MAX_OUTPUT_CHARS ? `${run.output.slice(0, MAX_OUTPUT_CHARS)}\n[truncated]` : run.output;
    return { role: args.role, model: args.model, exitCode, output, stderr: stderr.slice(-4000), turns: run.turns, usage: run.usage };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
