import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { restore } from '../../src/core/branch.ts';
import { installMaintainer } from '../../src/core/install.ts';
import { editFeature } from '../../src/edit/feature.ts';
import { disabledGitPolicy } from '../../src/feature.ts';
import { testPrompts, textOf } from '../support/maintainer.ts';
import { piSessionFixture, promptAndSettle } from '../support/pi-session.ts';

const extension: ExtensionFactory = (pi) =>
  installMaintainer(
    pi,
    [
      editFeature,
      {
        name: 'git',
        options: [],
        commands: [],
        create: () => ({ ...disabledGitPolicy, trackedFiles: async () => ['mentioned.txt'] }),
      },
    ],
    { promptSource: testPrompts, home: () => '/nonexistent', processEnvironment: () => ({}) },
  );

test('assistant mentions reflect before applying the proposed edit', async () => {
  const f = await piSessionFixture({ extension, config: 'yes-always: true\n' });
  await writeFile(join(f.cwd, 'mentioned.txt'), 'before\n');
  const reply = 'mentioned.txt\n```\nafter\n```\n';
  f.replies.push(
    { text: reply },
    {
      text: reply,
      wait: async () => {
        expect(await readFile(join(f.cwd, 'mentioned.txt'), 'utf8')).toBe('before\n');
      },
    },
  );
  const session = await f.open();
  await promptAndSettle(session, 'make a change');
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]?.messages.map(textOf)).toContain('I added these files to the chat: mentioned.txt\nLet me know if there are others we should add.');
  expect(f.requests[1]?.messages.map(textOf)).toContain('EDITABLE\nmentioned.txt\n```\nbefore\n```\n');
  expect(await readFile(join(f.cwd, 'mentioned.txt'), 'utf8')).toBe('after\n');
  expect(f.errors).toEqual([]);
});

test('user preprocessing admits a mentioned file before the first request', async () => {
  const f = await piSessionFixture({ extension, config: 'yes-always: true\n' });
  await writeFile(join(f.cwd, 'mentioned.txt'), 'before\n');
  f.replies.push({ text: '' });
  const session = await f.open();
  await promptAndSettle(session, 'please inspect mentioned.txt');
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]?.messages.map(textOf)).toContain('EDITABLE\nmentioned.txt\n```\nbefore\n```\n');
  expect(f.errors).toEqual([]);
});

test('denied mentions persist on the active branch across reload', async () => {
  const f = await piSessionFixture({ extension });
  await writeFile(join(f.cwd, 'mentioned.txt'), 'before\n');
  f.replies.push({ text: 'look at mentioned.txt' }, { text: 'look at mentioned.txt' });
  const session = await f.open();
  await promptAndSettle(session, 'inspect');
  await session.reload();
  await promptAndSettle(session, 'inspect again');
  expect(restore(session.sessionManager.getBranch()).snapshot).toMatchObject({ ignoredMentions: ['mentioned.txt'], files: { editable: [] } });
  expect(f.requests).toHaveLength(2);
  expect(await readFile(join(f.cwd, 'mentioned.txt'), 'utf8')).toBe('before\n');
  expect(f.errors).toEqual([]);
});
