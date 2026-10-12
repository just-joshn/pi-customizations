// Drives the real Pi CLI against an isolated agent directory that loads this package and the scripted test model.
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PACKAGE_ROOT } from '../../src/paths.ts';

const PI_CLI = join(PACKAGE_ROOT, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const SCRIPTED_MODEL = join(PACKAGE_ROOT, 'test/fixtures/scripted-model.ts');
// PSTACK_TWO_E2E_PI=<pi executable> runs the suite against an installed Pi, such as the user's launcher, instead of the dev dependency.
const INSTALLED_PI = process.env['PSTACK_TWO_E2E_PI'];

/** The command and argv that run Pi with these arguments. */
export function piInvocation(args: readonly string[]): [string, string[]] {
  return INSTALLED_PI === undefined || INSTALLED_PI === '' ? [process.execPath, [PI_CLI, ...args]] : [INSTALLED_PI, [...args]];
}

export interface Sandbox {
  root: string;
  agentDir: string;
  workDir: string;
  env: Record<string, string>;
  dispose: () => void;
}

export type PiEvent = { type: string } & Record<string, unknown>;

export interface RunResult {
  events: PiEvent[];
  exitCode: number | null;
  stderr: string;
}

export function makeSandbox(settings: Record<string, unknown> = {}): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-pstack-two-e2e-')));
  const agentDir = join(root, 'agent');
  const workDir = join(root, 'work');
  mkdirSync(agentDir);
  mkdirSync(workDir);
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: [PACKAGE_ROOT], extensions: [SCRIPTED_MODEL], quietStartup: true, ...settings }));
  // HOME moves too, so user-level resources such as ~/.agents/skills stay out of the run.
  const env = { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' } as Record<string, string>;
  // Variables that would point a run at the user's real state, or give the parent a subagent identity.
  for (const name of ['PI_CODING_AGENT_SESSION_DIR', 'PI_PSTACK_TWO_DEPTH', 'PI_PSTACK_TWO_AGENT', 'PI_PSTACK_TWO_PARENT_PID']) delete env[name];
  return { root, agentDir, workDir, env, dispose: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) };
}

/** Splits a byte stream on LF only, as Pi's JSONL framing requires. */
export function lineSplitter(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line.trim() !== '') onLine(line);
      index = buffer.indexOf('\n');
    }
  };
}

export function runJson(sandbox: Sandbox, prompts: string | string[], args: string[] = [], timeoutMs = 45_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(...piInvocation(['--mode', 'json', '--offline', '--model', 'scripted/echo', ...args, ...[prompts].flat()]), { cwd: sandbox.workDir, env: sandbox.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const events: PiEvent[] = [];
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`pi --mode json timed out after ${timeoutMs}ms\n${stderr}`));
    }, timeoutMs);
    child.stdout.on(
      'data',
      lineSplitter((line) => events.push(JSON.parse(line) as PiEvent)),
    );
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ events, exitCode, stderr });
    });
  });
}

type Content = string | { type: string; text?: string }[];
export interface EventMessage {
  role: string;
  content: Content;
  customType?: string;
  toolName?: string;
  isError?: boolean;
  details?: unknown;
  usage?: { totalTokens: number };
}

export const contentText = (content: Content): string => (typeof content === 'string' ? content : content.map((part) => part.text ?? '').join(''));

export function messages(events: PiEvent[], role?: string): EventMessage[] {
  return events
    .filter((event) => event.type === 'message_end')
    .map((event) => event['message'] as EventMessage)
    .filter((message) => role === undefined || message.role === role);
}

export const assistantTexts = (events: PiEvent[]): string[] => messages(events, 'assistant').map((message) => contentText(message.content));

export interface ToolEnd {
  toolName: string;
  isError: boolean;
  text: string;
  details: unknown;
  usage?: { totalTokens: number };
}

export function toolEnds(events: PiEvent[], toolName: string): ToolEnd[] {
  return events
    .filter((event) => event.type === 'tool_execution_end' && event['toolName'] === toolName)
    .map((event) => {
      const result = event['result'] as { content: Content; details: unknown; usage?: { totalTokens: number } };
      return { toolName, isError: event['isError'] === true, text: contentText(result.content), details: result.details, ...(result.usage === undefined ? {} : { usage: result.usage }) };
    });
}

/** Pi reads a positional argument that starts with @ as a file, so the directive goes on the second line. */
export const script = (steps: unknown[]): string => `run the script\n@@script ${JSON.stringify(steps)}`;

export interface RpcSession {
  child: ChildProcess;
  events: PiEvent[];
  send: (command: Record<string, unknown>) => void;
  waitFor: (predicate: (event: PiEvent) => boolean, timeoutMs?: number) => Promise<PiEvent>;
  close: () => Promise<void>;
}

export function startRpc(sandbox: Sandbox, args: string[] = []): RpcSession {
  const child = spawn(...piInvocation(['--mode', 'rpc', '--offline', '--model', 'scripted/echo', ...args]), { cwd: sandbox.workDir, env: sandbox.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const events: PiEvent[] = [];
  const waiters: { predicate: (event: PiEvent) => boolean; resolve: (event: PiEvent) => void }[] = [];
  child.stdout?.on(
    'data',
    lineSplitter((line) => {
      const event = JSON.parse(line) as PiEvent;
      events.push(event);
      for (const waiter of waiters.filter((candidate) => candidate.predicate(event))) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }),
  );
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const waitFor = (predicate: (event: PiEvent) => boolean, timeoutMs = 30_000) =>
    new Promise<PiEvent>((resolve, reject) => {
      const seen = events.find(predicate);
      if (seen) return resolve(seen);
      const timer = setTimeout(() => reject(new Error(`timed out waiting for an RPC event\n${stderr}`)), timeoutMs);
      waiters.push({
        predicate,
        resolve: (event) => {
          clearTimeout(timer);
          resolve(event);
        },
      });
    });
  const send = (command: Record<string, unknown>) => child.stdin?.write(`${JSON.stringify(command)}\n`);
  const close = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('close', () => resolve());
      child.stdin?.end();
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    });
  return { child, events, send, waitFor, close };
}
