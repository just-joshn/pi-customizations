import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { workerFixture } from './worker-fixture.ts';

test('fixture cleanup restores environment and removes files even when abort rejects', async t => {
  const prior = process.env.PI_CODING_AGENT_DIR;
  const f = await workerFixture();
  let disposed = false;
  const dispose = f.session.dispose.bind(f.session);
  t.mock.method(f.session, 'dispose', () => { disposed = true; dispose(); });
  const abort = t.mock.method(AgentSession.prototype, 'abort', async () => { throw new Error('fixture abort failed'); });
  try {
    await assert.rejects(f.close(), /fixture abort failed/);
    assert.equal(disposed, true);
    assert.equal(process.env.PI_CODING_AGENT_DIR, prior);
    await assert.rejects(access(f.dir), /ENOENT/);
  } finally { abort.mock.restore(); await f.close(); }
});
