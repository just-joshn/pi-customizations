import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

type Fixture = Awaited<ReturnType<typeof workerFixture>>;

async function put(fixture: Fixture, path: string, body: string): Promise<void> {
  await mkdir(join(fixture.dir, path, '..'), { recursive: true });
  await writeFile(join(fixture.dir, path), body);
}

async function settings(fixture: Fixture, extra: object): Promise<void> {
  const current = JSON.parse(await readFile(join(fixture.dir, 'settings.json'), 'utf8'));
  await writeFile(join(fixture.dir, 'settings.json'), JSON.stringify({ ...current, ...extra }));
  clearAgentCache();
}

const launch = (fixture: Fixture, subagent_type: string) => fixture.call('Agent', { description: 'catalog probe', prompt: 'hello', subagent_type, run_in_background: false }) as Promise<{ details: Record<string, unknown> }>;

test('agents shipped by an installed pi package launch under their plugin namespace', async () => {
  const fixture = await workerFixture();
  try {
    await put(fixture, 'kit/package.json', JSON.stringify({ name: 'review-kit', pi: { extensions: [], agents: ['./agents'] } }));
    await put(fixture, 'kit/agents/auditor.md', '---\ndescription: Audits code\n---\nAudit.');
    await settings(fixture, { packages: ['./kit'] });
    expect((await launch(fixture, 'review-kit:auditor')).details).toMatchObject({ status: 'completed', agentType: 'review-kit:auditor' });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('extensions register runtime plugin agents over pi.events and can unregister them', async () => {
  const fixture = await workerFixture();
  try {
    fixture.eventBus.emit('pstack:register-agent', { plugin: 'ext', name: 'helper', spec: { description: 'Runtime helper', prompt: 'Help.' } });
    expect((await launch(fixture, 'ext:helper')).details).toMatchObject({ status: 'completed', agentType: 'ext:helper' });
    fixture.eventBus.emit('pstack:unregister-agent', { plugin: 'ext', name: 'helper' });
    await expect(launch(fixture, 'ext:helper')).rejects.toMatchObject({ code: 'subagent_type_not_found' });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('a lazily loaded runtime agent must load with the offered identity', async () => {
  const fixture = await workerFixture();
  try {
    fixture.eventBus.emit('pstack:register-agent', { plugin: 'ext', name: 'lazy', spec: { description: 'Lazy' }, load: async () => ({ description: 'Lazy', prompt: 'Loaded.' }) });
    fixture.eventBus.emit('pstack:register-agent', { plugin: 'ext', name: 'swapped', spec: { description: 'Swapped' }, load: async () => ({ name: 'other', description: 'Other', prompt: 'Wrong.' }) });
    expect((await launch(fixture, 'ext:lazy')).details).toMatchObject({ status: 'completed', agentType: 'ext:lazy' });
    await expect(launch(fixture, 'ext:swapped')).rejects.toMatchObject({ name: 'AgentTypeError', message: "Agent type 'ext:swapped' could not be loaded from its plugin." });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('pstack.additionalDirectories contributes project agents from another directory', async () => {
  const fixture = await workerFixture();
  try {
    await put(fixture, 'extra/.claude/agents/helper.md', '---\nname: helper\ndescription: Extra helper\n---\nHelp.');
    await settings(fixture, { pstack: { additionalDirectories: ['extra'] } });
    expect((await launch(fixture, 'helper')).details).toMatchObject({ status: 'completed', agentType: 'helper' });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('a reload clears cached definitions so new agent files are picked up', async () => {
  const fixture = await workerFixture();
  try {
    await expect(launch(fixture, 'late')).rejects.toMatchObject({ code: 'subagent_type_not_found' });
    await put(fixture, '.pi/agents/late.md', '---\nname: late\ndescription: Late agent\ncolor: green\n---\nLate.');
    const colors: unknown[] = [];
    fixture.eventBus.on('pstack:subagent-color', (value) => colors.push(value));
    await fixture.session.extensionRunner.emit({ type: 'session_start', reason: 'reload' });
    expect((await launch(fixture, 'late')).details).toMatchObject({ status: 'completed', agentType: 'late' });
    expect(colors).toEqual([{ agentType: 'late', color: 'green' }, { agentType: 'statusline-setup', color: 'orange' }]);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
