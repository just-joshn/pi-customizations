import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G2-05] JSON effort reaches the real reasoning-capable child', async () => {
  const fixture = await workerFixture({ flags: { agents: JSON.stringify({ reasoning: { description: 'Reasoning agent', prompt: 'Complete the task.', model: 'worker-test/alternate', effort: 'high' } }) } });
  try {
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'JSON effort', prompt: 'ordinary task', subagent_type: 'reasoning', run_in_background: false })).details).toMatchObject({ status: 'completed', resolvedModel: 'worker-test/alternate' });
    expect(JSON.parse(await readFile(join(fixture.dir, 'child-options.json'), 'utf8'))).toEqual({ reasoning: 'high' });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-05] JSON integer effort is read as a thinking budget and runs at the covering level', async () => {
  const fixture = await workerFixture({ flags: { agents: JSON.stringify({ reasoning: { description: 'Reasoning agent', prompt: 'Task', model: 'worker-test/alternate', effort: 12000 } }) } });
  try {
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'integer effort', prompt: 'think', subagent_type: 'reasoning', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(JSON.parse(await readFile(join(fixture.dir, 'child-options.json'), 'utf8'))).toEqual({ reasoning: 'high' });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
