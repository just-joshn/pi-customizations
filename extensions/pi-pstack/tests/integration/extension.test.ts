import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { ExtensionContext, ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import pstack, { roleModelResolver } from '../../src/extension.ts';
import { parseModelsConfig } from '../../src/models.ts';
import { STYLE_MESSAGE } from '../../src/style.ts';
import { makeProject, makeRun, writeAssignment } from '../worker-lifecycle/harness.ts';
import { type FakePi, fakePi } from './fake-pi.ts';

let cwd: string;
beforeEach(() => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-ext-')));
});
afterEach(() => {
  delete process.env['PSTACK_WORKER'];
  rmSync(cwd, { recursive: true, force: true });
});

describe('entry', () => {
  test('a parent gets pstack_worker, pstack_evidence, and /pstack', () => {
    const fake = fakePi({ cwd });
    pstack(fake.pi);
    expect([...fake.tools.keys()].sort()).toEqual(['pstack_evidence', 'pstack_worker']);
    expect([...fake.commands.keys()]).toEqual(['pstack']);
  });

  test('a sub-coordinator resolves suffixes before launch and leaves resolution errors unclaimed', async () => {
    const project = makeProject();
    const session = SessionManager.create(project.dir, join(project.dir, 'sessions'));
    session.appendMessage({ role: 'user', content: 'coordinate', timestamp: Date.now() });
    makeRun(project, 'run1', session.getSessionFile());
    process.env['PSTACK_WORKER'] = '1';
    const previousSpawn = process.env['PSTACK_SPAWN'];
    process.env['PSTACK_SPAWN'] = '1';
    const model = { provider: 'openai', id: 'gpt-6.1-sol', reasoning: true };
    const fake = fakePi({ cwd: project.dir, session, model, thinkingLevel: 'medium', modelRegistry: { getAvailable: () => [model] } });
    const launches: { model: { provider: string; id: string }; thinkingLevel: string }[] = [];
    fake.pi.exec = async (_command, args) => {
      launches.push(JSON.parse(args.at(-1) as string));
      return { code: 1, stdout: '', stderr: 'fixture launch refused', killed: false, truncated: false };
    };
    pstack(fake.pi);
    const path = writeAssignment(project, 'run1', 'leaf', 'task', { model: 'openai/gpt-6.1-sol:high', thinkingLevel: 'low' });
    const tool = fake.tools.get('pstack_worker') as ToolDefinition;
    const spawn = () => tool.execute('spawn', { action: 'spawn', runId: 'run1', assignmentPath: path }, undefined, undefined, fake.ctx() as unknown as ExtensionToolContext);
    try {
      await expect(spawn()).rejects.toThrow(/conflicting thinking levels.*suffix high.*thinkingLevel low/);
      expect(launches).toEqual([]);
      expect(existsSync(join(path, '..', 'claim'))).toBe(false);
      writeAssignment(project, 'run1', 'leaf', 'task', { model: 'openai/gpt-6.1-sol:high', thinkingLevel: null });
      await expect(spawn()).rejects.toThrow(/fixture launch refused/);
      expect(launches).toMatchObject([{ model: { provider: 'openai', id: 'gpt-6.1-sol' }, thinkingLevel: 'high' }]);
    } finally {
      if (previousSpawn === undefined) delete process.env['PSTACK_SPAWN'];
      else process.env['PSTACK_SPAWN'] = previousSpawn;
      project.dispose();
    }
  });

  test('a worker (PSTACK_WORKER=1) gets only pstack_evidence and package paths, with no command, style, or routing', async () => {
    process.env['PSTACK_WORKER'] = '1';
    const fake = fakePi({ cwd });
    pstack(fake.pi);
    expect([...fake.tools.keys()]).toEqual(['pstack_evidence']);
    expect(fake.commands.size).toBe(0);
    expect(await fake.fire('before_agent_start', { messageType: 'user', prompt: 'task', systemPrompt: 'base' })).toEqual([{ systemPrompt: expect.stringContaining('The installed pi-pstack package root (<pi-pstack>) is ') }]);
    expect(fake.handlers.has('input')).toBe(false);
  });
});

