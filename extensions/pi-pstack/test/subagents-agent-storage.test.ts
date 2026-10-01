import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { SessionManager, VERSION } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { agentMetaPath, childStorageDir } from '../src/subagents/agent-storage.ts';
import { readSidechain } from '../src/subagents/sidechain.ts';
import { workerFixture } from './worker-fixture.ts';
import { workerTiming } from './worker-timing.ts';

test('[B95] child storage sits under the parent session id in a subagents directory', () => {
  expect(childStorageDir('/sessions/--w--', 'parent-1')).toBe('/sessions/--w--/parent-1/subagents');
});

async function launched() {
  const fixture = await workerFixture();
  const started = await fixture.call('Agent', { description: 'persist probe', prompt: 'hello', run_in_background: false });
  const record = started.details as { agentId: string };
  const parent = fixture.session.sessionManager;
  const dir = join(parent.getSessionDir(), parent.getSessionId(), 'subagents');
  return { fixture, agentId: record.agentId, dir, parentId: parent.getSessionId(), parentFile: parent.getSessionFile() };
}

test('[B95][B96] the child transcript is agent-<id>.jsonl under the parent session and its header links to the parent file', async () => {
  const { fixture, agentId, dir, parentId, parentFile } = await launched();
  try {
    const transcript = join(dir, `agent-${agentId}.jsonl`);
    const header = JSON.parse((await readFile(transcript, 'utf8')).split('\n')[0] ?? '');
    expect(header).toMatchObject({ type: 'session', id: agentId, parentSession: parentFile });
    expect(SessionManager.open(transcript).getSessionId()).toBe(agentId);
    expect(parentId).not.toBe(agentId);
  } finally {
    await fixture.close();
  }
});

test('[B99] agent-<id>.meta.json records the launch shape', async () => {
  const { fixture, agentId, dir } = await launched();
  try {
    const meta = JSON.parse(await readFile(agentMetaPath(dir, agentId), 'utf8'));
    expect(meta).toEqual({ agentType: 'general-purpose', description: 'persist probe', toolUseId: 'test-Agent', spawnDepth: 1, requestShape: 'foreground', requestNonInteractive: true });
  } finally {
    await fixture.close();
  }
});

test('[B96][B97][B98] readers follow ancestry and every record carries the sidechain fields', async () => {
  const { fixture, agentId, dir, parentId } = await launched();
  try {
    const records = readSidechain(join(dir, `agent-${agentId}.jsonl`));
    expect(records.length).toBeGreaterThan(2);
    for (const [index, record] of records.entries()) {
      expect(record).toMatchObject({ agentId, isSidechain: true, sessionId: parentId, cwd: await realpath(fixture.dir), version: VERSION, gitBranch: 'HEAD' });
      expect(record.parentUuid).toBe(index === 0 ? null : records[index - 1]?.uuid);
      expect(Number.isNaN(Date.parse(record.timestamp))).toBe(false);
    }
    expect(records.some((record) => record.type === 'user')).toBe(true);
    expect(records.some((record) => record.type === 'assistant')).toBe(true);
  } finally {
    await fixture.close();
  }
});

test('[B95] a resumed child keeps appending to its agent transcript', async () => {
  const { fixture, agentId, dir } = await launched();
  try {
    await fixture.call('SendMessage', { to: agentId, message: 'again' });
    await vi.waitFor(() => expect(readSidechain(join(dir, `agent-${agentId}.jsonl`)).filter((record) => record.type === 'user').length).toBeGreaterThanOrEqual(2), { timeout: workerTiming.settlementDeadlineMs });
  } finally {
    await fixture.close();
  }
});
