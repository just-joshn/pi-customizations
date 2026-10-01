import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { discoverAgents } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G2-04] cached parsed definition is reused without retaining another task prompt', async () => {
  const fixture = await workerFixture();
  try {
    const dir = join(fixture.dir, '.pi/agents');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'reuse.md');
    await writeFile(file, '---\nname: parser-reuse\ndescription: parsed reuse\nmaxTurns: x\n---\n  shared system prompt  \n');
    await writeFile(join(dir, 'missing.md'), '---\nname: no-description\n---\nnot loaded');
    const discovery = discoverAgents({ root: fixture.dir, userDirs: [], env: {} });
    expect(discovery.activeAgents.some((agent) => agent.agentType === 'no-description')).toBe(false);
    const definition = discovery.activeAgents.find((agent) => agent.agentType === 'parser-reuse');
    expect(definition?.systemPrompt).toBe('shared system prompt');
    const first = await fixture.call('Agent', { description: 'first definition use', prompt: 'first distinct prompt', subagent_type: 'parser-reuse', run_in_background: false });
    expect(first.details).toMatchObject({ status: 'completed', content: [{ type: 'text', text: 'users=1' }] });
    expect(await readFile(join(fixture.dir, 'child-input.txt'), 'utf8')).toContain('first distinct prompt');
    const second = await fixture.call('Agent', { description: 'second definition use', prompt: 'second distinct prompt', subagent_type: 'parser-reuse', run_in_background: false });
    expect(second.details).toMatchObject({ status: 'completed', content: [{ type: 'text', text: 'users=1' }] });
    const input = await readFile(join(fixture.dir, 'child-input.txt'), 'utf8');
    expect(input).toContain('second distinct prompt');
    expect(await readFile(join(fixture.dir, 'child-system.txt'), 'utf8')).toContain('shared system prompt');
    expect(input).not.toContain('first distinct prompt');
    expect(discoverAgents({ root: fixture.dir }).activeAgents.find((agent) => agent.agentType === 'parser-reuse')).toBe(definition);
    expect(definition?.systemPrompt).toBe('shared system prompt');
    expect(fixture.subagentLogs).toContain(`Agent file ${file} has invalid maxTurns 'x'. Must be a positive integer.`);
  } finally {
    await fixture.close();
  }
});
