import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { restore } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { admitInitialEditable, readMessageFile } from '../../src/edit/startup-input.ts';
import { createWorkingTree, type Notices } from '../../src/edit/working-tree.ts';
import { maintainerExtension, textOf } from '../support/maintainer.ts';
import { piSessionFixture } from '../support/pi-session.ts';

function captureHost(): Notices & { readonly outputs: string[]; readonly warnings: string[]; readonly errors: string[] } {
  const outputs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    outputs,
    warnings,
    errors,
    output: (message) => outputs.push(message),
    warning: (message) => warnings.push(message),
    error: (message) => errors.push(message),
  };
}

test('an empty startup file list yields an empty editable selection', {
  meta: {
    aider: ['test_main/TestMain.test_main_with_empty_dir_no_files_on_command', 'test_main/TestMain.test_return_coder'],
  },
}, async () => {
  const host = captureHost();
  const root = await mkdtemp(join(tmpdir(), 'pm-input-empty-'));
  const tree = createWorkingTree({ notices: host });
  const editable = await admitInitialEditable([], { cwd: root, tree, host, allowCreation: true });
  expect(editable).toEqual([]);
  expect(host.warnings).toEqual([]);
  expect(host.errors).toEqual([]);

  const f = await piSessionFixture({ extension: maintainerExtension() });
  const session = await f.open();
  const restored = restore(session.sessionManager.getBranch()).snapshot;
  expect(restored?.root).toBe(f.cwd);
  expect(restored?.files.editable).toEqual([]);
  expect(f.requests).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test('missing editable files are created and selected', {
  meta: {
    aider: ['test_main/TestMain.test_main_with_emptqy_dir_new_file'],
  },
}, async () => {
  const host = captureHost();
  const root = await mkdtemp(join(tmpdir(), 'pm-input-create-'));
  const tree = createWorkingTree({ notices: host });
  const editable = await admitInitialEditable(['foo.txt'], { cwd: root, tree, host, allowCreation: true });
  const full = absRootPath(root, 'foo.txt');
  expect(editable).toEqual([full]);
  expect(await tree.exists(full)).toBe(true);
  expect(host.outputs).toContain('Creating empty file foo.txt');
});

test('paths that cannot be created or are not ordinary files are diagnosed and excluded', {
  meta: {
    aider: ['test_coder/TestCoder.test_coder_create_with_new_file_oserror'],
  },
}, async () => {
  const host = captureHost();
  const root = await mkdtemp(join(tmpdir(), 'pm-input-skip-'));
  await mkdir(join(root, 'subdir'));
  const tree = {
    exists: async (path: string) => path.endsWith('subdir'),
    touch: async () => false,
  };
  const editable = await admitInitialEditable(['blocked.txt', 'subdir'], {
    cwd: root,
    tree,
    host,
    allowCreation: true,
    isOrdinaryFile: async (path) => !path.endsWith('subdir'),
  });
  expect(editable).toEqual([]);
  expect(host.warnings).toContain('Can not create blocked.txt, skipping.');
  expect(host.warnings).toContain('Skipping subdir that is not a normal file.');
});

test('a message file is read with the configured encoding and enters the request path', {
  meta: {
    aider: ['test_main/TestMain.test_message_file_flag'],
  },
}, async () => {
  const host = captureHost();
  const root = await mkdtemp(join(tmpdir(), 'pm-input-msg-'));
  const path = join(root, 'prompt.txt');
  await writeFile(path, Buffer.from([0xe9]));
  const tree = createWorkingTree({ notices: host, encoding: 'iso-8859-15' });
  expect(await readMessageFile(path, tree, host)).toBe('é');

  const f = await piSessionFixture({
    extension: maintainerExtension(),
    config: 'message-file: prompt.txt\nencoding: utf-8\n',
  });
  await writeFile(join(f.cwd, 'prompt.txt'), 'This is a test message from a file.');
  f.replies.push({ text: 'ok' });
  const session = await f.open();
  await new Promise<void>((resolve) => {
    const unsubscribe = session.subscribe((event) => {
      if (event.type !== 'agent_settled') return;
      unsubscribe();
      resolve();
    });
  });
  expect(f.requests).toHaveLength(1);
  expect(f.requests[0]?.messages.some((message) => message.role === 'user' && textOf(message) === 'This is a test message from a file.')).toBe(true);
  expect(f.errors).toEqual([]);
});

test('a missing message file is reported and does not enter the request path', async () => {
  const host = captureHost();
  const root = await mkdtemp(join(tmpdir(), 'pm-input-missing-'));
  const tree = createWorkingTree({ notices: host });
  expect(await readMessageFile(join(root, 'absent.txt'), tree, host)).toBeNull();
  expect(host.errors).toContain(`Message file not found: ${join(root, 'absent.txt')}`);
});
