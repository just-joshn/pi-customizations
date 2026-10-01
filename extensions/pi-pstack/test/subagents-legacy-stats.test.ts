import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test('[G1-13] explicit legacy stop settles one killed identity', async () => {
  const fixture = await workerFixture();
  try {
    const launched = await fixture.call('Task', { prompt: 'WAIT_BLOCKED', run_in_background: true });
    const details = launched.details;
    if (typeof details !== 'object' || details === null || !('id' in details) || typeof details.id !== 'string') throw new Error('Expected an agent ID');
    await fixture.call('TaskStop', { task_id: details.id });
    await fixture.call('TaskOutput', { task_id: details.id, block: true });
    expect(fixture.subagentStats.at(-1)).toMatchObject({ spawned: 1, completed: 0, failed: 0, killed: 1, max_depth: 1 });
  } finally {
    await fixture.close();
  }
});

test.for([
  { tool: 'Agent', prompt: 'ordinary task', completed: 1, failed: 0 },
  { tool: 'Task', prompt: 'ordinary task', completed: 1, failed: 0 },
  { tool: 'Agent', prompt: 'FAIL', completed: 0, failed: 1 },
  { tool: 'Task', prompt: 'FAIL', completed: 0, failed: 1 },
])('[G1-13] $tool first identity records completed $completed failed $failed', async ({ tool, prompt, completed, failed }) => {
  const fixture = await workerFixture();
  try {
    const call = fixture.call(tool, { description: 'stats identity', prompt, run_in_background: false });
    if (failed) await expect(call).rejects.toThrow('scripted failure');
    else await call;
    expect(fixture.subagentStats.at(-1)).toMatchObject({ spawned: 1, completed, failed, killed: 0, max_depth: 1 });
  } finally {
    await fixture.close();
  }
});
