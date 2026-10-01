import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test.for(['Agent', 'Task'])('[G1-12] %s publishes actual first-level depth metadata', async (tool) => {
  const fixture = await workerFixture();
  const starts: unknown[] = [];
  const off = fixture.eventBus.on('pstack:subagent-started', (event) => starts.push(event));
  try {
    const launched = await fixture.call(tool, { description: 'depth metadata', prompt: 'ordinary task', run_in_background: false });
    const details = launched.details;
    if (typeof details !== 'object' || details === null) throw new Error('Expected launch details');
    const id = 'agentId' in details ? details.agentId : 'id' in details ? details.id : undefined;
    if (typeof id !== 'string') throw new Error('Expected an agent ID');
    expect(starts).toEqual([{ agentId: id, spawnDepth: 1, agent_depth: 1 }]);
    expect((await fixture.call('TaskOutput', { task_id: id, block: true })).details).toMatchObject({ id, depth: 1 });
  } finally {
    off();
    await fixture.close();
  }
});
