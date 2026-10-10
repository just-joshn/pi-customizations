import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { applyEdits, applyEditsDryRun, doReplace, getEdits, stripQuotedWrapping } from '../src/edit/editblock.ts';
import { perfectOrWhitespace, replaceMostSimilarChunk } from '../src/edit/editblock-match.ts';
import { DEFAULT_FENCE, findFilename, findOriginalUpdateBlocks } from '../src/edit/editblock-parse.ts';
import { ValueError } from '../src/edit/errors.ts';
import { createWorkingTree } from '../src/edit/working-tree.ts';

const fence = DEFAULT_FENCE;
const notices = { output() {}, warning() {}, error() {} };

async function workspace(initial: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'editblock-ports-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(initial)) await writeFile(join(root, path), content);
  const tree = createWorkingTree({ notices });
  return {
    root,
    tree,
    absRootPath: (path: string) => resolve(root, path),
    absFnames: new Set(Object.keys(initial).map((path) => resolve(root, path))),
    fence,
  };
}

const alwaysExists = { exists: async () => true, touch: async () => {} };

test('finds filenames by exact basename fuzzy and fence lookback', { meta: { aider: ['test_editblock/TestUtils.test_find_filename'] } }, () => {
  const valid = ['file1.py', 'file2.py', 'dir/file3.py', String.raw`\windows\__init__.py`];
  expect(findFilename(['file1.py', '```'], fence, valid)).toBe('file1.py');
  expect(findFilename(['```python', 'file3.py', '```'], fence, valid)).toBe('dir/file3.py');
  expect(findFilename(['```', 'invalid_file.py', '```'], fence, valid)).toBe('invalid_file.py');
  expect(findFilename(['```python', 'file1.py', '```', '```', 'file2.py', '```'], fence, valid)).toBe('file2.py');
  expect(findFilename(['# file1.py', '```'], fence, valid)).toBe('file1.py');
  expect(findFilename(['file1_py', '```'], fence, valid)).toBe('file1.py');
  expect(findFilename([String.raw`\windows__init__.py`, '```'], fence, valid)).toBe(String.raw`\windows\__init__.py`);
});

test('strips filename and fence wrapping from SEARCH text', { meta: { aider: ['test_editblock/TestUtils.test_strip_quoted_wrapping'] } }, () => {
  const input = 'filename.ext\n```\nWe just want this content\nNot the filename and triple quotes\n```';
  expect(stripQuotedWrapping(input, 'filename.ext')).toBe('We just want this content\nNot the filename and triple quotes\n');
});

test('strips fence wrapping without a filename', { meta: { aider: ['test_editblock/TestUtils.test_strip_quoted_wrapping_no_filename'] } }, () => {
  expect(stripQuotedWrapping('```\nWe just want this content\nNot the triple quotes\n```')).toBe('We just want this content\nNot the triple quotes\n');
});

test('keeps unwrapped SEARCH text unchanged', { meta: { aider: ['test_editblock/TestUtils.test_strip_quoted_wrapping_no_wrapping'] } }, () => {
  expect(stripQuotedWrapping('We just want this content\nNot the triple quotes\n')).toBe('We just want this content\nNot the triple quotes\n');
});

test('parses a fenced SEARCH/REPLACE block', { meta: { aider: ['test_editblock/TestUtils.test_find_original_update_blocks'] } }, () => {
  const edit = `
Here's the change:

\`\`\`text
foo.txt
<<<<<<< SEARCH
Two
=======
Tooooo
>>>>>>> REPLACE
\`\`\`

Hope you like it!
`;
  expect(findOriginalUpdateBlocks(edit)).toEqual([['foo.txt', 'Two\n', 'Tooooo\n']]);
});

test('finds filename above the opening fence', { meta: { aider: ['test_editblock/TestUtils.test_find_original_update_blocks_quote_below_filename'] } }, () => {
  const edit = `
Here's the change:

foo.txt
\`\`\`text
<<<<<<< SEARCH
Two
=======
Tooooo
>>>>>>> REPLACE
\`\`\`

Hope you like it!
`;
  expect(findOriginalUpdateBlocks(edit)).toEqual([['foo.txt', 'Two\n', 'Tooooo\n']]);
});

test('rejects an unclosed SEARCH/REPLACE block', { meta: { aider: ['test_editblock/TestUtils.test_find_original_update_blocks_unclosed'] } }, () => {
  const edit = `
Here's the change:

\`\`\`text
foo.txt
<<<<<<< SEARCH
Two
=======
Tooooo


oops!
`;
  expect(() => findOriginalUpdateBlocks(edit)).toThrow(/Expected `>>>>>>> REPLACE` or `=======`/);
});

