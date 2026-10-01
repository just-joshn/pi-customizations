import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test('[G1-13] cap offer mask restores the SDK selection after the model run', async () => {
  vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', '1');
  const fixture = await workerFixture();
  try {
    const launched = await fixture.call('Task', { prompt: 'first task', run_in_background: false });
    const details = launched.details;
    if (typeof details !== 'object' || details === null || !('sessionFile' in details) || typeof details.sessionFile !== 'string') throw new Error('Expected a child transcript path');
    fixture.session.sessionManager.setSessionFile(details.sessionFile);
    await fixture.session.reload();
    await fixture.session.bindExtensions({ mode: 'print' });
    const original = fixture.session.getActiveToolNames();
    expect(original).toContain('Agent');
    expect(original).toContain('Task');
    await fixture.session.prompt('ordinary query at cap');
    await fixture.session.waitForIdle();
    expect(fixture.session.getActiveToolNames()).toEqual(original);
  } finally {
    await fixture.close();
  }
});

test('[G1-13] a different selection made by a real tool survives mask cleanup', async () => {
  vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', '1');
  const fixture = await workerFixture();
  try {
    const launched = await fixture.call('Task', { prompt: 'first task', run_in_background: false });
    const details = launched.details;
    if (typeof details !== 'object' || details === null || !('sessionFile' in details) || typeof details.sessionFile !== 'string') throw new Error('Expected a child transcript path');
    fixture.session.sessionManager.setSessionFile(details.sessionFile);
    await fixture.session.reload();
    await fixture.session.bindExtensions({ mode: 'print' });
    await fixture.session.prompt('READ_ONLY_POLICY');
    await fixture.session.waitForIdle();
    expect(fixture.session.getActiveToolNames()).toEqual(['read']);
  } finally {
    await fixture.close();
  }
});

test('[G2-25] transient simple mask does not widen an explicit Read-only selection', async () => {
  vi.stubEnv('CLAUDE_CODE_SIMPLE', '1');
  const fixture = await workerFixture();
  try {
    fixture.session.setActiveToolsByName(['read']);
    await fixture.session.prompt('ordinary simple query');
    await fixture.session.waitForIdle();
    expect(fixture.session.getActiveToolNames()).toEqual(['read']);
  } finally {
    await fixture.close();
  }
});
