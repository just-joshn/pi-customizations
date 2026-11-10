import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { containerState, docker } from '../src/cloud/docker.ts';
import { type ContainerMachine, releaseMachine } from '../src/cloud/machine.ts';
import { machinesDir, subagentDir } from '../src/paths.ts';
import { GENERAL_PURPOSE } from '../src/task/agents.ts';
import { type AgentRecord, acquireRunLock, writeRecord } from '../src/task/records.ts';
import { prepareFork, registerTask } from '../src/task/tool.ts';

vi.mock(import('../src/cloud/docker.ts'), async (importOriginal) => ({ ...(await importOriginal()), containerState: vi.fn(async () => 'running' as const), docker: vi.fn(async () => '') }));

const owner = '11111111-2222-4333-8444-555555555555';
const nested = '22222222-2222-4333-8444-555555555555';

let root = '';
let workspace = '';
let dir = '';

const ctx = () =>
  ({ cwd: workspace, model: undefined, thinkingLevel: undefined, modelRegistry: { getAvailable: () => [] }, sessionManager: { getSessionId: () => 'parent-session' }, isProjectTrusted: () => true }) as unknown as ExtensionContext;

function writeAgent(agentId: string, cwd: string, extra: Partial<AgentRecord> = {}): void {
  writeRecord(dir, { agentId, type: 'generalPurpose', readonly: false, cwd, createdAt: '2026-11-07T10:00:00.000Z', depth: 1, ...extra });
  const header = { type: 'session', version: 3, id: agentId, timestamp: '2026-11-07T10:00:00.000Z', cwd };
  writeFileSync(join(dir, `2026-11-07T10-00-00-000Z_${agentId}.jsonl`), `${JSON.stringify(header)}\n`);
}

function ownerMachine(): ContainerMachine {
  const path = join(machinesDir(workspace), owner, 'repo');
  mkdirSync(path, { recursive: true });
  return { driver: 'container', path, cwd: path, branch: `pstack/${owner}`, base: 'origin/main', commit: 'abc', remote: 'https://example.com/r.git', container: `pstack-${owner}`, image: 'node', readonly: false };
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'release-')));
  workspace = join(root, 'workspace');
  mkdirSync(workspace);
  vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'agent'));
  dir = subagentDir(workspace);
  mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

test.for([
  { name: 'a cloud agent', source: owner },
  { name: "a cloud agent's subagent", source: nested },
])('a starting fork of $name keeps the machine running until its run lock is released', async ({ source }) => {
  const machine = ownerMachine();
  writeAgent(owner, workspace, { machine });
  writeAgent(nested, machine.cwd);
  const { lock } = prepareFork({ description: 'fork it', prompt: 'next task', fork: source }, ctx(), { agents: [GENERAL_PURPOSE], depth: 0, canSpawn: true }, () => false);
  onTestFinished(lock.release);

  await releaseMachine(machine, dir);
  lock.holdFor(process.ppid);
  await releaseMachine(machine, dir);
  const whileStarting = vi.mocked(docker).mock.calls.slice();
  lock.release();
  await releaseMachine(machine, dir);

  expect(whileStarting).toEqual([]);
  expect(vi.mocked(docker).mock.calls).toEqual([[['stop', '--time', '5', machine.container], { timeoutMs: 30_000 }]]);
});

function bootThenFailServices(): void {
  let running = false;
  vi.mocked(containerState).mockImplementation(async () => (running ? 'running' : 'exited'));
  vi.mocked(docker).mockImplementation(async (args) => {
    if (args[0] === 'start') {
      running = true;
      return '';
    }
    if (args[0] === 'exec') throw new Error('services failed');
    return '';
  });
}

function restoreDockerMocks(): void {
  vi.mocked(containerState).mockReset();
  vi.mocked(docker).mockReset();
  vi.mocked(containerState).mockImplementation(async () => 'running');
  vi.mocked(docker).mockImplementation(async () => '');
}

function forkTask() {
  let execute: ((toolCallId: string, params: { description: string; prompt: string; fork: string }, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<unknown>) | undefined;
  const pi = {
    on: () => () => undefined,
    registerTool: (tool: { name: string; execute: NonNullable<typeof execute> }) => {
      if (tool.name === 'Task') execute = tool.execute;
    },
  } as unknown as ExtensionAPI;
  registerTask(pi, { agents: [GENERAL_PURPOSE], depth: 0, canSpawn: true });
  if (execute === undefined) throw new Error('Task was not registered');
  return execute;
}

const dockerCalls = () => vi.mocked(docker).mock.calls;
const lockFiles = () => readdirSync(dir).filter((name) => name.endsWith('.lock'));

test.for([
  { name: 'a cloud agent', source: owner },
  { name: "a cloud agent's subagent", source: nested },
])('a failed fork of $name stops the machine that launch booted', async ({ source }) => {
  const machine = { ...ownerMachine(), start: 'serve' };
  writeAgent(owner, machine.cwd, { machine });
  writeAgent(nested, machine.cwd);
  bootThenFailServices();
  try {
    await expect(forkTask()('call', { description: 'fork it', prompt: 'next task', fork: source }, undefined, undefined, ctx())).rejects.toThrow('services failed');
    expect(dockerCalls()).toEqual([
      [['start', machine.container], { timeoutMs: 60_000 }],
      [['exec', '-d', '-w', machine.cwd, machine.container, 'bash', '-lc', 'serve']],
      [['stop', '--time', '5', machine.container], { timeoutMs: 30_000 }],
    ]);
    expect(lockFiles()).toEqual([]);
  } finally {
    restoreDockerMocks();
  }
});

test('a failed fork leaves a machine running when another live run still uses it', async () => {
  const machine = { ...ownerMachine(), start: 'serve' };
  writeAgent(owner, machine.cwd, { machine });
  const other = '33333333-2222-4333-8444-555555555555';
  const otherLock = acquireRunLock(dir, other, machine.container);
  otherLock.holdFor(process.ppid);
  onTestFinished(otherLock.release);
  bootThenFailServices();
  try {
    await expect(forkTask()('call', { description: 'fork it', prompt: 'next task', fork: owner }, undefined, undefined, ctx())).rejects.toThrow('services failed');
    expect(dockerCalls()).toEqual([
      [['start', machine.container], { timeoutMs: 60_000 }],
      [['exec', '-d', '-w', machine.cwd, machine.container, 'bash', '-lc', 'serve']],
    ]);
    expect(lockFiles()).toEqual([`${other}.lock`]);
  } finally {
    restoreDockerMocks();
  }
});
