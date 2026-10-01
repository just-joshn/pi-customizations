import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

const message =
  'Subagent nesting limit reached (depth 1 of 1). Complete this task directly using your tools instead of spawning another agent. If the user explicitly requested deeper nesting, ask them to raise CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH.';

test.for(['Agent', 'Task'])('[G1-12] restored %s admission retains the source depth refusal identity', async (tool) => {
  vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', '1');
  const fixture = await workerFixture();
  const refusals: unknown[] = [];
  const off = fixture.eventBus.on('pstack:subagent-refused', (event) => refusals.push(event));
  try {
    const launched = await fixture.call('Task', { prompt: 'first task', subagent_type: 'generalPurpose', run_in_background: false });
    const details = launched.details;
    if (typeof details !== 'object' || details === null || !('sessionFile' in details) || typeof details.sessionFile !== 'string') throw new Error('Expected a child transcript path');
    fixture.session.sessionManager.setSessionFile(details.sessionFile);
    await fixture.session.reload();
    await fixture.session.bindExtensions({ mode: 'print' });
    await expect(fixture.call(tool, { description: 'must refuse', prompt: 'must not start' })).rejects.toMatchObject({ name: 'AgentPreconditionError', code: 'subagent_depth_cap', message });
    expect(refusals).toEqual([{ code: 'subagent_depth_cap', reason: 'depth_limit' }]);
    expect(fixture.subagentStats.at(-1)).toMatchObject({ refused: { depth_limit: 1 } });
  } finally {
    off();
    await fixture.close();
  }
});
