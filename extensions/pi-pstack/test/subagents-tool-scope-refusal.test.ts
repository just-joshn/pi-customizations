import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test.for(['tools: ["Bash(git *)"]', 'tools: [bash]\ndisallowedTools: ["Bash(rm *)"]', 'tools: [Agent]\ndisallowedTools: ["Agent(a, b)"]'])('scoped declaration refuses rather than granting unscoped access %s', async (fields) => {
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/scoped.md'), `---\nname: scoped\ndescription: scoped agent\n${fields}\n---\nComplete the task.`);
    clearAgentCache();
    await expect(fixture.call('Agent', { description: 'scoped access', prompt: 'never runs', subagent_type: 'scoped', run_in_background: false })).rejects.toThrow('argument-scoped tool rules are not enforced by Pi');
    expect((await fixture.call('ListAgents', {})).details).toEqual({ agents: [] });
    await expect(readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
