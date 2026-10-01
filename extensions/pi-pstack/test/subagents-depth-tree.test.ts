import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test('[G1-13] real SDK tree navigation resets absent depth to main zero', async () => {
  vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', '1');
  const fixture = await workerFixture();
  try {
    const launched = await fixture.call('Task', { prompt: 'first task', run_in_background: false });
    const details = launched.details;
    if (typeof details !== 'object' || details === null || !('sessionFile' in details) || typeof details.sessionFile !== 'string') throw new Error('Expected a child transcript path');
    fixture.session.sessionManager.setSessionFile(details.sessionFile);
    await fixture.session.reload();
    await fixture.session.bindExtensions({ mode: 'print' });
    await expect(fixture.call('Task', { prompt: 'must refuse', run_in_background: false })).rejects.toMatchObject({ code: 'subagent_depth_cap' });
    const oldLeafId = fixture.session.sessionManager.getLeafId();
    fixture.session.sessionManager.resetLeaf();
    await fixture.session.extensionRunner.emit({ type: 'session_tree', newLeafId: null, oldLeafId });
    expect((await fixture.call('Task', { prompt: 'top-level again', run_in_background: false })).details).toMatchObject({ status: 'settled', depth: 1 });
  } finally {
    await fixture.close();
  }
});
