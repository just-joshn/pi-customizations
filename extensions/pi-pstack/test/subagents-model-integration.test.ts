import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G3-05] child model switches preserve ordered distinct history and final resolved model', async () => {
  const { call, close, session } = await workerFixture();
  const parentModel = session.model;
  try {
    const done = await call('Agent', { description: 'model history', prompt: 'MODEL_SEQUENCE', run_in_background: false });
    expect(done.details).toMatchObject({ resolvedModel: 'worker-test/alternate', modelsUsed: ['worker-test/deterministic', 'worker-test/alternate'] });
    const { agentId } = done.details as { agentId: string };
    expect((await call('TaskOutput', { task_id: agentId })).details).toMatchObject({ modelReference: 'worker-test/alternate:off', modelsUsed: ['worker-test/deterministic', 'worker-test/alternate'] });
    expect(session.model).toBe(parentModel);
  } finally {
    await close();
  }
});

test('[G3-05] background launch reports the single model selected at that transition', async () => {
  const { call, close } = await workerFixture();
  try {
    const launched = await call('Agent', { description: 'background history', prompt: 'WAIT_BLOCKED' });
    expect(launched.details).toMatchObject({ status: 'async_launched', resolvedModel: 'worker-test/deterministic', modelsUsed: ['worker-test/deterministic'] });
  } finally {
    await close();
  }
});

test('[G3-04] unavailable full model steps within its family and emits one native resolution event', async () => {
  const { call, close, modelResolutions, session } = await workerFixture();
  const parentModel = session.model;
  try {
    const done = await call('Agent', { description: 'family fallback', prompt: 'resolve', model: 'worker-test/claude-opus-4', run_in_background: false });
    expect(done.details).toMatchObject({ resolvedModel: 'worker-test/claude-opus-5' });
    expect(modelResolutions).toEqual([{ requested: 'worker-test/claude-opus-4', resolved: 'worker-test/claude-opus-5', steppedFamily: true, droppedOverride: false }]);
    expect(session.model).toBe(parentModel);
  } finally {
    await close();
  }
});

test('[G3-04] a family without an available model inherits the parent and records the dropped override', async () => {
  const { call, close, modelResolutions, session } = await workerFixture();
  const parentModel = session.model;
  try {
    const done = await call('Agent', { description: 'family unavailable', prompt: 'inherit', model: 'worker-test/claude-haiku-9', run_in_background: false });
    expect(done.details).toMatchObject({ resolvedModel: 'worker-test/deterministic' });
    expect(modelResolutions).toEqual([{ requested: 'worker-test/claude-haiku-9', resolved: 'worker-test/deterministic', steppedFamily: false, droppedOverride: true }]);
    expect(session.model).toBe(parentModel);
  } finally {
    await close();
  }
});

test('[G3-08] definition effort reaches the real child provider without changing the parent', async () => {
  const { call, close, dir, session } = await workerFixture();
  try {
    mkdirSync(join(dir, '.pi/agents'), { recursive: true });
    writeFileSync(join(dir, '.pi/agents/thinking.md'), '---\nname: thinking\ndescription: thinks\nmodel: worker-test/alternate\neffort: high\n---\nThink carefully.\n');
    clearAgentCache();
    const before = session.thinkingLevel;
    const done = await call('Agent', { description: 'definition effort', prompt: 'think', subagent_type: 'thinking', run_in_background: false });
    expect(done.details).toMatchObject({ resolvedModel: 'worker-test/alternate' });
    expect(JSON.parse(await readFile(join(dir, 'child-options.json'), 'utf8'))).toEqual({ reasoning: 'high' });
    expect(session.thinkingLevel).toBe(before);
  } finally {
    clearAgentCache();
    await close();
  }
});

test.each([
  ['environment overrides definition', 'low', 'high', undefined, 'high'],
  ['setting caps definition', 'xhigh', undefined, 'medium', 'medium'],
  ['max selects highest native level', 'max', undefined, undefined, 'high'],
] as const)('[G3-08] effort %s', async (_case, effort, environment, maximum, expected) => {
  if (environment) vi.stubEnv('PI_EFFORT_LEVEL', environment);
  const { call, close, dir } = await workerFixture();
  try {
    const settings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ ...settings, effortLevel: 'low', ...(maximum ? { maxEffortLevel: maximum } : {}) }));
    mkdirSync(join(dir, '.pi/agents'), { recursive: true });
    writeFileSync(join(dir, '.pi/agents/effort.md'), `---\nname: effort\ndescription: effort\nmodel: worker-test/alternate\neffort: ${effort}\n---\nThink.\n`);
    clearAgentCache();
    await call('Agent', { description: 'effort policy', prompt: 'think', subagent_type: 'effort', run_in_background: false });
    expect(JSON.parse(await readFile(join(dir, 'child-options.json'), 'utf8'))).toEqual({ reasoning: expected });
  } finally {
    clearAgentCache();
    await close();
  }
});

test('[G3-08] invalid definition effort is reported once and ignored by the real child', async () => {
  const { call, close, dir, subagentLogs } = await workerFixture();
  const path = join(dir, '.pi/agents/invalid.md');
  try {
    mkdirSync(join(dir, '.pi/agents'), { recursive: true });
    writeFileSync(path, '---\nname: invalid\ndescription: invalid effort\nmodel: worker-test/alternate\neffort: bogus\n---\nThink.\n');
    clearAgentCache();
    const done = await call('Agent', { description: 'invalid effort', prompt: 'first', subagent_type: 'invalid', run_in_background: false });
    expect(done.details).toMatchObject({ resolvedModel: 'worker-test/alternate' });
    expect(JSON.parse(await readFile(join(dir, 'child-options.json'), 'utf8'))).toEqual({});
    const warning = `Agent file ${path} has invalid effort 'bogus'. Valid options: low, medium, high, xhigh, max or an integer`;
    expect(subagentLogs.filter((line) => line === warning)).toEqual([warning]);
    await call('Agent', { description: 'cached discovery', prompt: 'second', subagent_type: 'invalid', run_in_background: false });
    expect(subagentLogs.filter((line) => line === warning)).toEqual([warning]);
  } finally {
    clearAgentCache();
    await close();
  }
});

test.for([
  { effort: 0, expected: {} },
  { effort: 1500, expected: { reasoning: 'low' } },
  { effort: 8192, expected: { reasoning: 'medium' } },
  { effort: 100000, expected: { reasoning: 'high' } },
])('integer effort $effort is read as a thinking budget and mapped to the covering level', async ({ effort, expected }) => {
  const { call, close, dir } = await workerFixture();
  try {
    mkdirSync(join(dir, '.pi/agents'), { recursive: true });
    writeFileSync(join(dir, '.pi/agents/integer.md'), `---\nname: integer\ndescription: integer effort\nmodel: worker-test/alternate\neffort: ${effort}\n---\nThink.\n`);
    clearAgentCache();
    expect((await call('Agent', { description: 'integer effort', prompt: 'think', subagent_type: 'integer', run_in_background: false })).details).toMatchObject({ status: 'completed' });
    expect(JSON.parse(await readFile(join(dir, 'child-options.json'), 'utf8'))).toEqual(expected);
  } finally {
    clearAgentCache();
    await close();
  }
});
