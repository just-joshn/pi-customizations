import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Check } from 'typebox/value';
import { expect, test } from 'vitest';
import { depthStore } from '../src/subagents/context.ts';
import { buildAgentSchema } from '../src/subagents/schema.ts';
import { registerWorkers } from '../src/workers.ts';
import { workerFixture } from './worker-fixture.ts';

function registered(depth: number): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const pi = { appendEntry() {}, on() {}, registerTool: (tool: ToolDefinition) => tools.push(tool) } as unknown as ExtensionAPI;
  depthStore.run(depth, () => registerWorkers(pi));
  return tools;
}

test('[G1-01] Agent schema exposes exactly the offered properties in order', () => {
  const schema = buildAgentSchema() as unknown as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
  expect(Object.keys(schema.properties)).toEqual(['description', 'prompt', 'subagent_type', 'model', 'run_in_background', 'isolation']);
  expect(schema.required).toEqual(['description', 'prompt']);
  expect(schema.additionalProperties).toBe(false);
  expect(Check(buildAgentSchema(), { description: 'd', prompt: 'p', readonly: true })).toBe(false);
  expect(Check(buildAgentSchema(), { description: 'd', prompt: 'p', effort: 'high' })).toBe(false);
  expect(Check(buildAgentSchema(), { description: 'd', prompt: 'p' })).toBe(true);
});

test('[G1-02] parameter validation and descriptions', () => {
  const schema = buildAgentSchema() as unknown as { properties: Record<string, { description?: string; anyOf?: { const: string }[] }> };
  expect(schema.properties.description?.description).toBe('A short (3-5 word) description of the task');
  expect(schema.properties.prompt?.description).toBe('The task for the agent to perform');
  expect(schema.properties.subagent_type?.description).toBe('The type of specialized agent to use for this task');
  expect(schema.properties.model?.anyOf?.map((entry) => entry.const)).toEqual(['sonnet', 'opus', 'haiku', 'fable']);
  expect(schema.properties.model?.description).toContain("Takes precedence over the agent definition's model frontmatter");
  expect(schema.properties.run_in_background?.description?.startsWith('Agents run in the background by default')).toBe(true);
  expect(Check(buildAgentSchema(), { description: 'd', prompt: 'p', isolation: 'docker' })).toBe(false);
  expect(Check(buildAgentSchema(), { description: 'd' })).toBe(false);
  expect(Check(buildAgentSchema(), { description: 'one two three four five six seven eight nine ten', prompt: 'p' })).toBe(true);
});

test('[G1-03] headless and forced model drop their fields and cwd is never offered', () => {
  const keys = (options: Parameters<typeof buildAgentSchema>[0]) => Object.keys((buildAgentSchema(options) as unknown as { properties: object }).properties);
  expect(keys({ headless: true })).not.toContain('run_in_background');
  expect(keys({ forceModel: true })).not.toContain('model');
  expect(keys({})).not.toContain('cwd');
  expect(keys({})).not.toContain('team_name');
  expect(keys({})).not.toContain('mode');
});

test('[G1-12] children at the depth cap lack the Agent tool', () => {
  const names = (depth: number) => registered(depth).map((tool) => tool.name);
  expect(names(2)).toContain('Agent');
  expect(names(3)).not.toContain('Agent');
  expect(names(3)).toContain('Task');
});

