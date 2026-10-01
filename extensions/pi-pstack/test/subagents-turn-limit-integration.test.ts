import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache, discoverAgents } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

async function definition(dir: string, maxTurns: number) {
  const path = join(dir, '.pi/agents');
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'bounded.md'), `---\nname: bounded\ndescription: bounded child\nmaxTurns: ${maxTurns}\n---\nbounded prompt`);
  clearAgentCache();
}

async function queryCount(dir: string) {
  return (await readFile(join(dir, 'provider-inputs.jsonl'), 'utf8')).split('\n').filter(Boolean).length;
}

test('[G2-07] a child that reports on its last allowed turn completes without a turn-limit note', async () => {
  const fixture = await workerFixture();
  try {
    await definition(fixture.dir, 2);
    const done = await fixture.call('Agent', { description: 'two turns', prompt: 'PROGRESS_READ two', subagent_type: 'bounded', run_in_background: false });
    expect(done.details).toMatchObject({ status: 'completed', content: [{ type: 'text', text: 'users=1' }], harnessNoteCount: 0 });
    expect(await queryCount(fixture.dir)).toBe(2);
    expect(fixture.subagentLogs).not.toContain('[Agent: bounded] Reached max turns limit (2)');
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-07] internal max_turns overrides the definition without changing its cached limit', async () => {
  const fixture = await workerFixture();
  try {
    await definition(fixture.dir, 3);
    const cached = discoverAgents({ root: fixture.dir, userDirs: [], env: {} }).activeAgents.find((agent) => agent.agentType === 'bounded');
    const limited = await fixture.call('Agent', { description: 'override one', prompt: 'PROGRESS_READ overridden', subagent_type: 'bounded', max_turns: 1, run_in_background: false });
    expect(limited.details).toMatchObject({ status: 'completed', totalToolUseCount: 1, harnessNoteCount: 1 });
    expect(await queryCount(fixture.dir)).toBe(1);
    expect(fixture.subagentLogs).toContain('[Agent: bounded] Reached max turns limit (1)');
    expect(cached?.maxTurns).toBe(3);
    const next = await fixture.call('Agent', { description: 'default three', prompt: 'PROGRESS_READ default', subagent_type: 'bounded', run_in_background: false });
    expect(next.details).toMatchObject({ status: 'completed', totalToolUseCount: 1 });
    expect(await queryCount(fixture.dir)).toBe(3);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test.each([0, -1, 1.5, null, '2'])('invalid internal max_turns %j starts no child', async (max_turns) => {
  const fixture = await workerFixture();
  try {
    await expect(fixture.call('Agent', { description: 'invalid turns', prompt: 'never runs', max_turns })).rejects.toThrow('max_turns must be a positive integer.');
    expect((await fixture.call('ListAgents', {})).details).toEqual({ agents: [] });
  } finally {
    await fixture.close();
  }
});
