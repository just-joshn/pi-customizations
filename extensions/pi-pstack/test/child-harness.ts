import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, onTestFinished } from 'vitest';
import { type ChildHost, type ChildKind, type ChildLaunch, ChildTask } from '../src/subagents/child-task.ts';
import type { PiCommand } from '../src/subagents/pi-command.ts';
import { RpcChild } from '../src/subagents/rpc-child.ts';
import type { TaskRecord } from '../src/worker-records.ts';

export const fakePi: PiCommand = { command: process.execPath, args: [fileURLToPath(new URL('./fixtures/fake-pi.mjs', import.meta.url))] };

export type Workspace = Readonly<{ dir: string; logFile: string; outputFile: string }>;
export type Settlement = Readonly<{ record: TaskRecord; output: string; send: boolean; parentIdle: boolean }>;

export const test = base.extend<{ workspace: Workspace }>({
  workspace: async ({ onTestFinished }, use) => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'pstack-child-')));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    await mkdir(join(dir, 'work'));
    await use({ dir: join(dir, 'work'), logFile: join(dir, 'commands.jsonl'), outputFile: join(dir, 'output.txt') });
  },
});

export function spawnEnv(workspace: Workspace, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, FAKE_PI_LOG: workspace.logFile, ...extra };
}

export function rpcChild(workspace: Workspace, extra: NodeJS.ProcessEnv = {}, args: readonly string[] = []): RpcChild {
  const child = RpcChild.start({ command: fakePi, args, cwd: workspace.dir, env: spawnEnv(workspace, extra) });
  onTestFinished(async () => {
    child.kill('SIGKILL');
    await child.closed;
  });
  return child;
}

export function taskRecord(workspace: Workspace, id: string): TaskRecord {
  return { id, persona: 'general', cwd: workspace.dir, readonly: false, sessionFile: '', outputFile: workspace.outputFile, status: 'running', output: '' };
}

export class FakeHost implements ChildHost {
  readonly records = new Map<string, TaskRecord>();
  readonly commits: TaskRecord[] = [];
  readonly settlements: Settlement[] = [];

  commit = (record: TaskRecord): void => {
    this.commits.push(record);
    this.records.set(record.id, record);
  };

  settle: ChildHost['settle'] = (record, output, notify) => {
    this.settlements.push({ record, output, send: notify.send, parentIdle: notify.parentIdle() });
    this.records.set(record.id, record);
  };

  current: ChildHost['current'] = (id) => this.records.get(id);
}

export type PermissionLog = { readonly asks: { title: string; body: string }[]; answer: boolean };

export type LaunchOptions = Readonly<{ id?: string; kind?: ChildKind; env?: NodeJS.ProcessEnv; log?: PermissionLog; cleanup?: ChildLaunch['cleanup']; closePane?: ChildLaunch['closePane'] }>;

export function permissionLog(answer = true): PermissionLog {
  return { asks: [], answer };
}

export function childLaunch(workspace: Workspace, options: LaunchOptions = {}): ChildLaunch {
  const log = options.log ?? permissionLog();
  return {
    kind: options.kind ?? 'remote',
    record: taskRecord(workspace, options.id ?? 'task-1'),
    placement: { team: 'crew' },
    start: { command: fakePi, args: [], cwd: workspace.dir, env: spawnEnv(workspace, options.env) },
    permission: {
      label: 'worker',
      allowedToolNames: new Set(['bash']),
      ask: async (title, body) => {
        log.asks.push({ title, body });
        return log.answer;
      },
    },
    parentIdle: () => true,
    ...(options.cleanup ? { cleanup: options.cleanup } : {}),
    ...(options.closePane ? { closePane: options.closePane } : {}),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loggedCommands(workspace: Workspace): Promise<readonly Record<string, unknown>[]> {
  const text = await readFile(workspace.logFile, 'utf8').catch(() => '');
  return text.split('\n').flatMap((line) => {
    if (!line) return [];
    const parsed: unknown = JSON.parse(line);
    return isObject(parsed) ? [parsed] : [];
  });
}

export function newTask(workspace: Workspace, options: LaunchOptions = {}): { task: ChildTask; host: FakeHost } {
  const host = new FakeHost();
  const task = new ChildTask(childLaunch(workspace, options), host);
  onTestFinished(async () => {
    await task.stop();
  });
  return { task, host };
}
