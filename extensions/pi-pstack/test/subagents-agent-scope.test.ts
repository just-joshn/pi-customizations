import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

async function scoped(dir: string, types: string) {
  await mkdir(join(dir, '.pi/agents'), { recursive: true });
  await writeFile(join(dir, '.pi/agents/scoped.md'), `---\nname: scoped\ndescription: scoped agent\ntools: ["Agent(${types})"]\n---\nComplete the task.`);
  clearAgentCache();
}

test('[G2-23] scoped Agent permits the named general-purpose grandchild', async () => {
  const fixture = await workerFixture();
  try {
    await scoped(fixture.dir, 'general-purpose, Plan');
    expect((await fixture.call('Agent', { description: 'allowed nested scope', prompt: 'SPAWN_AGENT', subagent_type: 'scoped', run_in_background: false })).details).toMatchObject({ status: 'completed', totalToolUseCount: 1 });
    const results = JSON.parse(await readFile(join(fixture.dir, 'child-tool-results.json'), 'utf8'));
    expect(results).toMatchObject([{ toolName: 'Agent', isError: false, details: { status: 'completed' } }]);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('[G2-23] scoped Agent without general-purpose refuses an implicit grandchild', async () => {
  const fixture = await workerFixture();
  try {
    await scoped(fixture.dir, 'Plan');
    expect((await fixture.call('Agent', { description: 'denied nested scope', prompt: 'SPAWN_AGENT', subagent_type: 'scoped', run_in_background: false })).details).toMatchObject({ status: 'completed', totalToolUseCount: 1 });
    const results = JSON.parse(await readFile(join(fixture.dir, 'child-tool-results.json'), 'utf8'));
    expect(results).toMatchObject([{ toolName: 'Agent', isError: true }]);
    expect(results[0]?.content?.[0]?.text).toBe('subagent_type is required: the general-purpose agent is not available in this session. Available agents: Plan');
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
