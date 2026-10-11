import { mkdir, readFile, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { createHost } from '../../src/core/pi-host.ts';
import { maintainerExtension } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle, scriptedModel, zeroUsage } from '../support/pi-session.ts';

test('keeps synthetic command credentials out of process arguments', async () => {
  const host = createHost({} as ExtensionAPI, {
    context: () => ({ signal: undefined }) as never,
    yes: () => null,
    never: () => [],
    remember: () => {},
    environment: () => ({ AUDIT_SECRET: 'E6_SYNTHETIC_ONLY' }),
    notice: () => {},
  });
  const argv = await host.exec({
    command: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify(process.argv))'],
    cwd: '/tmp',
  });
  expect(argv.code).toBe(0);
  expect(argv.stdout.includes('E6_SYNTHETIC_ONLY')).toBe(false);
  const env = await host.exec({
    command: process.execPath,
    args: ['-e', 'process.stdout.write(process.env.AUDIT_SECRET ?? "")'],
    cwd: '/tmp',
  });
  expect(env.stdout).toBe('E6_SYNTHETIC_ONLY');
});

test('an approved dangling symlink receives the whole-file body', async () => {
  const f = await piSessionFixture({ extension: maintainerExtension(), config: 'yes-always: true\n' });
  const target = join(f.cwd, 'target.txt');
  await symlink('target.txt', join(f.cwd, 'alias.txt'));
  f.replies.push({ text: 'alias.txt\n```\nbody\n```\n' }, { text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'write the approved alias');
  expect(await readFile(target, 'utf8')).toBe('body\n');
  expect(f.errors).toEqual([]);
});

test('failed application does not report a successful file update', { meta: { evidence: ['ev-edit/cli-apply/patch-add'] } }, async () => {
  const f = await piSessionFixture({ extension: maintainerExtension(), config: 'yes-always: true\n' });
  await mkdir(join(f.cwd, 'bad.txt'));
  f.replies.push({ text: 'bad.txt\n```\nbody\n```\n' }, { text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'attempt an invalid file write');
  const saved = session.sessionManager.getBranch().filter((entry) => {
    if (entry.type !== 'custom_message' || entry.details === undefined || typeof entry.details !== 'object' || entry.details === null) return false;
    return 'purpose' in entry.details && entry.details.purpose === 'saved';
  });
  expect(saved).toEqual([]);
  expect(f.errors).toEqual([]);
  expect((await stat(join(f.cwd, 'bad.txt'))).isDirectory()).toBe(true);
});

test('a fresh user request honors a changed native thinking selection', async () => {
  const levels: Array<string | undefined> = [];
  const reasoner: ExtensionFactory = (pi) =>
    pi.registerProvider(scriptedModel.provider, {
      apiKey: 'integration-only-not-a-secret',
      api: scriptedModel.api,
      baseUrl: scriptedModel.baseUrl,
      models: [{ ...scriptedModel, reasoning: true }],
      streamSimple: (model, _context, options) => {
        levels.push(options?.reasoning);
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          const message = {
            role: 'assistant' as const,
            api: model.api,
            provider: model.provider,
            model: model.id,
            content: [{ type: 'text' as const, text: 'ok' }],
            usage: zeroUsage(),
            timestamp: Date.now(),
            stopReason: 'stop' as const,
          };
          stream.push({ type: 'start', partial: message });
          stream.push({ type: 'text_start', contentIndex: 0, partial: message });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: 'ok', partial: message });
          stream.push({ type: 'text_end', contentIndex: 0, content: 'ok', partial: message });
          stream.push({ type: 'done', reason: 'stop', message });
          stream.end();
        });
        return stream;
      },
    });
  const f = await piSessionFixture({ extension: maintainerExtension(), before: [reasoner] });
  const session = await f.open();
  session.setThinkingLevel('high');
  await promptAndSettle(session, 'first user request');
  session.setThinkingLevel('low');
  await promptAndSettle(session, 'new user request');
  expect(levels).toEqual(['high', 'low']);
  expect(f.errors).toEqual([]);
});
