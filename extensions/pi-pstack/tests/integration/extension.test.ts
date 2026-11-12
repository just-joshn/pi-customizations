import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import pstack, { roleModelResolver } from '../../src/extension.ts';
import { parseModelsConfig } from '../../src/models.ts';
import { STYLE_MESSAGE } from '../../src/style.ts';
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

  test('a worker (PSTACK_WORKER=1) gets only pstack_evidence and no command, style, or routing', () => {
    process.env['PSTACK_WORKER'] = '1';
    const fake = fakePi({ cwd });
    pstack(fake.pi);
    expect([...fake.tools.keys()]).toEqual(['pstack_evidence']);
    expect(fake.commands.size).toBe(0);
    expect(fake.handlers.has('before_agent_start')).toBe(false);
    expect(fake.handlers.has('input')).toBe(false);
  });
});

describe('persistent style', () => {
  /** One user task: Pi runs before_agent_start, persists the returned message, then the prompt and a reply. */
  async function userTask(fake: FakePi, prompt: string, messageType: 'user' | 'custom' = 'user'): Promise<string | undefined> {
    const [result] = (await fake.fire('before_agent_start', { messageType, prompt, systemPrompt: '', systemPromptOptions: { sections: {} } })) as (
      | { message?: { customType: string; content: string; display: boolean; details: unknown } }
      | undefined
    )[];
    const message = result?.message;
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
    expect(await resolve({ model: 'openai/gpt-6.1-sol', thinkingLevel: 'max', role: 'general' }, ctx())).toEqual({ provider: 'openai', id: 'gpt-6.1-sol', thinkingLevel: 'high' });
    expect(() => resolve({ model: 'missing/model', thinkingLevel: null, role: 'general' }, ctx())).toThrow('Model missing/model is not available');
  });
});
