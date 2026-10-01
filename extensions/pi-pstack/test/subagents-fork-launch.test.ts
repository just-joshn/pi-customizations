import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { forkResumeMessage } from '../src/subagents/fork-session.ts';
import { workerFixture } from './worker-fixture.ts';

type Fixture = Awaited<ReturnType<typeof workerFixture>>;
type Request = { model: string; messages: { role: string; content?: unknown }[] };

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

beforeEach(() => {
  vi.stubEnv('CLAUDE_CODE_FORK_SUBAGENT', '1');
});
afterEach(() => {
  clearAgentCache();
});

function seedParent(fixture: Fixture): void {
  const manager = fixture.session.sessionManager;
  manager.appendMessage({ role: 'user', content: 'PARENT_QUESTION', timestamp: 1 });
  manager.appendMessage({ role: 'assistant', api: 'openai-completions', provider: 'worker-test', model: 'deterministic', content: [{ type: 'text', text: 'PARENT_ANSWER' }], stopReason: 'stop', timestamp: 2, usage });
  manager.appendMessage({ role: 'user', content: 'PARENT_FOLLOWUP', timestamp: 3 });
  manager.appendMessage({
    role: 'assistant',
    api: 'openai-completions',
    provider: 'worker-test',
    model: 'deterministic',
    content: [{ type: 'toolCall', id: 'in-flight-agent', name: 'Agent', arguments: {} }],
    stopReason: 'toolUse',
    timestamp: 4,
    usage,
  });
}

async function lastRequest(fixture: Fixture): Promise<Request> {
  const lines = (await readFile(join(fixture.dir, 'child-requests.jsonl'), 'utf8')).trim().split('\n');
  return JSON.parse(lines.at(-1) ?? '{}') as Request;
}

async function launchFork(fixture: Fixture, extra: Record<string, unknown> = {}) {
  seedParent(fixture);
  const launched = (await fixture.call('Agent', { description: 'fork probe', prompt: 'FORK_DIRECTIVE_TEXT', subagent_type: 'fork', ...extra })) as { details: { status: string; agentId: string } };
  await fixture.call('TaskOutput', { task_id: launched.details.agentId, block: true });
  return launched.details;
}

test('[B31][B38] fork launches asynchronously even when run_in_background is false and the schema omits the field', async () => {
  const fixture = await workerFixture();
  try {
    const details = await launchFork(fixture, { run_in_background: false });
    expect(details.status).toBe('async_launched');
    const schemas = JSON.parse(await readFile(join(fixture.dir, 'tool-schemas.json'), 'utf8')) as Record<string, { properties: Record<string, unknown> }>;
    expect(Object.keys(schemas.Agent?.properties ?? {})).not.toContain('run_in_background');
  } finally {
    await fixture.close();
  }
});

test('[B32][A98] a fork ignores the model override and uses the parent model', async () => {
  const fixture = await workerFixture();
  try {
    await launchFork(fixture, { model: 'haiku' });
    expect((await lastRequest(fixture)).model).toBe('deterministic');
  } finally {
    await fixture.close();
  }
});

test('[B35][B36] the fork child sees the repaired parent conversation then the directive', async () => {
  const fixture = await workerFixture();
  try {
    await launchFork(fixture);
    const { messages } = await lastRequest(fixture);
    const conversation = messages.filter((message) => message.role !== 'system');
    const text = (message: { content?: unknown }) => (typeof message.content === 'string' ? message.content : (message.content as { text?: string }[]).map((block) => block.text ?? '').join(''));
    expect(conversation.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'user']);
    expect(text(conversation[0] ?? {})).toBe('PARENT_QUESTION');
    expect(text(conversation[1] ?? {})).toContain('PARENT_ANSWER');
    expect(text(conversation[2] ?? {})).toBe('PARENT_FOLLOWUP');
    expect(text(conversation[3] ?? {})).toMatch(/^<fork-boilerplate>[\s\S]*<\/fork-boilerplate>\nYour directive: FORK_DIRECTIVE_TEXT$/);
    expect(JSON.stringify(messages)).not.toContain('in-flight-agent');
  } finally {
    await fixture.close();
  }
});

