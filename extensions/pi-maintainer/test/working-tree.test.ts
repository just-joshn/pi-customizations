import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test, vi } from 'vitest';
import { createWorkingTree, type LineEndings } from '../src/edit/working-tree.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-working-tree-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const notices = { output: vi.fn(), warning: vi.fn(), error: vi.fn() };
  return { root, notices };
}

const endings = [
  { name: 'LF', lineEndings: 'lf', expected: 'a\nb\n' },
  { name: 'CRLF', lineEndings: 'crlf', expected: 'a\r\nb\r\n' },
  { name: 'platform', lineEndings: 'platform', expected: process.platform === 'win32' ? 'a\r\nb\r\n' : 'a\nb\n' },
] satisfies { name: string; lineEndings: LineEndings; expected: string }[];

test.for(endings)('writes configured $name line endings', async ({ lineEndings, expected }) => {
  const { root, notices } = await fixture();
  const path = join(root, 'source.txt');
  const tree = createWorkingTree({ lineEndings, notices });

  await tree.write(path, 'a\nb\n');

  expect(await readFile(path, 'utf8')).toBe(expected);
});

test('writes UTF-16LE file bytes', async () => {
  const { root, notices } = await fixture();
  const path = join(root, 'source.txt');
  const tree = createWorkingTree({ encoding: 'utf-16le', notices });

  await tree.write(path, 'Å\n');

  expect(await readFile(path)).toEqual(Buffer.from([0xc5, 0, 0x0a, 0]));
});

test('reports a write failure when the parent directory is missing', async () => {
  const { root, notices } = await fixture();
  const path = join(root, 'missing', 'source.txt');
  const tree = createWorkingTree({ notices });

  await expect(tree.write(path, 'content')).rejects.toMatchObject({ code: 'ENOENT' });

  expect(notices.error).toHaveBeenCalledWith(expect.stringContaining(`Unable to write file ${path}:`));
});

test('finds existing files', async () => {
  const { root, notices } = await fixture();
  const path = join(root, 'source.txt');
  await writeFile(path, 'original');

  expect(await createWorkingTree({ notices }).exists(path)).toBe(true);
});

test('reports absent files as missing', async () => {
  const { root, notices } = await fixture();

  expect(await createWorkingTree({ notices }).exists(join(root, 'missing'))).toBe(false);
});

test('touch creates an empty file under missing parent directories', async () => {
  const { root, notices } = await fixture();
  const path = join(root, 'nested', 'new.txt');
  const tree = createWorkingTree({ notices });

  expect(await tree.touch(path)).toBe(true);

  expect(await readFile(path, 'utf8')).toBe('');
});

test('touch preserves existing file contents', async () => {
  const { root, notices } = await fixture();
  const path = join(root, 'source.txt');
  await writeFile(path, 'original');

  expect(await createWorkingTree({ notices }).touch(path)).toBe(true);

  expect(await readFile(path, 'utf8')).toBe('original');
});

test('touch returns false for an invalid parent path', async () => {
  const { root, notices } = await fixture();
  const parent = join(root, 'source.txt');
  await writeFile(parent, 'original');

  expect(await createWorkingTree({ notices }).touch(join(parent, 'new.txt'))).toBe(false);
});

test('remove deletes an existing file', async () => {
  const { root, notices } = await fixture();
  const path = join(root, 'source.txt');
  await writeFile(path, 'original');

  await createWorkingTree({ notices }).remove(path);

  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('remove reports a missing path', async () => {
  const { root, notices } = await fixture();

  await expect(createWorkingTree({ notices }).remove(join(root, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test(
  'invalid UTF-8 bytes produce the encoding hint',
  {
    meta: {
      aider: [
        'test_coder/TestCoder.test_run_with_file_unicode_error',
        'test_commands/TestCommands.test_cmd_add_bad_encoding',
        'test_commands/TestCommands.test_cmd_add_unicode_error',
      ],
    },
  },
  async () => {
    const { root, notices } = await fixture();
    const path = join(root, 'source.txt');
    await writeFile(path, Buffer.from([0xff]));

    expect(await createWorkingTree({ notices }).read(path)).toBeNull();
    expect(notices.error).toHaveBeenCalledWith('Use --encoding to set the unicode encoding.');
  },
);

test(
  'reads UTF-16LE bytes when that codec is configured',
  {
    meta: {
      aider: ['test_coder/TestCoder.test_run_with_file_utf_unicode_error'],
    },
  },
  async () => {
    const { root, notices } = await fixture();
    const path = join(root, 'source.txt');
    await writeFile(path, Buffer.from('café', 'utf16le'));

    expect(await createWorkingTree({ encoding: 'utf-16le', notices }).read(path)).toBe('café');
  },
);

test('mkdir creates missing parent directories', async () => {
  const { root, notices } = await fixture();

  await createWorkingTree({ notices }).mkdir(join(root, 'a', 'b'));

  expect((await stat(join(root, 'a', 'b'))).isDirectory()).toBe(true);
});

test('mkdir accepts an existing directory', async () => {
  const { root, notices } = await fixture();
  await writeFile(join(root, 'kept.txt'), 'kept');

  await createWorkingTree({ notices }).mkdir(root);

  expect(await readFile(join(root, 'kept.txt'), 'utf8')).toBe('kept');
});

test('mkdir refuses a path held by a file', async () => {
  const { root, notices } = await fixture();
  const path = join(root, 'source.txt');
  await writeFile(path, 'original');

  await expect(createWorkingTree({ notices }).mkdir(path)).rejects.toMatchObject({ code: 'EEXIST' });
});
