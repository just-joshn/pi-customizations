import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test.for([
  { tools: '["*"]', expected: ['read'] },
  { tools: '[read]', expected: ['read'] },
  { tools: '[grep]', expected: [] },
])('[G2-25] simple mode intersects $tools with the Read-only offer', async ({ tools, expected }) => {
  vi.stubEnv('CLAUDE_CODE_SIMPLE', '1');
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/simple.md'), `---\nname: simple\ndescription: simple mode\ntools: ${tools}\n---\nComplete the task.`);
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'simple offer', prompt: 'ordinary task', subagent_type: 'simple', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8'))).toEqual(expected);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

const cases = [
  { label: 'under cap', tools: '["*"]', depth: '3', offered: true },
  { label: 'at cap', tools: '["*"]', depth: '1', offered: false },
  { label: 'scoped without default', tools: 'Agent(Plan)', depth: '3', offered: true },
  { label: 'scoped with default', tools: '["Agent(general-purpose, Plan)"]', depth: '3', offered: true },
  { label: 'explicit read only', tools: '[read]', depth: '3', offered: false },
];

test.for(cases)('[G1-12][G1-13] $label publishes the correct native Agent offer', async ({ tools, depth, offered }) => {
  vi.stubEnv('PI_MAX_SUBAGENT_SPAWN_DEPTH', depth);
  const fixture = await workerFixture();
  try {
    await mkdir(join(fixture.dir, '.pi/agents'), { recursive: true });
    await writeFile(join(fixture.dir, '.pi/agents/offer.md'), `---\nname: offer\ndescription: tool offer\ntools: ${tools}\n---\nComplete the task.`);
    clearAgentCache();
    expect((await fixture.call('Agent', { description: 'tool offer check', prompt: 'ordinary task', subagent_type: 'offer', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    const names = JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8')) as string[];
    expect(names.includes('Agent')).toBe(offered);
    if (tools === '["*"]') {
      expect(names).toContain('SendMessage');
      expect(names).toContain('ListAgents');
    }
    if (tools === '[read]') expect(names).toEqual(['read']);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
