import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Check } from 'typebox/value';
import { expect, test, vi } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { buildAgentSchema } from '../src/subagents/schema.ts';
import { workerFixture } from './worker-fixture.ts';

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
  expect(schema.properties.subagent_type).not.toHaveProperty('enum');
  expect(schema.properties.subagent_type).not.toHaveProperty('anyOf');
  expect(schema.properties.description).not.toHaveProperty('minLength');
  expect(schema.properties.description).not.toHaveProperty('maxLength');
  expect(schema.properties.run_in_background).toHaveProperty('type', 'boolean');
  expect(schema.properties.run_in_background).not.toHaveProperty('default');
  expect(schema.properties.model?.description).toContain('Ignored for subagent_type: "fork"');
  expect(schema.properties.model?.description).toContain("Takes precedence over the agent definition's model frontmatter");
  expect(schema.properties.run_in_background?.description?.startsWith('Agents run in the background by default')).toBe(true);
  expect(Check(buildAgentSchema(), { description: 'd', prompt: 'p', isolation: 'docker' })).toBe(false);
  expect(Check(buildAgentSchema(), { description: 'd', prompt: 'p', isolation: 'remote' })).toBe(false);
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
    const finished = (await call('TaskOutput', { task_id: launched.details.agentId, block: true })) as { details: { output: string; sessionFile: string; outputFile: string } };
    expect(finished.details.output).toBe('users=1');
    expect(launched.details.outputFile).toBe(finished.details.sessionFile);
    expect(await readFile(finished.details.outputFile, 'utf8')).toBe('users=1');
  } finally {
    await close();
  }
});

