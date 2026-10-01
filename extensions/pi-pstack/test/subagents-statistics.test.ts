import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

const empty = { spawned: 0, completed: 0, failed: 0, killed: 0, max_depth: 0, refused: { depth_limit: 0, concurrency_limit: 0, budget: 0 } };

test('native subagent statistics start at zero without launching a child', async () => {
  const fixture = await workerFixture();
  try {
    expect(fixture.subagentStats.at(-1)).toEqual(empty);
  } finally {
    await fixture.close();
  }
});

test.each([false, true])('Agent completion counts once with background %s', async (background) => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('Agent', { description: 'count completion', prompt: 'complete', run_in_background: background });
    const { agentId } = started.details as { agentId: string };
    await fixture.call('TaskOutput', { task_id: agentId, block: true });
    expect(fixture.subagentStats.at(-1)).toEqual({ ...empty, spawned: 1, completed: 1, max_depth: 1 });
    await fixture.call('TaskOutput', { task_id: agentId });
    expect(fixture.subagentStats.at(-1)).toEqual({ ...empty, spawned: 1, completed: 1, max_depth: 1 });
  } finally {
    await fixture.close();
  }
});

test('unknown type does not increment refused statistics', async () => {
  const fixture = await workerFixture();
  try {
    await expect(fixture.call('Agent', { description: 'unknown', prompt: 'never runs', subagent_type: 'missing' })).rejects.toThrow('not found');
    expect(fixture.subagentStats.at(-1)).toEqual(empty);
  } finally {
    await fixture.close();
  }
});

test('session cap refusals increment budget without incrementing spawned', async () => {
  vi.stubEnv('PI_MAX_SUBAGENTS_PER_SESSION', '2');
  const fixture = await workerFixture();
  try {
    for (const prompt of ['one', 'two']) await fixture.call('Agent', { description: 'count session', prompt, run_in_background: false });
    await expect(fixture.call('Agent', { description: 'over cap', prompt: 'three' })).rejects.toThrow('Session subagent limit reached');
    expect(fixture.subagentStats.at(-1)).toEqual({ ...empty, spawned: 2, completed: 2, max_depth: 1, refused: { depth_limit: 0, concurrency_limit: 0, budget: 1 } });
  } finally {
    await fixture.close();
  }
});

test('foreground Agent failure is counted at settlement even though the call throws', async () => {
  const fixture = await workerFixture();
  try {
    await expect(fixture.call('Agent', { description: 'count failure', prompt: 'FAIL', run_in_background: false })).rejects.toThrow('scripted failure');
    expect(fixture.subagentStats.at(-1)).toEqual({ ...empty, spawned: 1, failed: 1, max_depth: 1 });
  } finally {
    await fixture.close();
  }
});

test('TaskStop counts the stopped Agent once without counting it as completed', async () => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('Agent', { description: 'count stop', prompt: 'WAIT_BLOCKED' });
    const { agentId } = started.details as { agentId: string };
    await fixture.call('TaskStop', { task_id: agentId });
    expect(fixture.subagentStats.at(-1)).toEqual({ ...empty, spawned: 1, killed: 1, max_depth: 1 });
    await fixture.call('TaskStop', { task_id: agentId });
    expect(fixture.subagentStats.at(-1)).toEqual({ ...empty, spawned: 1, killed: 1, max_depth: 1 });
  } finally {
    await fixture.close();
  }
});