test('rejects a block with no recoverable filename', { meta: { aider: ['test_editblock/TestUtils.test_find_original_update_blocks_missing_filename'] } }, () => {
  const edit = `
Here's the change:

\`\`\`text
<<<<<<< SEARCH
Two
=======
Tooooo


oops!
>>>>>>> REPLACE
`;
  expect(() => findOriginalUpdateBlocks(edit)).toThrow(/filename/);
});

test('parses blocks when the reply has no final newline', { meta: { aider: ['test_editblock/TestUtils.test_find_original_update_blocks_no_final_newline'] } }, () => {
  const edit = `
aider/coder.py
<<<<<<< SEARCH
            self.console.print("[red]^C again to quit")
=======
            self.io.tool_error("^C again to quit")
>>>>>>> REPLACE

aider/coder.py
<<<<<<< SEARCH
            self.io.tool_error("Malformed ORIGINAL/UPDATE blocks, retrying...")
            self.io.tool_error(err)
=======
            self.io.tool_error("Malformed ORIGINAL/UPDATE blocks, retrying...")
            self.io.tool_error(str(err))
>>>>>>> REPLACE

aider/coder.py
<<<<<<< SEARCH
            self.console.print("[red]Unable to get commit message from gpt-3.5-turbo. Use /commit to try again.\n")
=======
            self.io.tool_error("Unable to get commit message from gpt-3.5-turbo. Use /commit to try again.")
>>>>>>> REPLACE

aider/coder.py
<<<<<<< SEARCH
            self.console.print("[red]Skipped commit.")
=======
            self.io.tool_error("Skipped commit.")
>>>>>>> REPLACE`;
  expect(findOriginalUpdateBlocks(edit)).toHaveLength(4);
});

test('reuses the previous filename for an incomplete block', { meta: { aider: ['test_editblock/TestUtils.test_incomplete_edit_block_missing_filename'] } }, () => {
  const edit = `
No problem! Here are the changes to patch \`subprocess.check_output\` instead of \`subprocess.run\` in both tests:

\`\`\`python
tests/test_repomap.py
<<<<<<< SEARCH
    def test_check_for_ctags_failure(self):
        with patch("subprocess.run") as mock_run:
            mock_run.side_effect = Exception("ctags not found")
=======
    def test_check_for_ctags_failure(self):
        with patch("subprocess.check_output") as mock_check_output:
            mock_check_output.side_effect = Exception("ctags not found")
>>>>>>> REPLACE

<<<<<<< SEARCH
    def test_check_for_ctags_success(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = CompletedProcess(args=["ctags", "--version"], returncode=0, stdout='''{
  "_type": "tag",
  "name": "status",
  "path": "aider/main.py",
  "pattern": "/^    status = main()$/",
  "kind": "variable"
}''')
=======
    def test_check_for_ctags_success(self):
        with patch("subprocess.check_output") as mock_check_output:
            mock_check_output.return_value = '''{
  "_type": "tag",
  "name": "status",
  "path": "aider/main.py",
  "pattern": "/^    status = main()$/",
  "kind": "variable"
}'''
>>>>>>> REPLACE
\`\`\`

These changes replace the \`subprocess.run\` patches with \`subprocess.check_output\` patches in both \`test_check_for_ctags_failure\` and \`test_check_for_ctags_success\` tests.
`;
  const blocks = findOriginalUpdateBlocks(edit);
  expect(blocks).toHaveLength(2);
  expect(blocks[0]?.[0]).toBe('tests/test_repomap.py');
  expect(blocks[1]?.[0]).toBe('tests/test_repomap.py');
});

test('repairs varied missing leading whitespace', { meta: { aider: ['test_editblock/TestUtils.test_replace_part_with_missing_varied_leading_whitespace'] } }, () => {
  const whole = `
    line1
    line2
        line3
    line4
`;
  expect(replaceMostSimilarChunk(whole, 'line2\n    line3\n', 'new_line2\n    new_line3\n')).toBe(`
    line1
    new_line2
        new_line3
    line4
`);
});

test('repairs uniform missing leading whitespace', { meta: { aider: ['test_editblock/TestUtils.test_replace_part_with_missing_leading_whitespace'] } }, () => {
  expect(replaceMostSimilarChunk('    line1\n    line2\n    line3\n', 'line1\nline2\n', 'new_line1\nnew_line2\n')).toBe('    new_line1\n    new_line2\n    line3\n');
});

