import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Check } from 'typebox/value';
import { expect, test } from 'vitest';
import { buildAgentSchema } from '../src/subagents/schema.ts';
import { workerFixture } from './worker-fixture.ts';

test('the addressable profile accepts names and ignored compatibility fields', () => {
  const input = { description: 'named task', prompt: 'task', name: 'worker-one', team_name: 'ignored-team', mode: 'plan' };
  expect(Check(buildAgentSchema({ addressable: true }), input)).toBe(true);
  expect(Check(buildAgentSchema(), input)).toBe(false);
  expect(Check(buildAgentSchema({ addressable: true }), { ...input, mode: 'invalid' })).toBe(false);
  expect(Check(buildAgentSchema({ addressable: true }), { ...input, name: 42 })).toBe(false);
});

test('native pi dispatch launches and resumes an agent by its offered name', async () => {
  const fixture = await workerFixture();
  try {
    await fixture.session.prompt('NAMED_AGENT_CONTRACT');
    const listed = await fixture.call('ListAgents', {});
    expect(listed.details).toMatchObject({ agents: [{ name: 'contract-worker', agentType: 'general-purpose', status: 'settled' }] });
    expect((await fixture.call('SendMessage', { to: 'contract-worker', message: 'NAMED_CONTINUATION' })).details).toMatchObject({ success: true });
    const after = await fixture.call('ListAgents', {});
    const details = after.details as { agents: { agentId: string }[] };
    const id = details.agents[0]?.agentId;
    if (!id) throw new Error('Missing named child');
    expect((await fixture.call('TaskOutput', { task_id: id, block: true })).details).toMatchObject({ output: 'users=2', agentName: 'contract-worker' });
    expect(await readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).toContain('NAMED_CONTINUATION');
  } finally {
    await fixture.close();
  }
});
