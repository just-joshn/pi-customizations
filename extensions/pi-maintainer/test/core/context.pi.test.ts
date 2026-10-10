import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import { expect, test } from 'vitest';
import { restore } from '../../src/core/branch.ts';
import { maintainerExtension, testPrompts, textOf } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle } from '../support/pi-session.ts';

const extension = maintainerExtension();

test('provider messages follow the Aider chunk order', async () => {
  const f = await piSessionFixture({
    extension: maintainerExtension({
      promptSource: {
        get: async (format, variables) => ({
          ...(await testPrompts.get(format, variables)),
          exampleMessages: [
            { role: 'user', content: 'EXAMPLE USER' },
            { role: 'assistant', content: 'EXAMPLE ASSISTANT' },
          ],
        }),
      },
    }),
    config: 'file: [edit.txt]\nread: [reference.txt]\n',
  });
  await writeFile(join(f.cwd, 'edit.txt'), 'editable\n');
  await writeFile(join(f.cwd, 'reference.txt'), 'reference\n');
  f.replies.push({ text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'CURRENT');
  expect(f.requests[0]?.messages.map((message, index) => [message.role, index === 0 ? 'SYSTEM' : textOf(message)])).toEqual([
    ['system', 'SYSTEM'],
    ['user', 'EXAMPLE USER'],
    ['assistant', 'EXAMPLE ASSISTANT'],
    ['user', "I switched to a new code base. Please don't consider the above files or try to edit them any longer."],
    ['assistant', 'Ok.'],
    ['user', 'READ ONLY\nreference.txt\n```\nreference\n```\n'],
    ['assistant', 'Ok, I will use these files as references.'],
    ['user', 'EDITABLE\nedit.txt\n```\neditable\n```\n'],
    ['assistant', 'Ok, any changes I propose will be to those files.'],
    ['user', 'CURRENT'],
    ['system', 'TEST REMINDER'],
  ]);
  expect(f.errors).toEqual([]);
});

test('earlier context transformations survive maintainer assembly', async () => {
  const f = await piSessionFixture({
    extension,
    before: [
      (pi) => {
        pi.on('before_agent_start', (event) => {
          event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, foreign: 'FOREIGN SECTION' };
        });
        pi.on('context', (event) => ({ messages: event.messages.map((message) => (message.role === 'user' ? { ...message, content: `TRANSFORMED ${textOf(message)}` } : message)) }));
        pi.on('context_with_system', (event) => ({ messages: [...event.messages, { role: 'system', content: 'FOREIGN FREE TEXT', timestamp: 1 }] }));
      },
    ],
  });
  f.replies.push({ text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'current');
  const request = f.requests[0];
  expect(request?.messages.some((message) => textOf(message) === 'TRANSFORMED current')).toBe(true);
  expect(getCurrentSystemPrompt(request?.messages ?? [])).toContain('FOREIGN SECTION');
  expect(getCurrentSystemPrompt(request?.messages ?? [])).toContain('FOREIGN FREE TEXT');
  expect(getCurrentSystemPrompt(request?.messages ?? [])).toContain('TEST MAIN');
  expect(getCurrentTools(request?.messages ?? [])).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('earlier boundary entries survive a malformed reflection', async () => {
  const f = await piSessionFixture({
    extension,
    before: [
      (pi) => {
        pi.on('turn_end', (event) => ({ entries: [...event.entries, { type: 'custom_message', customType: 'foreign', content: 'FOREIGN BOUNDARY', display: false }] }));
      },
    ],
  });
  f.replies.push({ text: '```\nmissing filename\n```\n' }, { text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'repair');
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]?.messages.some((message) => textOf(message) === 'FOREIGN BOUNDARY')).toBe(true);
  expect(f.requests[1]?.messages.some((message) => textOf(message).includes('No filename provided'))).toBe(true);
  expect(f.errors).toEqual([]);
});

test('fresh file content occupies the completed/current boundary', async () => {
  const f = await piSessionFixture({ extension, config: 'file: [edit.txt]\n' });
  await writeFile(join(f.cwd, 'edit.txt'), 'before\n');
  f.replies.push({ text: 'edit.txt\n```\nafter\n```\n' }, { text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'first user');
  await writeFile(join(f.cwd, 'edit.txt'), 'externally changed\n');
  await promptAndSettle(session, 'second user');
  const texts = f.requests[1]?.messages.map(textOf) ?? [];
  expect(texts.filter((text) => text.startsWith('EDITABLE'))).toEqual(['EDITABLE\nedit.txt\n```\nexternally changed\n```\n']);
  expect(texts.indexOf('first user')).toBeLessThan(texts.indexOf('EDITABLE\nedit.txt\n```\nexternally changed\n```\n'));
  expect(texts.indexOf('EDITABLE\nedit.txt\n```\nexternally changed\n```\n')).toBeLessThan(texts.indexOf('second user'));
  expect(f.errors).toEqual([]);
});

test('failed reads drop editable paths but retain read-only paths', async () => {
  const f = await piSessionFixture({ extension, config: 'file: [edit.txt]\nread: [reference.txt]\n' });
  await writeFile(join(f.cwd, 'edit.txt'), 'before');
  await writeFile(join(f.cwd, 'reference.txt'), 'reference');
  const session = await f.open();
  await unlink(join(f.cwd, 'edit.txt'));
  await unlink(join(f.cwd, 'reference.txt'));
  f.replies.push({ text: '' });
  await promptAndSettle(session, 'read fresh files');
  expect(restore(session.sessionManager.getBranch()).snapshot?.files).toEqual({ editable: [], readOnly: [join(f.cwd, 'reference.txt')] });
  expect(f.requests[0]?.messages.some((message) => textOf(message) === 'NO EDITABLE FILES')).toBe(true);
  expect(f.errors).toEqual([]);
});

test('native compaction does not resurrect completed raw history', async () => {
  const f = await piSessionFixture({
    extension,
    config: 'file: [edit.txt]\n',
    before: [
      (pi) => {
        pi.on('session_before_compact', (event) => ({ compaction: { summary: 'NATIVE SUMMARY', firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: 100 } }));
      },
    ],
  });
  await writeFile(join(f.cwd, 'edit.txt'), 'before\n');
  f.replies.push({ text: 'edit.txt\n```\nafter\n```\n' }, { text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'RAW OLD USER');
  await session.compact();
  await promptAndSettle(session, 'after compaction');
  const texts = f.requests[1]?.messages.map(textOf) ?? [];
  expect(texts.some((text) => text.includes('NATIVE SUMMARY'))).toBe(true);
  expect(texts).not.toContain('RAW OLD USER');
  expect(f.errors).toEqual([]);
});