describe('persistent style', () => {
  /** One user task: Pi runs before_agent_start, persists the returned message, then the prompt and a reply. */
  async function userTask(fake: FakePi, prompt: string, messageType: 'user' | 'custom' = 'user'): Promise<string | undefined> {
    const results = (await fake.fire('before_agent_start', { messageType, prompt, systemPrompt: '', systemPromptOptions: { sections: {} } })) as (
      | { message?: { customType: string; content: string; display: boolean; details: unknown } }
      | undefined
    )[];
    const message = results.find((result) => result?.message !== undefined)?.message;
    if (message !== undefined) fake.session.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
    fake.session.appendMessage({ role: 'user', content: prompt, timestamp: Date.now() });
    fake.session.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      api: 'faux',
      provider: 'scripted',
      model: 'echo',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as never);
    return message === undefined ? undefined : (message.details as { kind: string }).kind;
  }
  const styleMessages = (fake: FakePi) => fake.session.buildContextEntries().filter((entry) => entry.type === 'custom_message' && entry.customType === STYLE_MESSAGE);

  test('on adds the poteto-mode skill once per context, never on custom wake turns', async () => {
    const fake = fakePi({ cwd });
    pstack(fake.pi);
    expect(await userTask(fake, 'before on')).toBeUndefined();
    expect((await fake.pstack('on')).level).toBe('info');
    expect(await userTask(fake, 'wake', 'custom')).toBeUndefined();
    expect(await userTask(fake, 'first task')).toBe('skill');
    expect(await userTask(fake, 'second task')).toBeUndefined();
    const [skill] = styleMessages(fake);
    expect(skill?.type === 'custom_message' ? skill.content : '').toMatch(/^<skill name="poteto-mode" location="[^"]+generated\/skills\/poteto-mode\/SKILL\.md">/);
    expect(styleMessages(fake)).toHaveLength(1);
  });

  test('a compaction that keeps the skill adds nothing; one that summarizes it away brings it back once', async () => {
    const fake = fakePi({ cwd });
    pstack(fake.pi);
    await fake.pstack('on');
    await userTask(fake, 'first task');
    const keptFrom = fake.session.getBranch().find((entry) => entry.type === 'custom_message')?.id ?? null;
    fake.session.appendCompaction('SUMMARY', keptFrom, 100);
    expect(await userTask(fake, 'after a compaction that kept it')).toBeUndefined();
    const lastUser =
      fake.session
        .getBranch()
        .filter((entry) => entry.type === 'message')
        .at(-2)?.id ?? null;
    fake.session.appendCompaction('SUMMARY', lastUser, 100);
    expect(styleMessages(fake)).toHaveLength(0);
    expect(await userTask(fake, 'after a compaction that dropped it')).toBe('skill');
    expect(await userTask(fake, 'next')).toBeUndefined();
    expect(styleMessages(fake)).toHaveLength(1);
  });

  test('off adds one notice while the skill is visible, then nothing', async () => {
    const fake = fakePi({ cwd });
    pstack(fake.pi);
    await fake.pstack('on');
    await userTask(fake, 'task');
    await fake.pstack('off');
    expect(await userTask(fake, 'after off')).toBe('off');
    expect(await userTask(fake, 'later')).toBeUndefined();
    await fake.pstack('on');
    expect(await userTask(fake, 'on again')).toBe('skill');
  });

  test('resume and fork restore the selection from the session file, and a fork turning it off leaves the original on', async () => {
    const dir = join(cwd, 'sessions');
    const original = SessionManager.create(cwd, dir);
    const first = fakePi({ cwd, session: original });
    pstack(first.pi);
    await first.pstack('on');
    await userTask(first, 'task');
    const file = original.getSessionFile() as string;
    const resumed = fakePi({ cwd, session: SessionManager.open(file, dir) });
    pstack(resumed.pi);
    expect((await resumed.pstack('status')).text).toMatch(/^pstack style: on/);
    expect(await userTask(resumed, 'resumed task')).toBeUndefined();
    const forked = fakePi({ cwd, session: SessionManager.forkFrom(file, cwd, dir) });
    pstack(forked.pi);
    expect((await forked.pstack('status')).text).toMatch(/^pstack style: on/);
    await forked.pstack('off');
    const reopened = fakePi({ cwd, session: SessionManager.open(file, dir) });
    pstack(reopened.pi);
    expect((await reopened.pstack('status')).text).toMatch(/^pstack style: on/);
  });
});

