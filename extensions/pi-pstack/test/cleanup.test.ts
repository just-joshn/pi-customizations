import { access } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { workerFixture } from './worker-fixture.ts';

test('fixture cleanup restores environment and removes files even when abort rejects', async () => {
  const prior = process.env.PI_CODING_AGENT_DIR;
  const f = await workerFixture();
  let disposed = false;
  const dispose = f.session.dispose.bind(f.session);
  vi.spyOn(f.session, 'dispose').mockImplementation(() => { disposed = true; dispose(); });
  const abort = vi.spyOn(AgentSession.prototype, 'abort').mockRejectedValue(new Error('fixture abort failed'));
  try {
    await expect(f.close()).rejects.toThrow(/fixture abort failed/);
    expect(disposed).toBe(true);
    expect(process.env.PI_CODING_AGENT_DIR).toBe(prior);
    await expect(access(f.dir)).rejects.toThrow(/ENOENT/);
  } finally { abort.mockRestore(); await f.close(); }
});
