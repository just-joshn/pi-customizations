import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { restore } from '../../src/core/branch.ts';
import { maintainerExtension } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle } from '../support/pi-session.ts';

const extension = maintainerExtension();

test('native retry does not apply the failed response or spend a reflection', async () => {
  const f = await piSessionFixture({ extension, config: 'file: [hello.txt]\n', retry: true });
  await writeFile(join(f.cwd, 'hello.txt'), 'before\n');
  f.replies.push({ text: 'hello.txt\n```\npartial\n```\n', stopReason: 'error', errorMessage: '429 rate limit' });
  const session = await f.open();
  f.replies.push({
    text: 'hello.txt\n```\nafter\n```\n',
    wait: async () => {
      expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('before\n');
      expect(restore(session.sessionManager.getBranch()).snapshot?.lifecycle).toMatchObject({ kind: 'active', reflectionsSent: 0 });
    },
  });
  await promptAndSettle(session, 'edit it');
  expect(f.requests).toHaveLength(2);
  expect(await readFile(join(f.cwd, 'hello.txt'), 'utf8')).toBe('after\n');
  expect(restore(session.sessionManager.getBranch()).finishedReplies.size).toBe(1);
  expect(f.errors).toEqual([]);
});

test('native accounting excludes request-local acknowledgments', async () => {
  const f = await piSessionFixture({ extension, config: 'file: [hello.txt]\n' });
  await writeFile(join(f.cwd, 'hello.txt'), 'before\n');
  const usage = { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0.03, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.05 } };
  f.replies.push({ text: 'hello.txt\n```\nafter\n```\n', usage }, { text: '', usage });
  const session = await f.open();
  await promptAndSettle(session, 'first');
  await promptAndSettle(session, 'second');
  expect(session.getSessionStats().tokens).toEqual({ input: 14, output: 6, cacheRead: 0, cacheWrite: 0, total: 20 });
  expect(session.getSessionStats().cost).toBeCloseTo(0.1);
  expect(f.requests).toHaveLength(2);
  expect(f.errors).toEqual([]);
});