describe('roleModelResolver', () => {
  const model = (provider: string, id: string, reasoning = true): Model<Api> => ({
    provider,
    id,
    name: id,
    api: 'openai-responses',
    baseUrl: 'https://example.invalid',
    reasoning,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  });
  const available = [model('openai', 'gpt-6.1-sol'), model('scripted', 'plain', false)];
  const ctx = (withModel = true) => ({ model: withModel ? available[0] : undefined, thinkingLevel: 'medium', modelRegistry: { getAvailable: () => available } }) as unknown as ExtensionContext;
  const resolve = roleModelResolver(() => parseModelsConfig({ schemaVersion: 1, budget: 'large', roles: {} }));

  test('inherit-parent is the session model at its level, or at the requested level', async () => {
    expect(await resolve({ model: 'inherit-parent', thinkingLevel: null, role: 'general' }, ctx())).toEqual({ provider: 'openai', id: 'gpt-6.1-sol', thinkingLevel: 'medium' });
    expect(await resolve({ model: 'inherit-parent', thinkingLevel: 'low', role: 'general' }, ctx())).toEqual({ provider: 'openai', id: 'gpt-6.1-sol', thinkingLevel: 'low' });
    expect(() => resolve({ model: 'inherit-parent', thinkingLevel: null, role: 'general' }, ctx(false))).toThrow('no model selected');
  });

  test('a named model resolves against the registry; null keeps its default level; a level clamps to a supported one', async () => {
    expect(await resolve({ model: 'scripted/plain', thinkingLevel: null, role: 'general' }, ctx())).toEqual({ provider: 'scripted', id: 'plain', thinkingLevel: null });
    expect(await resolve({ model: 'openai/gpt-6.1-sol', thinkingLevel: 'max', role: 'general' }, ctx())).toMatchObject({ provider: 'openai', id: 'gpt-6.1-sol', thinkingLevel: 'high' });
    expect(() => resolve({ model: 'missing/model', thinkingLevel: null, role: 'general' }, ctx())).toThrow('Model missing/model is not available');
  });

  test('Pi model suffix selects the exact canary model and level, without a fallback note', async () => {
    const listed = [model('claude-subscription', 'claude-haiku-4-5'), model('claude-subscription', 'claude-haiku-5-5')];
    const c = { ...ctx(), modelRegistry: { getAvailable: () => listed } } as unknown as ExtensionContext;
    for (const thinkingLevel of [null, 'high'] as const) {
      expect(await resolve({ model: 'claude-subscription/claude-haiku-5-5:high', thinkingLevel, role: 'general' }, c)).toEqual({ provider: 'claude-subscription', id: 'claude-haiku-5-5', thinkingLevel: 'high' });
    }
    expect(() => resolve({ model: 'claude-subscription/claude-haiku-5-5:high', thinkingLevel: 'low', role: 'general' }, c)).toThrow(/conflicting thinking levels/i);
    expect(await resolve({ model: 'claude-subscription/claude-haiku-absent:high', thinkingLevel: null, role: 'general' }, c)).toMatchObject({ id: 'claude-haiku-4-5', thinkingLevel: 'high', note: expect.stringContaining('not available') });
  });

  test('a changed level or model is reported with its reason; an exact match carries no note', async () => {
    expect(await resolve({ model: 'openai/gpt-6.1-sol', thinkingLevel: 'max', role: 'general' }, ctx())).toMatchObject({ note: expect.stringMatching(/requested openai\/gpt-6\.1-sol:max, running openai\/gpt-6\.1-sol:high; .*not max/) });
    expect(await resolve({ model: 'openai/gpt-6.1-sol', thinkingLevel: 'high', role: 'general' }, ctx())).not.toHaveProperty('note');
    expect(await resolve({ model: 'openai/gpt-6.1-sol', thinkingLevel: null, role: 'general' }, ctx())).not.toHaveProperty('note');
  });

  test('a family default resolves to the listed model at its level, preferring the parent provider and the fast variant', async () => {
    const listed = [model('other', 'claude-opus-5-5'), model('openai', 'claude-opus-5-5'), model('openai', 'grok-4.7'), model('openai', 'grok-4.7-fast')];
    const registry = { getAvailable: () => listed };
    const withParent = { model: listed[1], thinkingLevel: 'medium', modelRegistry: registry } as unknown as ExtensionContext;
    expect(await resolve({ model: 'claude-opus-5-5-high', thinkingLevel: null, role: 'general' }, withParent)).toEqual({ provider: 'openai', id: 'claude-opus-5-5', thinkingLevel: 'high' });
    expect(await resolve({ model: 'grok-4.7-high-fast', thinkingLevel: null, role: 'general' }, withParent)).toEqual({ provider: 'openai', id: 'grok-4.7-fast', thinkingLevel: 'high' });
    expect(await resolve({ model: 'grok-4.7-high', thinkingLevel: null, role: 'general' }, withParent)).toEqual({ provider: 'openai', id: 'grok-4.7', thinkingLevel: 'high' });
  });

  test('an unlisted family default falls to a listed family model with a note; with none listed the error lists what is', async () => {
    const registry = { getAvailable: () => [model('openai', 'grok-4.6')] };
    const c = { model: undefined, thinkingLevel: 'medium', modelRegistry: registry } as unknown as ExtensionContext;
    expect(await resolve({ model: 'grok-4.7-high-fast', thinkingLevel: null, role: 'general' }, c)).toMatchObject({ provider: 'openai', id: 'grok-4.6', note: expect.stringContaining('grok-4.7 is not available; using openai/grok-4.6') });
    expect(() => resolve({ model: 'claude-opus-5-5-high', thinkingLevel: null, role: 'general' }, c)).toThrow(/no claude model is listed\. Available: openai\/grok-4\.6/);
  });

  test('a null level on a model that cannot turn thinking off stays on that model, not on a sibling that can', async () => {
    const flash = { ...model('zai', 'glm-5.3-flash'), thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', max: 'max' } } as Model<Api>;
    const registry = { getAvailable: () => [model('zai', 'glm-4.7'), flash] };
    const zaiCtx = { model: flash, thinkingLevel: 'high', modelRegistry: registry } as unknown as ExtensionContext;
    expect(await resolve({ model: 'zai/glm-5.3-flash', thinkingLevel: null, role: 'general' }, zaiCtx)).toEqual({ provider: 'zai', id: 'glm-5.3-flash', thinkingLevel: null });
  });
});
