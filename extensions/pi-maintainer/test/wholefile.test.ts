import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { ValueError } from '../src/edit/errors.ts';
import { chooseFence } from '../src/edit/fences.ts';
import { applyEdits, getEdits } from '../src/edit/wholefile.ts';
import { createWorkingTree } from '../src/edit/working-tree.ts';

async function workingDirectory(initial: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wholefile-test-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(initial)) await writeFile(join(root, path), content);
  const errors: string[] = [];
  const tree = createWorkingTree({
    notices: {
      output() {},
      warning() {},
      error(message) {
        errors.push(message);
      },
    },
  });
  return { tree, absRootPath: (path: string) => resolve(root, path), root, errors };
}

test('overwrites an existing chat file', { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_update_files'] } }, async () => {
  const context = await workingDirectory({ 'sample.txt': 'Original content\n' });
  const edits = getEdits('sample.txt\n```\nUpdated content\n```', ['sample.txt']);
  await applyEdits(edits, context);
  expect(await readFile(join(context.root, 'sample.txt'), 'utf8')).toBe('Updated content\n');
});

test('uses an alternate fence when file content contains backticks', { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_update_files_with_existing_fence'] } }, async () => {
  const original = '\nHere is some quoted text:\n```\nQuote!\n```\n';
  const context = await workingDirectory({ 'sample.txt': original });
  const { fence } = chooseFence([original]);
  expect(fence).toEqual(['````', '````']);
  await applyEdits(getEdits(`sample.txt\n${fence[0]}\nUpdated content\n${fence[1]}`, ['sample.txt'], fence), context);
  expect(await readFile(join(context.root, 'sample.txt'), 'utf8')).toBe('Updated content\n');
});

test('removes a bogus path prefix when its basename is in chat', { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_update_files_bogus_path_prefix'] } }, async () => {
  const context = await workingDirectory({ 'sample.txt': 'Original content\n' });
  await applyEdits(getEdits('path/to/sample.txt\n```\nUpdated content\n```', ['sample.txt']), context);
  expect(await readFile(join(context.root, 'sample.txt'), 'utf8')).toBe('Updated content\n');
});

test('writes a named file that is not in chat', { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_update_files_not_in_chat'] } }, async () => {
  const context = await workingDirectory({ 'sample.txt': 'Original content\n' });
  await applyEdits(getEdits('sample.txt\n```\nUpdated content\n```'), context);
  expect(await readFile(join(context.root, 'sample.txt'), 'utf8')).toBe('Updated content\n');
});

test('infers an earlier quoted name across a blank line', { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_update_files_no_filename_single_file_in_chat'] } }, async () => {
  const context = await workingDirectory({ 'accumulate.py': 'Original content\n' });
  const response =
    "Here's the modified `accumulate.py` file that implements the `accumulate` function as per the given instructions:\n\n```\ndef accumulate(collection, operation):\n    return [operation(x) for x in collection]\n```\n\nThis implementation uses a list comprehension.";
  await applyEdits(getEdits(response, ['accumulate.py']), context);
  expect(await readFile(join(context.root, 'accumulate.py'), 'utf8')).toBe('def accumulate(collection, operation):\n    return [operation(x) for x in collection]\n');
});

test('uses earlier quoted filenames for separate blocks', { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_update_files_earlier_filename'] } }, async () => {
  const context = await workingDirectory({ 'a.txt': 'before a\n', 'b.txt': 'before b\n' });
  const response = '\nHere is a new version of `a.txt` for you to consider:\n\n```\nafter a\n```\n\nAnd here is `b.txt`:\n\n```\nafter b\n```\n';
  await applyEdits(getEdits(response, ['a.txt', 'b.txt']), context);
  expect(await readFile(join(context.root, 'a.txt'), 'utf8')).toBe('after a\n');
  expect(await readFile(join(context.root, 'b.txt'), 'utf8')).toBe('after b\n');
});

test('cleans heading markers from filenames', { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_update_hash_filename'] } }, async () => {
  const context = await workingDirectory({ 'a.txt': 'before a\n', 'b.txt': 'before b\n' });
  await applyEdits(getEdits('\n\n### a.txt\n```\nafter a\n```\n\n### b.txt\n```\nafter b\n```\n', ['a.txt', 'b.txt']), context);
  expect(await readFile(join(context.root, 'a.txt'), 'utf8')).toBe('after a\n');
  expect(await readFile(join(context.root, 'b.txt'), 'utf8')).toBe('after b\n');
});

test('ignores an extra unnamed block after a named replacement', { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_update_named_file_but_extra_unnamed_code_block'] } }, async () => {
  const context = await workingDirectory({ 'hello.py': 'Original content\n' });
  const response =
    "Here's the modified `hello.py` file that implements the `accumulate` function:\n\n```\nnew\ncontent\ngoes\nhere\n```\n\nThis implementation uses a list comprehension.\nRun it like this:\n\n```\npython {sample_file}\n```\n\n";
  await applyEdits(getEdits(response, ['hello.py']), context);
  expect(await readFile(join(context.root, 'hello.py'), 'utf8')).toBe('new\ncontent\ngoes\nhere\n');
});

test('writes the response newline once', { meta: { aider: ['test_wholefile/TestWholeFileCoder.test_full_edit'] } }, async () => {
  const context = await workingDirectory({ file: 'one\ntwo\nthree\n' });
  await applyEdits(getEdits('\nDo this:\n\nfile\n```\nnew\ntwo\nthree\n```\n\n', ['file']), context);
  expect(await readFile(join(context.root, 'file'), 'utf8')).toBe('new\ntwo\nthree\n');
});

test('overwrites a file with an empty block', async () => {
  const context = await workingDirectory({ file: 'previous' });
  await applyEdits(getEdits('file\n```\n```'), context);
  expect(await readFile(join(context.root, 'file'), 'utf8')).toBe('');
});

test('creates a file without adding a trailing newline', async () => {
  const context = await workingDirectory();
  await applyEdits(getEdits('new.txt\n```\n\t😀'), context);
  expect(await readFile(join(context.root, 'new.txt'), 'utf8')).toBe('\t😀');
});

test('keeps earlier writes when a later write fails', async () => {
  const context = await workingDirectory({ first: 'before', last: 'untouched' });
  const edits = getEdits('first\n```\nafter\n```\nmissing/second\n```\nfails\n```\nlast\n```\nskipped\n```');
  await expect(applyEdits(edits, context)).rejects.toThrow('ENOENT');
  expect(await readFile(join(context.root, 'first'), 'utf8')).toBe('after\n');
  expect(await readFile(join(context.root, 'last'), 'utf8')).toBe('untouched');
  expect(context.errors.join('\n')).toContain('Unable to write file');
});

test('rejects a nameless block without choosing among chat files', () => {
  expect(() => getEdits('```\nnew\n```', ['a', 'b'])).toThrow(new ValueError('No filename provided before ``` in file listing'));
});

test(
  'replays the recorded whole-file CLI replacement content',
  { meta: { evidence: ['ev-edit/cli-apply/whole-update'] } },
  async () => {
    const context = await workingDirectory({ 'sample.py': 'value = 100\n' });
    await applyEdits(getEdits('sample.py\n```python\nvalue = 200\n```\n', ['sample.py']), context);
    expect(await readFile(join(context.root, 'sample.py'), 'utf8')).toBe('value = 200\n');
  },
);
