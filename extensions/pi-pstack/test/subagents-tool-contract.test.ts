import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { validateToolArguments } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { TaskSchema } from '../src/subagents/agent-tools.ts';
import { boardPath, readBoard } from '../src/subagents/context-board.ts';
import { boundedForModel } from '../src/subagents/tool-results.ts';
import { workerFixture } from './worker-fixture.ts';

type Result = { content: { text: string }[]; details: Record<string, unknown>; structuredContent?: unknown; usage?: { input: number; output: number; totalTokens: number } };
const idOf = (result: unknown) => String((result as Result).details.agent_id);

test('each subagent tool returns the structuredContent its outputSchema promises', async () => {
  const fixture = await workerFixture();
  try {
    const started = (await fixture.call('task', { agent_type: 'general-purpose', name: 'probe', description: 'probe', prompt: 'one', mode: 'background' })) as Result;
    expect(started.structuredContent).toEqual(started.details);
    const id = idOf(started);
    const read = (await fixture.call('read_agent', { agent_id: id, wait: true, timeout: 30 })) as Result;
    expect(read.structuredContent).toEqual({ agent_id: id, agent_type: 'general-purpose', status: 'idle', mode: 'background' });
    const sent = (await fixture.call('write_agent', { agent_id: id, message: 'two' })) as Result;
    expect(sent.structuredContent).toEqual(sent.details);
    await fixture.call('read_agent', { agent_id: id, wait: true, timeout: 30 });
    const listed = (await fixture.call('list_agents', {})) as Result;
    expect(listed.structuredContent).toEqual({ agents: [{ agent_id: id, agent_type: 'general-purpose', status: 'idle', mode: 'background' }] });
  } finally {
    await fixture.close();
  }
});
test('a sync task reports the usage of its nested model calls so Pi can total them', async () => {
  const fixture = await workerFixture();
  try {
    const result = (await fixture.call('task', { agent_type: 'general-purpose', name: 'probe', description: 'probe', prompt: 'hello', mode: 'sync' })) as Result;
    expect(result.usage).toMatchObject({ input: 2, output: 3, totalTokens: 5 });
  } finally {
    await fixture.close();
  }
});
test('the context board returns its entries as structured content', async () => {
  const fixture = await workerFixture();
  try {
    const written = (await fixture.call('context_board', { action: 'write', key: 'rule', value: 'native first' })) as Result;
    expect(written.structuredContent).toEqual({ board: { rule: 'native first' } });
    expect(readBoard(boardPath(fixture.dir, fixture.dir))).toEqual({ rule: 'native first' });
  } finally {
    await fixture.close();
  }
});
test.for([
  { name: 'a valid call', mode: 'background', valid: true },
  { name: 'an unknown mode', mode: 'eventually', valid: false },
])('Pi validates the task schema for $name', ({ mode, valid }) => {
  const call = { type: 'toolCall' as const, id: 'call', name: 'task', arguments: { agent_type: 'explore', name: 'n', description: 'd', prompt: 'p', mode } };
  const validate = () => validateToolArguments({ name: 'task', description: 'task', parameters: TaskSchema }, call);
  if (valid) expect(validate()).toMatchObject({ mode });
  else expect(validate).toThrow(/mode/);
});
test('a long reply keeps its head within Pi limits and names the transcript', () => {
  const reply = Array.from({ length: 3000 }, (_, index) => `line ${index}`).join('\n');
  const bounded = boundedForModel(reply, '/sessions/agent-a.jsonl');
  const lines = bounded.split('\n');
  expect(lines[0]).toBe('line 0');
  expect(lines.some((line) => line.startsWith('line 2000'))).toBe(false);
  expect(bounded).toContain("The agent's full transcript is at /sessions/agent-a.jsonl.");
  expect(boundedForModel('short', '/sessions/agent-a.jsonl')).toBe('short');
});
test('a child writes files while its parent has a write tool active', async () => {
  const fixture = await workerFixture();
  try {
    await fixture.call('task', { agent_type: 'general-purpose', name: 'writer', description: 'write a file', prompt: 'WORKTREE_WRITE', mode: 'sync' });
    expect(existsSync(join(fixture.dir, 'child-change.txt'))).toBe(true);
  } finally {
    await fixture.close();
  }
});
test('the tools that manage agents form one namespace', async () => {
  let api: ExtensionAPI | undefined;
  const fixture = await workerFixture({
    extensions: [
      (pi) => {
        api = pi;
      },
    ],
  });
  try {
    const grouped = (api?.getAllTools() ?? []).filter((tool) => tool.namespace?.name === 'subagents').map((tool) => tool.name);
    expect(grouped.toSorted()).toEqual(['list_agents', 'read_agent', 'task', 'write_agent']);
  } finally {
    await fixture.close();
  }
});
