import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';
import { docker } from '../src/cloud/docker.ts';
import { type ContainerMachine, releaseMachine } from '../src/cloud/machine.ts';
import { machinesDir, subagentDir } from '../src/paths.ts';
import { GENERAL_PURPOSE } from '../src/task/agents.ts';
import { type AgentRecord, writeRecord } from '../src/task/records.ts';
import { prepareFork } from '../src/task/tool.ts';

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
