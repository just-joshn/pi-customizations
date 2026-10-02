import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { agentEnvironment, agentMetaPath, agentTranscriptPath, childStorageDir, createChildTranscript, environmentEntryType, writeAgentMeta } from '../src/subagents/agent-storage.ts';
import type { Exec } from '../src/subagents/environment-facts.ts';

test('child storage paths are namespaced under the validated parent session', () => {
  expect(childStorageDir('/sessions', 'parent-1')).toBe(join('/sessions', 'parent-1', 'subagents'));
  expect(() => childStorageDir('/sessions', '../escape')).toThrow('Invalid agent identifier.');
  expect(agentTranscriptPath('/sessions/parent-1/subagents', 'agent-1')).toBe(join('/sessions/parent-1/subagents', 'agent-agent-1.jsonl'));
  expect(agentMetaPath('/sessions/parent-1/subagents', 'agent-1')).toBe(join('/sessions/parent-1/subagents', 'agent-agent-1.meta.json'));
  expect(environmentEntryType).toBe('pstack-agent-environment');
});

test('a child transcript pins the agent file name and records the parent session when known', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-agent-storage-'));
  try {
    const path = await createChildTranscript('/repo', join(dir, 'subagents'), 'agent-1', 'parent-session');
    expect(path).toBe(join(dir, 'subagents', 'agent-agent-1.jsonl'));
    const header: unknown = JSON.parse(await readFile(path, 'utf8'));
    expect(header).toMatchObject({ type: 'session', parentSession: 'parent-session' });
    const withoutParent = await createChildTranscript('/repo', join(dir, 'other'), 'agent-2', undefined);
    expect(JSON.parse(await readFile(withoutParent, 'utf8'))).not.toHaveProperty('parentSession');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('agent metadata is written once and never overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-agent-meta-'));
  try {
    const meta = { agentType: 'explore', description: 'd', spawnDepth: 1, requestShape: 'foreground', requestNonInteractive: false } as const;
    await writeAgentMeta(dir, 'agent-1', meta);
    await writeAgentMeta(dir, 'agent-1', { ...meta, description: 'changed' });
    expect(JSON.parse(await readFile(agentMetaPath(dir, 'agent-1'), 'utf8'))).toEqual(meta);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the agent environment asks git for the branch and falls back to HEAD', async () => {
  const success: Exec = async () => ({ stdout: 'feature/x\n', stderr: '', code: 0, killed: false });
  const empty: Exec = async () => ({ stdout: '\n', stderr: '', code: 0, killed: false });
  const failed: Exec = async () => {
    throw new Error('git missing');
  };
  expect(await agentEnvironment('a1', 'p1', '/repo', success)).toMatchObject({ agentId: 'a1', isSidechain: true, sessionId: 'p1', cwd: '/repo', gitBranch: 'feature/x' });
  expect((await agentEnvironment('a1', 'p1', '/repo', empty)).gitBranch).toBe('HEAD');
  expect((await agentEnvironment('a1', 'p1', '/repo', failed)).gitBranch).toBe('HEAD');
});