test('[B33] the fork child system prompt is the parent rendered prompt', async () => {
  const fixture = await workerFixture();
  try {
    const parentPrompt = fixture.session.systemPrompt;
    await launchFork(fixture);
    const system = await readFile(join(fixture.dir, 'child-system.txt'), 'utf8');
    expect(system).toContain(JSON.stringify(parentPrompt.slice(0, 200)).slice(1, -1));
  } finally {
    await fixture.close();
  }
});

test('[B34] the fork child receives exactly the parent active tool pool', async () => {
  const fixture = await workerFixture();
  try {
    fixture.session.setActiveToolsByName(['read', 'Agent', 'TaskOutput']);
    await launchFork(fixture);
    expect(JSON.parse(await readFile(join(fixture.dir, 'child-tools.txt'), 'utf8')).toSorted()).toEqual(['Agent', 'TaskOutput', 'read']);
  } finally {
    await fixture.close();
  }
});

test('[B39] the fork transcript records its parent attribution', async () => {
  const fixture = await workerFixture();
  try {
    const details = await launchFork(fixture);
    const output = (await fixture.call('TaskOutput', { task_id: details.agentId })) as { details: { sessionFile: string } };
    const transcript = await readFile(output.details.sessionFile, 'utf8');
    const entry = transcript.split('\n').filter(Boolean).map((line) => JSON.parse(line) as { type: string; customType?: string; data?: unknown }).find((line) => line.customType === 'pstack-fork');
    expect(entry?.data).toMatchObject({ parentSessionId: fixture.session.sessionManager.getSessionId(), tools: expect.any(Array) });
  } finally {
    await fixture.close();
  }
});

test('[A74] a fork cannot launch another fork', async () => {
  const fixture = await workerFixture();
  try {
    seedParent(fixture);
    fixture.session.sessionManager.appendMessage({ role: 'user', content: '<fork-boilerplate>\nYou are a worker fork.\n</fork-boilerplate>\nYour directive: x', timestamp: 5 });
    await expect(fixture.call('Agent', { description: 'again', prompt: 'p', subagent_type: 'fork' })).rejects.toMatchObject({ code: 'subagent_recursive_fork' });
  } finally {
    await fixture.close();
  }
});

test('[A74] fork is not found when the gate is off', async () => {
  vi.stubEnv('CLAUDE_CODE_FORK_SUBAGENT', '0');
  const fixture = await workerFixture();
  try {
    await expect(fixture.call('Agent', { description: 'x', prompt: 'p', subagent_type: 'fork' })).rejects.toMatchObject({ code: 'subagent_type_not_found' });
  } finally {
    await fixture.close();
  }
});

test('[B94] resuming a fork restores the parent prompt and a missing prompt is refused', async () => {
  const fixture = await workerFixture();
  try {
    const details = await launchFork(fixture);
    const resumed = (await fixture.call('SendMessage', { to: details.agentId, message: 'RESUME_FORK_FOLLOWUP' })) as { details: { success: boolean } };
    expect(resumed.details.success).toBe(true);
    await fixture.call('TaskOutput', { task_id: details.agentId, block: true });
    const request = await lastRequest(fixture);
    expect(JSON.stringify(request.messages)).toContain('RESUME_FORK_FOLLOWUP');
    expect(JSON.stringify(request.messages)).toContain('PARENT_ANSWER');
    expect(forkResumeMessage('abc')).toBe("Cannot resume fork abc: the parent's rendered system prompt was not recorded in its transcript and cannot be reconstructed.");
  } finally {
    await fixture.close();
  }
});

test('[B94] resuming a fork whose parent prompt was not recorded is refused', async () => {
  const fixture = await workerFixture();
  try {
    const details = await launchFork(fixture);
    const output = (await fixture.call('TaskOutput', { task_id: details.agentId })) as { details: { sessionFile: string } };
    const lines = (await readFile(output.details.sessionFile, 'utf8')).split('\n').filter((line) => line && !line.includes('"pstack-fork"'));
    await writeFile(output.details.sessionFile, `${lines.join('\n')}\n`);
    await expect(fixture.call('SendMessage', { to: details.agentId, message: 'x' })).rejects.toMatchObject({ name: 'ResumeAgentStateError', message: forkResumeMessage(details.agentId) });
  } finally {
    await fixture.close();
  }
});
