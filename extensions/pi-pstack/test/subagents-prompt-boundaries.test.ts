import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { parseJsonAgents } from '../src/subagents/json-definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G2-08] a child does not receive the main-thread-only initialPrompt', async () => {
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/initial.md'), '---\nname: initial\ndescription: initial prompt\ninitialPrompt: MAIN_THREAD_ONLY_SENTINEL\n---\nComplete the task.');
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'child input', prompt: 'actual user request', subagent_type: 'initial', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    const input = await readFile(join(fixture.dir, 'child-input.txt'), 'utf8');
    expect(input).toContain('actual user request');
    expect(input).not.toContain('MAIN_THREAD_ONLY_SENTINEL');
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-08] JSON critical reminder survives the definition boundary', () => {
  expect(parseJsonAgents('{"probe":{"description":"Probe","prompt":"Task","criticalSystemReminder_EXPERIMENTAL":"CRITICAL_JSON_SENTINEL"}}', '/tmp')).toEqual([
    { agentType: 'probe', whenToUse: 'Probe', systemPrompt: 'Task', source: 'flagSettings', baseDir: '/tmp', criticalSystemReminder_EXPERIMENTAL: 'CRITICAL_JSON_SENTINEL' },
  ]);
});
