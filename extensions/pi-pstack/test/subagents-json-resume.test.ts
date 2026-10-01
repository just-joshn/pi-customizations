import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G2-05] JSON agent resumes after the discovery cache is cleared', async () => {
  const fixture = await workerFixture({ flags: { agents: JSON.stringify({ 'json-resume': { description: 'JSON resume', prompt: 'JSON_RESUME_SYSTEM_SENTINEL', tools: ['read'], model: 'worker-test/alternate', effort: 'high' } }) } });
  try {
    clearAgentCache();
    const launched = await fixture.call('Agent', { description: 'JSON resume', prompt: 'first request', subagent_type: 'json-resume', run_in_background: false });
    expect(launched.details).toMatchObject({ status: 'completed' });
    const details = launched.details;
    if (typeof details !== 'object' || details === null || !('agentId' in details) || typeof details.agentId !== 'string') throw new Error('Expected a string agent ID from launch');
    const id = details.agentId;
    clearAgentCache();
    await fixture.session.reload();
    await fixture.session.bindExtensions({ mode: 'print' });
    expect((await fixture.call('SendMessage', { to: id, message: 'RESUMED_JSON_REQUEST' })).details).toMatchObject({ success: true });
    await fixture.call('TaskOutput', { task_id: id, block: true });
    const history = (await readFile(join(fixture.dir, 'child-requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const resumed = history.find((request) => request.messages.some((message: { role: string; content: unknown }) => message.role === 'user' && JSON.stringify(message.content).includes('RESUMED_JSON_REQUEST')));
    expect(resumed).toMatchObject({ model: 'alternate', reasoning: 'high' });
    const system = resumed.messages.filter((message: { role: string }) => message.role === 'system');
    expect(JSON.stringify(system)).toContain('JSON_RESUME_SYSTEM_SENTINEL');
    expect(system.flatMap((message: { toolsAdded?: { name: string }[] }) => message.toolsAdded?.map((tool) => tool.name) ?? [])).toEqual(['read']);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
