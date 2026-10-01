import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

import { expect, test } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

type Fixture = Awaited<ReturnType<typeof workerFixture>>;

async function put(fixture: Fixture, path: string, body: string): Promise<void> {
  await mkdir(join(fixture.dir, path, '..'), { recursive: true });
  await writeFile(join(fixture.dir, path), body);
}

const launch = (fixture: Fixture, subagent_type: string) => fixture.call('Agent', { description: 'catalog probe', prompt: 'hello', subagent_type, run_in_background: false });

test.for([
  { title: 'a missing plugin', payload: { name: 'helper', spec: {} } },
  { title: 'an empty name', payload: { plugin: 'ext', name: '', spec: {} } },
  { title: 'a non-object payload', payload: 'helper' },
])('a registration with $title is logged and ignored', async ({ payload }) => {
  const fixture = await workerFixture();
  try {
    fixture.eventBus.emit('pstack:register-agent', payload);
    expect(fixture.subagentLogs).toEqual(['Ignored pstack:register-agent: expected { plugin, name, spec } with non-empty plugin and name']);
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test.for([{ payload: undefined }, { payload: { plugin: 'ext' } }, { payload: { plugin: 3, name: 'helper' } }])('unregistering with the malformed payload %j keeps the agent registered', async ({ payload }) => {
  const fixture = await workerFixture();
  try {
    fixture.eventBus.emit('pstack:register-agent', { plugin: 'ext', name: 'helper', spec: { description: 'Runtime helper', prompt: 'Help.' } });
    fixture.eventBus.emit('pstack:unregister-agent', payload);
    expect((await launch(fixture, 'ext:helper')).details).toMatchObject({ status: 'completed', agentType: 'ext:helper' });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('the add-dir flag lists several extra project directories separated by the path delimiter', async () => {
  const fixture = await workerFixture({ flags: { 'add-dir': `one${delimiter}${delimiter}two` } });
  try {
    await put(fixture, 'one/.pi/agents/first.md', '---\nname: first\ndescription: From one\n---\nOne.');
    await put(fixture, 'two/.claude/agents/second.md', '---\nname: second\ndescription: From two\n---\nTwo.');
    expect((await launch(fixture, 'first')).details).toMatchObject({ status: 'completed', agentType: 'first' });
    expect((await launch(fixture, 'second')).details).toMatchObject({ status: 'completed', agentType: 'second' });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('the agents flag supplies JSON-defined agents', async () => {
  const fixture = await workerFixture({ flags: { agents: JSON.stringify({ flagged: { description: 'Flag agent', prompt: 'Flag.' } }) } });
  try {
    expect((await launch(fixture, 'flagged')).details).toMatchObject({ status: 'completed', agentType: 'flagged' });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});
