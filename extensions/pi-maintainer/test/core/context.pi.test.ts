import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { expect, test } from 'vitest';
import { restore } from '../../src/core/branch.ts';
import { installMaintainer } from '../../src/core/install.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { maintainerExtension, testPrompts, textOf } from '../support/maintainer.ts';
import { oracleCases } from '../support/oracle.ts';
import { piSessionFixture, promptAndSettle } from '../support/pi-session.ts';

const extension = maintainerExtension();

test('provider messages follow the Aider chunk order', async () => {
  const golden = oracleCases('core', 'core.format_chunks', Type.Object({ main: Type.String() }))[0];
  if (!golden) throw new Error('missing chunk-order oracle case');
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
  const result = f.requests[0]?.messages.map((message, index) => [message.role, message.role === 'system' && index === 0 ? message.sections?.['preamble'] : textOf(message)]);
  expect({ result }).toEqual(golden.expected);
  expect(f.errors).toEqual([]);
});

test('repository port text occupies the native provider repository chunk', async () => {
  const f = await piSessionFixture({
    extension: (pi) =>
      installMaintainer(
        pi,
        [
          editFeature,
          {
            name: 'map',
            options: [],
            commands: [],
            create: () => ({ repoMap: async (request) => `REPO for ${request.curMessageText}` }),
          },
        ],
        { promptSource: testPrompts, home: () => '/nonexistent', processEnvironment: () => ({}) },
      ),
    config: 'file: [edit.txt]\nread: [reference.txt]\n',
  });
  await writeFile(join(f.cwd, 'edit.txt'), 'editable\n');
  await writeFile(join(f.cwd, 'reference.txt'), 'reference\n');
  f.replies.push({ text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'CURRENT');
  const texts = f.requests[0]?.messages.map(textOf) ?? [];
  expect(texts).toContain('REPO for CURRENT');
  expect(texts.indexOf('READ ONLY\nreference.txt\n```\nreference\n```\n')).toBeLessThan(texts.indexOf('REPO for CURRENT'));
  expect(texts.indexOf('REPO for CURRENT')).toBeLessThan(texts.indexOf('EDITABLE\nedit.txt\n```\neditable\n```\n'));
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

test('vision context retains literal image bytes outside text fences', async () => {
  const f = await piSessionFixture({ extension, config: 'file: [image.png]\nread: [reference.jpg]\n' });
  await writeFile(join(f.cwd, 'image.png'), Uint8Array.from([1, 2, 3, 4]));
  await writeFile(join(f.cwd, 'reference.jpg'), Uint8Array.from([5, 6, 7]));
  f.replies.push({ text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'images');
  const blocks = f.requests[0]?.messages.flatMap((message) => (message.role === 'user' && Array.isArray(message.content) ? message.content : [])) ?? [];
  expect(blocks.filter((block) => block.type === 'image')).toEqual([
    { type: 'image', data: 'BQYH', mimeType: 'image/jpeg' },
    { type: 'image', data: 'AQIDBA==', mimeType: 'image/png' },
  ]);
  expect(f.requests[0]?.messages.map(textOf)).toContain('EDITABLE');
  expect(f.errors).toEqual([]);
});

test('an unreadable image is dropped from editable membership', async () => {
  const f = await piSessionFixture({ extension, config: 'file: [image.png]\n' });
  await writeFile(join(f.cwd, 'image.png'), Uint8Array.from([1]));
  const session = await f.open();
  await unlink(join(f.cwd, 'image.png'));
  f.replies.push({ text: '' });
  await promptAndSettle(session, 'read it');
  expect(restore(session.sessionManager.getBranch()).snapshot?.files.editable).toEqual([]);
  expect(f.requests[0]?.messages.map(textOf)).toContain('NO EDITABLE FILES');
  expect(f.errors).toEqual([]);
});

test('an injected prompt policy places the reminder in the current user', async () => {
  const f = await piSessionFixture({
    extension: maintainerExtension({
      promptPolicy: { useSystemPrompt: false, examplesAsSystemMessage: true, systemPromptPrefix: 'PREFIX', reminder: 'user' },
      promptSource: { get: async (format, variables) => ({ ...(await testPrompts.get(format, variables)), exampleMessages: [{ role: 'user', content: 'EXAMPLE' }] }) },
    }),
  });
  f.replies.push({ text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'CURRENT');
  const texts = f.requests[0]?.messages.map(textOf) ?? [];
  expect(texts).toContain('PREFIX\nTEST MAIN\n# Example conversations:\n\n## USER: EXAMPLE\nTEST REMINDER');
  expect(texts).toContain('CURRENT\n\nTEST REMINDER');
  expect(f.errors).toEqual([]);
});