test('[G1-10] unknown agent type is a tool error that starts no child', async () => {
  const { call, close } = await workerFixture();
  try {
    await expect(call('Agent', { description: 'x', prompt: 'p', subagent_type: 'does-not-exist' })).rejects.toMatchObject({
      name: 'AgentTypeError',
      code: 'subagent_type_not_found',
      message: "Agent type 'does-not-exist' not found. Available agents: Explore, Plan, claude-code-guide, general-purpose, statusline-setup",
    });
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

test('[G1-04] worktree isolation runs the child in an agent worktree that is removed when unchanged', async () => {
  const { call, close, git, session } = await gitFixture();
  try {
    const done = (await call('Agent', { description: 'iso', prompt: 'hello', run_in_background: false, isolation: 'worktree' })) as { details: { agentId: string; worktreePath?: string } };
    expect(done.details.worktreePath).toBeUndefined();
    expect(done.details).toMatchObject({ requestedIsolation: 'worktree', effectiveIsolation: 'worktree' });
    const listed = (await call('TaskOutput', { task_id: done.details.agentId })) as { details: { cwd: string } };
    expect(listed.details.cwd).toMatch(/\.pi\/worktrees\/agent-[0-9a-f]{8}$/);
    expect(existsSync(listed.details.cwd)).toBe(false);
    expect(listed.details).toMatchObject({ spawnedWithWorktree: true, worktreeCleanlyRemoved: true });
    expect(listed.details).not.toHaveProperty('worktreePath');
    await session.prompt('persist parent metadata');
    const file = session.sessionManager.getSessionFile();
    if (!file) throw new Error('Missing persisted parent session');
    const entries = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)) as { type: string; customType?: string; data?: unknown }[];
    const metadata = entries.findLast((entry) => entry.type === 'custom' && entry.customType === 'pstack-task')?.data;
    expect(metadata).toMatchObject({ spawnedWithWorktree: true, worktreeCleanlyRemoved: true });
    expect(metadata).not.toHaveProperty('worktreePath');
    expect(git('status', '--porcelain')).not.toContain('.pi');
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
  } finally {
    await close();
  }
});

test('[G1-04] a real child edit with worktree isolation retains result and durable cleanup metadata', async () => {
  const { call, close, dir, git } = await gitFixture();
  try {
    const done = await call('Agent', { description: 'isolated edit', prompt: 'WORKTREE_WRITE', isolation: 'worktree', run_in_background: false });
    const details = done.details as { agentId: string; worktreePath: string; worktreeBranch: string };
    expect(await readFile(join(details.worktreePath, 'child-change.txt'), 'utf8')).toBe('isolated-change');
    expect(existsSync(join(dir, 'child-change.txt'))).toBe(false);
    expect(git('branch', '--list', details.worktreeBranch)).toContain(details.worktreeBranch);
    const record = await call('TaskOutput', { task_id: details.agentId });
    expect(record.details).toMatchObject({ spawnedWithWorktree: true, worktreeCleanlyRemoved: false, worktreePath: details.worktreePath, worktreeBranch: details.worktreeBranch });
  } finally {
    await close();
  }
});

test('a retained isolated Agent resumes in its verified worktree', async () => {
  const { call, close } = await gitFixture();
  try {
    const first = await call('Agent', { description: 'retained resume', prompt: 'WORKTREE_WRITE', isolation: 'worktree', run_in_background: false });
    const details = first.details as { agentId: string; worktreePath: string };
    const before = statSync(details.worktreePath).mtimeMs;
    await call('SendMessage', { to: details.agentId, message: 'resume retained' });
    const done = await call('TaskOutput', { task_id: details.agentId, block: true });
    expect(done.details).toMatchObject({ status: 'settled', cwd: details.worktreePath, worktreePath: details.worktreePath });
    expect(statSync(details.worktreePath).mtimeMs).toBeGreaterThan(before);
  } finally {
    await close();
  }
});

test('resume refuses a retained checkout whose recorded branch changed', async () => {
  const { call, close } = await gitFixture();
  try {
    const first = await call('Agent', { description: 'changed binding', prompt: 'WORKTREE_WRITE', isolation: 'worktree', run_in_background: false });
    const details = first.details as { agentId: string; worktreePath: string };
    execFileSync('git', ['checkout', '-qb', 'changed-resume-branch'], { cwd: details.worktreePath });
    await expect(call('SendMessage', { to: details.agentId, message: 'must not run' })).rejects.toThrow('its worktree could not be verified');
    expect((await call('TaskOutput', { task_id: details.agentId })).details).toMatchObject({ status: 'settled', worktreePath: details.worktreePath });
  } finally {
    await close();
  }
});

test('resume after clean removal never silently runs in the parent checkout', async () => {
  const { call, close } = await gitFixture();
  try {
    const first = await call('Agent', { description: 'clean binding', prompt: 'clean', isolation: 'worktree', run_in_background: false });
    const details = first.details as { agentId: string };
    await expect(call('SendMessage', { to: details.agentId, message: 'must not run' })).rejects.toThrow('its worktree was cleanly removed');
    expect((await call('TaskOutput', { task_id: details.agentId })).details).toMatchObject({ status: 'settled', spawnedWithWorktree: true, worktreeCleanlyRemoved: true });
  } finally {
    await close();
  }
});

test('[G6-19] failed clean-removal metadata persistence emits the required diagnostic', async () => {
  const { call, close, subagentLogs } = await gitFixture();
  const append = SessionManager.prototype.appendCustomEntry;
  let injected = false;
  const persist = vi.spyOn(SessionManager.prototype, 'appendCustomEntry').mockImplementation(function (this: SessionManager, type: string, data?: unknown) {
    if (!injected && type === 'pstack-task' && data && typeof data === 'object' && 'worktreeCleanlyRemoved' in data && data.worktreeCleanlyRemoved === true) {
      injected = true;
      throw new Error('metadata-write-failure');
    }
    return append.call(this, type, data);
  });
  try {
    const done = await call('Agent', { description: 'metadata failure', prompt: 'clean', isolation: 'worktree', run_in_background: false });
    expect(done.details).toMatchObject({ status: 'completed' });
    expect(injected).toBe(true);
    expect(subagentLogs).toContain('Failed to clear worktree metadata: Error: metadata-write-failure');
  } finally {
    persist.mockRestore();
    await close();
  }
});

test('[G1-04] remote isolation fails closed instead of falling back to local or worktree execution', async () => {
  const { call, close, git } = await gitFixture();
  try {
    await expect(call('Agent', { description: 'iso', prompt: 'hello', run_in_background: false, isolation: 'remote' })).rejects.toThrow('Remote agent execution is not available in this runtime');
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
  } finally {
    await close();
  }
});

test('a running foreground Agent is not counted twice against the concurrency cap', async () => {
  vi.stubEnv('PI_MAX_CONCURRENT_SUBAGENTS', '2');
  const { call, close } = await workerFixture();
  let second: ReturnType<typeof call> | undefined;
  try {
    await call('Agent', { description: 'foreground slot', prompt: 'PROGRESS_READ', run_in_background: false }, undefined, false, () => {
      second ??= call('Agent', { description: 'remaining slot', prompt: 'WAIT' });
    });
    expect(second).toBeDefined();
    expect((await second)?.details).toMatchObject({ status: 'async_launched' });
  } finally {
    await close();
  }
});

test('failed Agent setup releases its startup reservation', async () => {
  vi.stubEnv('PI_MAX_CONCURRENT_SUBAGENTS', '1');
  const { call, close } = await workerFixture();
  try {
    await expect(call('Agent', { description: 'fails isolation', prompt: 'never runs', isolation: 'worktree' })).rejects.toThrow('not in a git repository');
    const valid = await call('Agent', { description: 'slot released', prompt: 'healthy', run_in_background: false });
    expect(valid.details).toMatchObject({ status: 'completed', content: [{ type: 'text', text: 'users=1' }] });
  } finally {
    await close();
  }
});

test.each([
  ['PI_MAX_CONCURRENT_SUBAGENTS', 'Concurrent subagent limit reached'],
  ['PI_MAX_SUBAGENTS_PER_SESSION', 'Session subagent limit reached'],
])('Agent startup reserves admission before asynchronous setup for %s', async (limit, refusal) => {
  vi.stubEnv(limit, '1');
  const { call, close } = await workerFixture();
  try {
    const launches = await Promise.allSettled([call('Agent', { description: 'first slot', prompt: 'WAIT' }), call('Agent', { description: 'second slot', prompt: 'WAIT' })]);
    expect(launches.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    const rejected = launches[1];
    expect(rejected?.status === 'rejected' ? String(rejected.reason) : '').toContain(refusal);
  } finally {
    await close();
  }
});

test.each([
  ['w1', 'W1'],
  ['explore', 'EXPLORE'],
])('[G1-06] internal name %s routes messages without selecting an agent type', async (name, recipient) => {
  const { call, close } = await workerFixture();
  try {
    const first = await call('Agent', { description: 'named worker', prompt: 'first', name, run_in_background: false });
    const { agentId } = first.details as { agentId: string };
    expect(first.details).toMatchObject({ agentType: 'general-purpose' });
    expect((await call('ListAgents', {})).details).toMatchObject({ agents: [{ agentId, name, agentType: 'general-purpose' }] });
    await call('SendMessage', { to: recipient, message: 'second' });
    expect((await call('TaskOutput', { task_id: agentId, block: true })).details).toMatchObject({ status: 'settled', agentName: name, output: 'users=2' });
  } finally {
    await close();
  }
});

test('TaskStop resolves a running Agent by its registered name', async () => {
  const { call, close } = await workerFixture();
  try {
    const first = await call('Agent', { description: 'named stop', prompt: 'WAIT_BLOCKED', name: 'named-worker' });
    const { agentId } = first.details as { agentId: string };
    const stopped = await call('TaskStop', { task_id: 'NAMED-WORKER' });
    expect(stopped.details).toMatchObject({ task_id: agentId, agentName: 'named-worker', status: 'interrupted', command: 'named stop' });
  } finally {
    await close();
  }
});

test('[G1-06] internal invalid name is rejected before child creation', async () => {
  const { call, close } = await workerFixture();
  try {
    await expect(call('Agent', { description: 'invalid name', prompt: 'never runs', name: '-a' })).rejects.toThrow('name must start with a letter or digit');
    expect((await call('ListAgents', {})).details).toEqual({ agents: [] });
  } finally {
    await close();
  }
});

test.for(['main', 'a0123456789abcdef', 'aworker-0123456789abcdef'])('[G1-06] reserved routing name %s refuses without creating a child', async (name) => {
  const { call, close } = await workerFixture();
  try {
    const message = name === 'main'
      ? '"main" is reserved \u2014 SendMessage routes it to the main conversation'
      : 'name must not be a reserved name ("main", "team-lead", "user" or "system", in any spelling) or have the shape of an agent id \u2014 those already address an agent directly';
    await expect(call('Agent', { description: 'reserved name', prompt: 'never runs', name })).rejects.toMatchObject({ name: 'AgentPreconditionError', code: 'subagent_name_invalid', message });
    expect((await call('ListAgents', {})).details).toEqual({ agents: [] });
  } finally {
    await close();
  }
});

test('[G2-12] normalized project type dispatches its definition and records normalization', async () => {
  const { call, close, dir, normalizedTypes } = await workerFixture();
  try {
    mkdirSync(join(dir, '.pi/agents'), { recursive: true });
    writeFileSync(join(dir, '.pi/agents/review.md'), '---\nname: review_worker\ndescription: reviews\n---\nNORMALIZED_REVIEW_PROMPT\n');
    clearAgentCache();
    const done = await call('Agent', { description: 'normalized', prompt: 'go', subagent_type: 'Review Worker', run_in_background: false });
    expect(done.details).toMatchObject({ status: 'completed', agentType: 'review_worker' });
    expect(await readFile(join(dir, 'child-system.txt'), 'utf8')).toContain('NORMALIZED_REVIEW_PROMPT');
    expect(normalizedTypes).toEqual([{ requested: 'Review Worker', resolved: 'review_worker' }]);
  } finally {
    clearAgentCache();
    await close();
  }
});

test('[G2-13] unknown type rejects before creating a child and leaves the host usable', async () => {
  const { call, close, dir } = await workerFixture();
  try {
    await expect(call('Agent', { description: 'unknown', prompt: 'never runs', subagent_type: 'missing-type' })).rejects.toThrow("Agent type 'missing-type' not found. Available agents:");
    expect(existsSync(join(dir, 'child-input.txt'))).toBe(false);
    expect((await call('ListAgents', {})).details).toEqual({ agents: [] });
    const valid = await call('Agent', { description: 'host still works', prompt: 'after refusal', run_in_background: false });
    expect(valid.details).toMatchObject({ status: 'completed', content: [{ type: 'text', text: 'users=1' }] });
  } finally {
    await close();
  }
});

test('background remote request fails explicitly instead of launching a local agent', async () => {
  const { call, close } = await workerFixture();
  try {
    await expect(call('Agent', { description: 'remote request', prompt: 'WAIT', isolation: 'remote' })).rejects.toThrow('Remote agent execution is not available in this runtime');
  } finally {
    await close();
  }
});

test('[G2-24] an agent whose tools resolve to nothing is refused and starts no child', async () => {
  const { call, close, dir } = await workerFixture();
  try {
    mkdirSync(join(dir, '.pi/agents'), { recursive: true });
    writeFileSync(join(dir, '.pi/agents/empty.md'), '---\nname: empty\ndescription: no tools\ntools: Nope\n---\nbody\n');
    clearAgentCache();
    await expect(call('Agent', { description: 'x', prompt: 'p', subagent_type: 'empty', run_in_background: false })).rejects.toThrow('Its tools list resolved to nothing: unrecognized [Nope]');
    const listed = (await call('ListAgents', {})) as { details: { agents: unknown[] } };
    expect(listed.details.agents).toEqual([]);
  } finally {
    clearAgentCache();
    await close();
  }
});

test('[G2-01] a project agent file is dispatchable by name and its body becomes the child system prompt', async () => {
  const { call, close, dir } = await workerFixture();
  try {
    mkdirSync(join(dir, '.claude/agents'), { recursive: true });
    writeFileSync(join(dir, '.claude/agents/reviewer.md'), '---\nname: reviewer\ndescription: reviews\ntools: Read\n---\nREVIEWER_PROMPT_SENTINEL\n');
    clearAgentCache();
    const done = (await call('Agent', { description: 'review', prompt: 'go', subagent_type: 'reviewer', run_in_background: false })) as { details: { agentType: string } };
    expect(done.details.agentType).toBe('reviewer');
    expect(await readFile(join(dir, 'child-system.txt'), 'utf8')).toContain('REVIEWER_PROMPT_SENTINEL');
  } finally {
    clearAgentCache();
    await close();
  }
});

test('[G2-07] definition maxTurns interrupts the foreground child at the configured limit', async () => {
  const { call, close, dir } = await workerFixture();
  try {
    mkdirSync(join(dir, '.pi/agents'), { recursive: true });
    writeFileSync(join(dir, '.pi/agents/short.md'), '---\nname: short\ndescription: one turn\nmaxTurns: 1\n---\nbody\n');
    clearAgentCache();
    const done = await call('Agent', { description: 'short', prompt: 'PROGRESS_READ limit', subagent_type: 'short', run_in_background: false });
    expect(done.details).toMatchObject({
      status: 'completed',
      content: [{ type: 'text', text: 'NOTE: this agent stopped at its 1-turn limit before finishing. It was still calling tools and had produced no report. Send the agent a message (SendMessage) to let it continue from where it stopped.\n' }],
      harnessNoteCount: 1,
    });
    const listed = (await call('ListAgents', {})) as { details: { agents: { status: string }[] } };
    expect(listed.details.agents.map((agent) => agent.status)).toEqual(['settled']);
  } finally {
    clearAgentCache();
    await close();
  }
});
