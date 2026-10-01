import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { builtinAgents } from '../src/subagents/builtins.ts';
import { clearAgentCache, discoverAgents } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

const switches = ['CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS', 'PI_DISABLE_BUILTIN_AGENTS'];

test.for(switches)('[G2-11] %s omits all built-in definitions', (name) => {
  expect(builtinAgents({}).map((agent) => agent.agentType)).toEqual(['general-purpose', 'statusline-setup', 'Explore', 'Plan', 'claude-code-guide']);
  expect(builtinAgents({ [name]: '1' })).toStrictEqual([]);
});

test.for(switches)('[G2-11] %s retains custom definitions and refuses an unavailable implicit default', async (name) => {
  vi.stubEnv(name, '1');
  clearAgentCache();
  const fixture = await workerFixture();
  try {
    const dir = join(fixture.dir, '.pi/agents');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'explicit.md'), '---\nname: explicit\ndescription: explicit worker\n---\nComplete the task directly.');
    clearAgentCache();
    const agents = discoverAgents({ root: fixture.dir }).activeAgents;
    expect(agents.map((agent) => ({ type: agent.agentType, source: agent.source }))).toEqual([{ type: 'explicit', source: 'projectSettings' }]);
    await expect(fixture.call('Agent', { description: 'missing default', prompt: 'ordinary task', run_in_background: false })).rejects.toThrow('subagent_type is required: the general-purpose agent is not available');
    expect((await fixture.call('Agent', { description: 'explicit custom worker', prompt: 'ordinary task', subagent_type: 'explicit', run_in_background: false })).details).toMatchObject({ status: 'completed', totalTokens: 5 });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
