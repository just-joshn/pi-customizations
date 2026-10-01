import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

test.for([
  { cap: '1', refused: true },
  { cap: '2', refused: false },
])('[G1-12] legacy nested Task obeys cap $cap', async ({ cap, refused }) => {
  vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', cap);
  const fixture = await workerFixture();
  try {
    expect((await fixture.call('Agent', { description: 'legacy depth', prompt: 'SPAWN_LEGACY_TASK', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    const results = JSON.parse(await readFile(join(fixture.dir, 'child-tool-results.json'), 'utf8'));
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ toolName: 'Task', isError: refused })]));
    if (!refused) expect(results.find((message: { toolName: string }) => message.toolName === 'Task').details).toMatchObject({ depth: 2 });
    const history = await readFile(join(fixture.dir, 'provider-inputs.jsonl'), 'utf8');
    expect(history.includes('LEGACY_DEPTH_LEAF_REQUEST')).toBe(!refused);
  } finally {
    await fixture.close();
  }
});

test('[G1-12] lowering the cap does not block an existing legacy child resume', async () => {
  vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', '2');
  const fixture = await workerFixture();
  try {
    const launched = await fixture.call('Task', { prompt: 'SPAWN_LEGACY_TASK', subagent_type: 'generalPurpose', run_in_background: false });
    const details = launched.details;
    if (typeof details !== 'object' || details === null || !('sessionFile' in details) || typeof details.sessionFile !== 'string') throw new Error('Expected a child transcript path');
    const nested = JSON.parse(await readFile(join(fixture.dir, 'child-tool-results.json'), 'utf8')).find((message: { toolName: string }) => message.toolName === 'Task');
    expect(nested).toMatchObject({ isError: false, details: { status: 'settled' } });
    const id = nested.details.id;
    expect(typeof id).toBe('string');
    vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', '1');
    fixture.session.sessionManager.setSessionFile(details.sessionFile);
    await fixture.session.reload();
    await fixture.session.bindExtensions({ mode: 'print' });
    const resumed = await fixture.call('Task', { prompt: 'CAP_RESUME_EXISTING_LEAF', resume: id, run_in_background: false });
    expect(resumed.details).toMatchObject({ id, status: 'settled', depth: 2 });
    expect(await readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).toContain('CAP_RESUME_EXISTING_LEAF');
  } finally {
    await fixture.close();
  }
});

test('[G1-12] direct legacy startup restores depth from an actual child transcript', async () => {
  vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', '1');
  const fixture = await workerFixture();
  try {
    const launched = await fixture.call('Task', { prompt: 'first task', subagent_type: 'generalPurpose', run_in_background: false });
    const details = launched.details;
    if (typeof details !== 'object' || details === null || !('sessionFile' in details) || typeof details.sessionFile !== 'string') throw new Error('Expected a child transcript path');
    fixture.session.sessionManager.setSessionFile(details.sessionFile);
    await fixture.session.reload();
    await fixture.session.bindExtensions({ mode: 'print' });
    await expect(fixture.call('Task', { prompt: 'must not start', subagent_type: 'generalPurpose', run_in_background: false })).rejects.toMatchObject({
      name: 'AgentPreconditionError',
      code: 'subagent_depth_cap',
      message:
        'Subagent nesting limit reached (depth 1 of 1). Complete this task directly using your tools instead of spawning another agent. If the user explicitly requested deeper nesting, ask them to raise CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH.',
    });
  } finally {
    await fixture.close();
  }
});