test('[G1-07] foreground Agent returns the completed shape and background returns async_launched', async () => {
  const { call, close } = await workerFixture();
  try {
    const done = (await call('Agent', { description: 'probe', prompt: 'hello', run_in_background: false })) as { details: Record<string, unknown>; content: { text: string }[] };
    expect(done.details).toMatchObject({ status: 'completed', agentType: 'general-purpose', totalToolUseCount: 0, totalTokens: 5 });
    expect(done.details.content).toEqual([{ type: 'text', text: 'users=1' }]);
    expect(done.content[0]?.text).toContain('users=1');

    const launched = (await call('Agent', { description: 'probe two', prompt: 'hello again' })) as { details: Record<string, unknown> };
    expect(Object.keys(launched.details).toSorted()).toEqual(['agentId', 'canReadOutputFile', 'description', 'outputFile', 'prompt', 'resolvedModel', 'status'].toSorted());
    expect(launched.details.status).toBe('async_launched');
    const finished = (await call('TaskOutput', { task_id: launched.details.agentId, block: true })) as { details: { output: string } };
    expect(finished.details.output).toBe('users=1');
    expect(await readFile(String(launched.details.outputFile), 'utf8')).toBe('users=1');
  } finally {
    await close();
  }
});

test('[G1-10] unknown agent type is a tool error that starts no child', async () => {
  const { call, close } = await workerFixture();
  try {
    await expect(call('Agent', { description: 'x', prompt: 'p', subagent_type: 'does-not-exist' })).rejects.toThrow(/^Agent type 'does-not-exist' not found\. Available agents: Explore, Plan, general-purpose, statusline-setup$/);
    const listed = (await call('ListAgents', {})) as { details: { agents: unknown[] } };
    expect(listed.details.agents).toEqual([]);
  } finally {
    await close();
  }
});

test('[G1-09] SendMessage resumes a finished agent by id and ListAgents reports it', async () => {
  const { call, close, dir } = await workerFixture();
  try {
    const first = (await call('Agent', { description: 'probe', prompt: 'one', run_in_background: false })) as { details: { agentId: string } };
    const sent = (await call('SendMessage', { to: first.details.agentId, message: 'two' })) as { details: { success: boolean; message: string } };
    expect(sent.details).toEqual({ success: true, message: `Agent ${first.details.agentId} resumed in the background` });
    await call('TaskOutput', { task_id: first.details.agentId, block: true });
    const listed = (await call('ListAgents', {})) as { details: { agents: { agentId: string; agentType: string; status: string }[] } };
    expect(listed.details.agents).toEqual([{ agentId: first.details.agentId, agentType: 'general-purpose', status: 'settled', description: 'probe' }]);
    expect(await readFile(join(dir, 'provider-inputs.jsonl'), 'utf8')).toContain('two');
    await expect(call('SendMessage', { to: 'nobody', message: 'x' })).rejects.toThrow('No agent found with ID or name: nobody');
  } finally {
    await close();
  }
});

async function gitFixture() {
  const fixture = await workerFixture();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture.dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 'n');
  git('add', 'settings.json');
  git('commit', '-qm', 'init');
  return { ...fixture, git };
}

test.each(['worktree', 'remote'] as const)('[G1-04] isolation %s runs the child in an agent worktree that is removed when unchanged', async (isolation) => {
  const { call, close, git } = await gitFixture();
  try {
    const done = (await call('Agent', { description: 'iso', prompt: 'hello', run_in_background: false, isolation })) as { details: { agentId: string; worktreePath?: string } };
    expect(done.details.worktreePath).toBeUndefined();
    const listed = (await call('TaskOutput', { task_id: done.details.agentId })) as { details: { cwd: string } };
    expect(listed.details.cwd).toMatch(/\.pi\/worktrees\/agent-[0-9a-f]{8}$/);
    expect(existsSync(listed.details.cwd)).toBe(false);
    expect(git('status', '--porcelain')).not.toContain('.pi');
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
  } finally {
    await close();
  }
});

test('[G1-04] remote isolation outside git falls back to the caller directory', async () => {
  const { call, close, dir } = await workerFixture();
  try {
    const done = (await call('Agent', { description: 'iso', prompt: 'hello', run_in_background: false, isolation: 'remote' })) as { details: { agentId: string } };
    const record = (await call('TaskOutput', { task_id: done.details.agentId })) as { details: { cwd: string } };
    expect(record.details.cwd).toBe(realpathSync(dir));
  } finally {
    await close();
  }
});
