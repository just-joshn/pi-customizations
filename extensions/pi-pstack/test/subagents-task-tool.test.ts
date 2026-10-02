import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

type Result = { content: { text: string }[]; details: Record<string, unknown> };
const textOf = (result: unknown) => (result as Result).content[0]?.text ?? '';
const detailsOf = (result: unknown) => (result as Result).details;

test('a sync task returns the child final message verbatim', async () => {
  const { call, close } = await workerFixture();
  try {
    const result = await call('task', { agent_type: 'general-purpose', name: 'probe', description: 'probe', prompt: 'hello', mode: 'sync' });
    expect(textOf(result)).toBe('users=1');
    expect(detailsOf(result)).toMatchObject({ agent_type: 'general-purpose', status: 'completed', mode: 'sync', detailedContent: 'users=1' });
  } finally {
    await close();
  }
});

test('a background task starts at once and read_agent waits for the idle turn', async () => {
  const { call, close } = await workerFixture();
  try {
    const started = await call('task', { agent_type: 'general-purpose', name: 'alpha', description: 'probe', prompt: 'WAIT hello', mode: 'background' });
    const id = String(detailsOf(started).agent_id);
    expect(textOf(started)).toContain(`Agent started in background with agent_id: ${id}. You'll be notified when it completes.`);
    expect(detailsOf(started).detailedContent).toBe(`Prompt to general-purpose agent (${id})\n\nWAIT hello`);
    const read = await call('read_agent', { agent_id: id, wait: true, timeout: 30 });
    expect(textOf(read)).toMatch(/^Agent is idle \(waiting for messages\)\.\nagent_id: .+\nagent_type: general-purpose\nstatus: idle\ndescription: probe\nelapsed: \d+s\ntotal_turns: 1\n\n\[Turn 0\]\nusers=1$/);
  } finally {
    await close();
  }
});

test('write_agent resumes an idle background agent for a second turn', async () => {
  const { call, close, dir } = await workerFixture();
  try {
    const started = await call('task', { agent_type: 'general-purpose', name: 'beta', description: 'probe', prompt: 'one', mode: 'background' });
    const id = String(detailsOf(started).agent_id);
    await call('read_agent', { agent_id: id, wait: true });
    const sent = await call('write_agent', { agent_id: id, message: 'two' });
    expect(textOf(sent)).toContain(`Message sent to agent ${id}.`);
    const read = await call('read_agent', { agent_id: id, wait: true, since_turn: 1 });
    expect(textOf(read)).toContain('total_turns: 2');
    expect(textOf(read)).toContain('[Turn 1]');
    expect(textOf(read)).not.toContain('[Turn 0]');
    expect(await readFile(join(dir, 'provider-inputs.jsonl'), 'utf8')).toContain('two');
  } finally {
    await close();
  }
});

test('list_agents reports started agents with their status', async () => {
  const { call, close } = await workerFixture();
  try {
    const started = await call('task', { agent_type: 'general-purpose', name: 'gamma', description: 'probe', prompt: 'one', mode: 'background' });
    const id = String(detailsOf(started).agent_id);
    await call('read_agent', { agent_id: id, wait: true });
    expect(textOf(await call('list_agents', {}))).toBe(`agent_id: ${id} | agent_type: general-purpose | name: gamma | mode: background | status: idle | description: probe`);
  } finally {
    await close();
  }
});