test('replaces only the first exact match', {
  meta: {
    aider: ['test_editblock/TestUtils.test_replace_multiple_matches'],
    evidence: ['ev-edit/probe/duplicate-search-first-match', 'ev-edit/cli-apply/diff-update'],
  },
}, async () => {
  expect(replaceMostSimilarChunk('line1\nline2\nline1\nline3\n', 'line1\n', 'new_line\n')).toBe('new_line\nline2\nline1\nline3\n');
  expect(await doReplace('sample.py', 'x = 1\nx = 1\n', 'x = 1\n', 'x = 2\n', fence, alwaysExists)).toBe('x = 2\nx = 1\n');
  expect(await doReplace('sample.py', 'value = 100\n', 'value = 100\n', 'value = 200\n', fence, alwaysExists)).toBe('value = 200\n');
});

test('replaces only the first whitespace-tolerant match', { meta: { aider: ['test_editblock/TestUtils.test_replace_multiple_matches_missing_whitespace'] } }, () => {
  expect(replaceMostSimilarChunk('    line1\n    line2\n    line1\n    line3\n', 'line1\n', 'new_line\n')).toBe('    new_line\n    line2\n    line1\n    line3\n');
});

test('repairs partially missing leading whitespace', { meta: { aider: ['test_editblock/TestUtils.test_replace_part_with_just_some_missing_leading_whitespace'] } }, () => {
  expect(replaceMostSimilarChunk('    line1\n    line2\n    line3\n', ' line1\n line2\n', ' new_line1\n     new_line2\n')).toBe('    new_line1\n        new_line2\n    line3\n');
});

test('skips a leading blank SEARCH line then matches', {
  meta: {
    aider: ['test_editblock/TestUtils.test_replace_part_with_missing_leading_whitespace_including_blank_line'],
    evidence: ['ev-edit/probe/indentation-recovery'],
  },
}, async () => {
  expect(replaceMostSimilarChunk('    line1\n    line2\n    line3\n', '\n  line1\n  line2\n', '  new_line1\n  new_line2\n')).toBe('    new_line1\n    new_line2\n    line3\n');
  expect(await doReplace('sample.py', 'def f():\n    x = 1\n', 'x = 1\n', 'x = 2\n', fence, alwaysExists)).toBe('def f():\n    x = 2\n');
});

test('creates a new file without remapping an in-chat neighbor', { meta: { aider: ['test_editblock/TestUtils.test_create_new_file_with_other_file_in_chat'] } }, async () => {
  const ctx = await workspace({ 'file.txt': 'one\ntwo\nthree\n', 'newfile.txt': '' });
  const reply = `newfile.txt
<<<<<<< SEARCH
=======
creating a new file
>>>>>>> REPLACE
`;
  const { edits } = getEdits(reply, ctx);
  await applyEdits(edits, ctx);
  expect(await readFile(join(ctx.root, 'file.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
  expect(await readFile(join(ctx.root, 'newfile.txt'), 'utf8')).toBe('creating a new file\n');
});

test('reuses filename across multiple blocks for one file', { meta: { aider: ['test_editblock/TestUtils.test_find_original_update_blocks_mupltiple_same_file'] } }, () => {
  const edit = `
Here's the change:

\`\`\`text
foo.txt
<<<<<<< SEARCH
one
=======
two
>>>>>>> REPLACE

...

<<<<<<< SEARCH
three
=======
four
>>>>>>> REPLACE
\`\`\`

Hope you like it!
`;
  expect(findOriginalUpdateBlocks(edit)).toEqual([
    ['foo.txt', 'one\n', 'two\n'],
    ['foo.txt', 'three\n', 'four\n'],
  ]);
});

test('recovers a filename past a mangled fence pair', { meta: { aider: ['test_editblock/TestUtils.test_deepseek_coder_v2_filename_mangling'] } }, () => {
  const edit = `
Here's the change:

 \`\`\`python
foo.txt
\`\`\`
\`\`\`python
<<<<<<< SEARCH
one
=======
two
>>>>>>> REPLACE
\`\`\`

Hope you like it!
`;
  expect(findOriginalUpdateBlocks(edit)).toEqual([['foo.txt', 'one\n', 'two\n']]);
});

test('keeps a new empty-SEARCH filename unmatched to chat files', { meta: { aider: ['test_editblock/TestUtils.test_new_file_created_in_same_folder'] } }, () => {
  const edit = `
Here's the change:

path/to/a/file2.txt
\`\`\`python
<<<<<<< SEARCH
=======
three
>>>>>>> REPLACE
\`\`\`

another change

path/to/a/file1.txt
\`\`\`python
<<<<<<< SEARCH
one
=======
two
>>>>>>> REPLACE
\`\`\`

Hope you like it!
`;
  expect(findOriginalUpdateBlocks(edit, fence, ['path/to/a/file1.txt'])).toEqual([
    ['path/to/a/file2.txt', '', 'three\n'],
    ['path/to/a/file1.txt', 'one\n', 'two\n'],
  ]);
});

test('parses under quad backticks when the reply uses triples', { meta: { aider: ['test_editblock/TestUtils.test_find_original_update_blocks_quad_backticks_with_triples_in_LLM_reply'] } }, () => {
  const edit = `
Here's the change:

foo.txt
\`\`\`text
<<<<<<< SEARCH
=======
Tooooo
>>>>>>> REPLACE
\`\`\`

Hope you like it!
`;
  const quad = ['````', '````'] as const;
  expect(findOriginalUpdateBlocks(edit, quad)).toEqual([['foo.txt', '', 'Tooooo\n']]);
});

test('treats a shell fence with SEARCH as an edit not a command', { meta: { aider: ['test_editblock/TestUtils.test_find_original_update_blocks_with_sh_language_identifier'] } }, () => {
  const edit = `
Here's a shell script:

\`\`\`sh
test_hello.sh
<<<<<<< SEARCH
=======
#!/bin/bash
# Check if exactly one argument is provided
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <argument>" >&2
    exit 1
fi

# Echo the first argument
echo "$1"

exit 0
>>>>>>> REPLACE
\`\`\`
`;
  const blocks = findOriginalUpdateBlocks(edit);
  expect(blocks).toHaveLength(1);
  expect(blocks[0]?.[0]).toBe('test_hello.sh');
  expect(blocks[0]?.[1]).toBe('');
  expect(blocks[0]?.[2]).toContain('#!/bin/bash');
  expect(blocks[0]?.[2]).toContain('echo "$1"');
});

test('parses a csharp-fenced SEARCH/REPLACE block', { meta: { aider: ['test_editblock/TestUtils.test_find_original_update_blocks_with_csharp_language_identifier'] } }, () => {
  const edit = `
Here's a C# code change:

\`\`\`csharp
Program.cs
<<<<<<< SEARCH
Console.WriteLine("Hello World!");
=======
Console.WriteLine("Hello, C# World!");
>>>>>>> REPLACE
\`\`\`
`;
  expect(findOriginalUpdateBlocks(edit)).toEqual([['Program.cs', 'Console.WriteLine("Hello World!");\n', 'Console.WriteLine("Hello, C# World!");\n']]);
});

test('collects a bare bash fence as a suggested shell command', { meta: { aider: ['test_coder/TestCoder.test_suggest_shell_commands'] } }, () => {
  const reply = `Here's a shell command to run:

\`\`\`bash
echo "Hello, World!"
\`\`\`

This command will print 'Hello, World!' to the console.`;
  const { edits, shellCommands } = getEdits(reply, { fence, root: '/tmp', absFnames: new Set() });
  expect(edits).toEqual([]);
  expect(shellCommands).toHaveLength(1);
  expect(shellCommands[0]?.trim()).toBe('echo "Hello, World!"');
});

test('parses markdown sections into edits shell commands and errors', { meta: { aider: ['test_find_or_blocks/TestFindOrBlocks.test_process_markdown'] } }, () => {
  const editsAndShell = `#### Apply the helper change

\`\`\`
helpers.py
<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
\`\`\`

#### Suggest a shell command

\`\`\`bash
echo hi
\`\`\`
`;
  expect(findOriginalUpdateBlocks(editsAndShell)).toEqual([
    ['helpers.py', 'old\n', 'new\n'],
    [null, 'echo hi\n'],
  ]);
  expect(() =>
    findOriginalUpdateBlocks(`#### Broken block

\`\`\`
broken.py
<<<<<<< SEARCH
x
=======
y
`),
  ).toThrow(/Expected `>>>>>>> REPLACE` or `=======`/);
});

test('accepts SEARCH markers from five to nine characters', async () => {
  expect(findOriginalUpdateBlocks('a.py\n<<<<< SEARCH\nx\n=====\ny\n>>>>> REPLACE\n')).toEqual([['a.py', 'x\n', 'y\n']]);
  expect(findOriginalUpdateBlocks('a.py\n<<<<<<<<< SEARCH\nx\n=========\ny\n>>>>>>>>> REPLACE\n')).toEqual([['a.py', 'x\n', 'y\n']]);
  expect(findOriginalUpdateBlocks('a.py\n<<<<<<< SEARCH>\nx\n=======\ny\n>>>>>>> REPLACE\n')).toEqual([['a.py', 'x\n', 'y\n']]);
});

test('ends REPLACE text at the next divider line', () => {
  const edit = `a.py
<<<<<<< SEARCH
x
=======
y
=======
ignored
>>>>>>> REPLACE
`;
  expect(findOriginalUpdateBlocks(edit)).toEqual([['a.py', 'x\n', 'y\n']]);
});

test('appends REPLACE when SEARCH is empty', { meta: { evidence: ['ev-edit/probe/empty-search-appends'] } }, async () => {
  expect(await doReplace('sample.py', 'x = 1\n', '', 'x = 2\n', fence, alwaysExists)).toBe('x = 1\nx = 2\n');
});

test('normalizes missing final newlines before matching', { meta: { evidence: ['ev-edit/probe/newline-normalization'] } }, async () => {
  expect(await doReplace('sample.py', 'x = 1', 'x = 1', 'x = 2', fence, alwaysExists)).toBe('x = 2\n');
});

test('fails when SEARCH is only similar not exact', { meta: { evidence: ['ev-edit/probe/fuzzy-content-disabled'] } }, async () => {
  expect(await doReplace('sample.py', 'value = 100\n', 'value = 101\n', 'value = 200\n', fence, alwaysExists)).toBeNull();
});

test('applies ellipsis SEARCH pieces in order', () => {
  const whole = 'def f():\n    x = 0\n    return 1\n';
  const part = 'def f():\n...\n    return 1\n';
  const replace = 'def f():\n...\n    return 2\n';
  expect(replaceMostSimilarChunk(whole, part, replace)).toBe('def f():\n    x = 0\n    return 2\n');
});

test('falls back to another chat file when the named file misses', async () => {
  const ctx = await workspace({
    'named.py': 'unrelated\n',
    'other.py': 'target\n',
  });
  const reply = `named.py
<<<<<<< SEARCH
target
=======
changed
>>>>>>> REPLACE
`;
  const { edits } = getEdits(reply, ctx);
  await applyEdits(edits, ctx);
  expect(await readFile(join(ctx.root, 'named.py'), 'utf8')).toBe('unrelated\n');
  expect(await readFile(join(ctx.root, 'other.py'), 'utf8')).toBe('changed\n');
});

test('reports unmatched blocks with similar lines and keep-applied note', async () => {
  const ctx = await workspace({ 'file.txt': 'alpha\nbeta\n' });
  const reply = `file.txt
<<<<<<< SEARCH
alpha
=======
ALPHA
>>>>>>> REPLACE

file.txt
<<<<<<< SEARCH
missing
=======
nope
>>>>>>> REPLACE
`;
  const { edits } = getEdits(reply, ctx);
  let error: unknown;
  try {
    await applyEdits(edits, ctx);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(ValueError);
  expect(String(error)).toMatch(/SEARCH\/REPLACE blocks? failed to match/);
  expect(String(error)).toMatch(/Don't re-send them/);
  expect(await readFile(join(ctx.root, 'file.txt'), 'utf8')).toBe('ALPHA\nbeta\n');
});

test('empty REPLACE that clears a file is failure not fallback', async () => {
  const ctx = await workspace({ 'keep.py': 'gone\n', 'other.py': 'gone\n' });
  expect(perfectOrWhitespace(['gone\n'], ['gone\n'], [])).toBeNull();
  expect(replaceMostSimilarChunk('gone\n', 'gone\n', '')).toBeNull();
  const reply = `keep.py
<<<<<<< SEARCH
gone
=======
>>>>>>> REPLACE
`;
  const { edits } = getEdits(reply, ctx);
  await expect(applyEdits(edits, ctx)).rejects.toThrow(ValueError);
  expect(await readFile(join(ctx.root, 'keep.py'), 'utf8')).toBe('gone\n');
  expect(await readFile(join(ctx.root, 'other.py'), 'utf8')).toBe('gone\n');
});

test('preflight targets match sequential apply for dependent blocks', async () => {
  const ctx = await workspace({ 'named.py': 'one\n', 'other.py': 'two\n' });
  const edits: [string, string, string][] = [
    ['named.py', 'one\n', 'two\n'],
    ['named.py', 'two\n', 'three\n'],
  ];
  const planned = await applyEditsDryRun(edits, ctx);
  expect(planned.map(([path]) => path)).toEqual(['named.py', 'named.py']);
  expect(await readFile(join(ctx.root, 'named.py'), 'utf8')).toBe('one\n');
  expect(await readFile(join(ctx.root, 'other.py'), 'utf8')).toBe('two\n');
  await applyEdits(edits, ctx);
  expect(await readFile(join(ctx.root, 'named.py'), 'utf8')).toBe('three\n');
  expect(await readFile(join(ctx.root, 'other.py'), 'utf8')).toBe('two\n');
});
