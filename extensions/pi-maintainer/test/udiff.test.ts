import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { ValueError } from '../src/edit/errors.ts';
import { udiffEditFormat, udiffSimpleFormat } from '../src/edit/feature.ts';
import { allPreprocs } from '../src/edit/search-replace.ts';
import { applyEdits, applyHunk, directlyApplyHunk, findDiffs, getEdits, hunkToBeforeAfter, makeNewLinesExplicit } from '../src/edit/udiff.ts';
import { createWorkingTree } from '../src/edit/working-tree.ts';
import type { EditContext } from '../src/feature.ts';
import { pyLength, splitlines, strip } from '../src/support/pystr.ts';

const notices = {
  output() {},
  warning() {},
  error() {},
};

function udiffTree() {
  return createWorkingTree({ notices });
}

test('parses a single fenced hunk', { meta: { aider: ['test_udiff/TestUnifiedDiffCoder.test_find_diffs_single_hunk'] } }, () => {
  const content = `
Some text...

\`\`\`diff
--- file.txt
+++ file.txt
@@ ... @@
-Original
+Modified
\`\`\`
`;
  const edits = findDiffs(content);
  expect(edits).toEqual([['file.txt', ['-Original\n', '+Modified\n']]]);
});

test('strips /dev/null creation headers', { meta: { aider: ['test_udiff/TestUnifiedDiffCoder.test_find_diffs_dev_null'] } }, () => {
  const content = `
Some text...

\`\`\`diff
--- /dev/null
+++ file.txt
@@ ... @@
-Original
+Modified
\`\`\`
`;
  expect(findDiffs(content)).toEqual([['file.txt', ['-Original\n', '+Modified\n']]]);
});

test('keeps spaces in directory names', { meta: { aider: ['test_udiff/TestUnifiedDiffCoder.test_find_diffs_dirname_with_spaces'] } }, () => {
  const content = `
Some text...

\`\`\`diff
--- dir name with spaces/file.txt
+++ dir name with spaces/file.txt
@@ ... @@
-Original
+Modified
\`\`\`
`;
  expect(findDiffs(content)).toEqual([['dir name with spaces/file.txt', ['-Original\n', '+Modified\n']]]);
});

test('parses multiple files from one fence', { meta: { aider: ['test_udiff/TestUnifiedDiffCoder.test_find_multi_diffs'] } }, () => {
  const content = `
\`\`\`diff
--- aider/versioncheck.py
+++ aider/versioncheck.py
@@ ... @@
     except Exception as err:
         print_cmd(f"Error checking pypi for new version: {err}")
+        return False

--- aider/main.py
+++ aider/main.py
@@ ... @@
     other_group.add_argument(
         "--version",
         action="version",
         version=f"%(prog)s {__version__}",
         help="Show the version number and exit",
     )
+    other_group.add_argument(
+        "--check-update",
+        action="store_true",
+        help="Check for updates and return status in the exit code",
+        default=False,
+    )
     other_group.add_argument(
         "--apply",
         metavar="FILE",
\`\`\`
`;
  const edits = findDiffs(content);
  expect(edits).toHaveLength(2);
  expect(edits[0]?.[1]).toHaveLength(3);
});

test('replays the recorded udiff CLI replacement content', { meta: { evidence: ['ev-edit/cli-apply/udiff-update'] } }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'udiff-cli-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'sample.py'), 'value = 100\n');
  const tree = createWorkingTree({
    notices: {
      output() {},
      warning() {},
      error() {},
    },
  });
  await applyEdits([['sample.py', ['-value = 100\n', '+value = 200\n']]], {
    root,
    absFnames: new Set(),
    absRootPath: (path) => resolve(root, path),
    tree,
  });
  expect(await readFile(join(root, 'sample.py'), 'utf8')).toBe('value = 200\n');
});

test('literal udiff replace changes every occurrence', { meta: { evidence: ['ev-edit/probe/udiff-literal-replaces-all'] } }, () => {
  expect(directlyApplyHunk('value = 100\nvalue = 100\n', ['-value = 100\n', '+value = 200\n'])).toBe('value = 200\nvalue = 200\n');
});

test('udiff format plans an upsert and applies the hunk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'udiff-format-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'file.txt'), 'Original\n');
  const tree = createWorkingTree({
    notices: {
      output() {},
      warning() {},
      error() {},
    },
  });
  const context: EditContext = {
    fence: ['```', '```'],
    root,
    inchatRelativeFiles: ['file.txt'],
    absRootPath: (path) => resolve(root, path),
    tree,
    notices: {
      output() {},
      warning() {},
      error() {},
    },
  };
  const reply = ['```diff', '--- file.txt', '+++ file.txt', '@@', '-Original', '+Modified', '```', ''].join('\n');
  await udiffEditFormat.withPlan(
    reply,
    context,
    async (candidates) => [...candidates],
    async (plan) => {
      expect(plan.targets).toEqual(['file.txt']);
      await plan.apply();
    },
  );
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('Modified\n');
});

test('udiff-simple shares the upsert apply path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'udiff-simple-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'file.txt'), 'a\n');
  const tree = createWorkingTree({
    notices: {
      output() {},
      warning() {},
      error() {},
    },
  });
  const context: EditContext = {
    fence: ['```', '```'],
    root,
    inchatRelativeFiles: ['file.txt'],
    absRootPath: (path) => resolve(root, path),
    tree,
    notices: {
      output() {},
      warning() {},
      error() {},
    },
  };
  await udiffSimpleFormat.withPlan(
    '```diff\n--- file.txt\n+++ file.txt\n@@\n-a\n+b\n```\n',
    context,
    async (candidates) => [...candidates],
    async (plan) => {
      expect(plan.targets).toEqual(['file.txt']);
      await plan.apply();
    },
  );
  expect(await readFile(join(root, 'file.txt'), 'utf8')).toBe('b\n');
});

test('getEdits inherits the prior path across fences', () => {
  expect(getEdits('```diff\n--- file.txt\n+++ file.txt\n@@\n-a\n+b\n```\n```diff\n@@\n-c\n+d\n```\n')).toEqual([
    ['file.txt', ['-a\n', '+b\n']],
    ['file.txt', ['-c\n', '+d\n']],
  ]);
});

test('applyEdits keeps earlier writes when a later hunk fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'udiff-partial-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'a.txt'), 'old\n');
  await writeFile(join(root, 'b.txt'), 'keep\n');
  const tree = udiffTree();
  await expect(
    applyEdits(
      [
        ['a.txt', ['-old\n', '+new\n']],
        ['b.txt', ['-missing\n', '+x\n']],
      ],
      {
        root,
        absFnames: new Set(),
        absRootPath: (path) => resolve(root, path),
        tree,
      },
    ),
  ).rejects.toThrow(/UnifiedDiffNoMatch/);
  expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('new\n');
  expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('keep\n');
});

test('partial success omits the sibling-hunks note when the joined error is longer than the hunk count', async () => {
  const root = await mkdtemp(join(tmpdir(), 'udiff-partial-note-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'a.txt'), 'old\n');
  await writeFile(join(root, 'b.txt'), 'keep\n');
  const tree = udiffTree();
  let message = '';
  try {
    await applyEdits(
      [
        ['a.txt', ['-old\n', '+new\n']],
        ['b.txt', ['-missing\n', '+x\n']],
      ],
      {
        root,
        absFnames: new Set(),
        absRootPath: (path) => resolve(root, path),
        tree,
      },
    );
  } catch (error) {
    expect(error).toBeInstanceOf(ValueError);
    message = error instanceof Error ? error.message : '';
  }
  expect(message).toMatch(/^UnifiedDiffNoMatch:/);
  expect(message).not.toContain('Note: some hunks did apply successfully');
  expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('new\n');
});

test('rebuilds before text from the file when direct replace fails', () => {
  const content = 'aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\ndddddddddd\n';
  const hunk = ['-aaaaaaaaaa\n', '-bbbbbbbbbb\n', '-cccXcccccc\n', '+AAAAAAAAAA\n', '+BBBBBBBBBB\n', '+CCCCCCCCCC\n', ' dddddddddd\n'];
  expect(directlyApplyHunk(content, hunk)).toBeUndefined();
  const rebuilt = makeNewLinesExplicit(content, hunk);
  expect(rebuilt).not.toEqual(hunk);
  const [originalBefore] = hunkToBeforeAfter(hunk);
  const [rebuiltBefore] = hunkToBeforeAfter(rebuilt);
  expect(pyLength(strip(rebuiltBefore))).toBeGreaterThanOrEqual(10);
  expect(splitlines(rebuiltBefore, true).length).toBeGreaterThanOrEqual(splitlines(originalBefore, true).length * 0.66);
  expect(applyHunk(content, hunk)).toBeDefined();
});

test('keeps the original hunk when repaired before text is too short', () => {
  const content = 'abcdefghi\n';
  const hunk = ['-ab\n', '+zz\n'];
  expect(makeNewLinesExplicit(content, hunk)).toEqual(hunk);
});

test('udiff refuses a reverse-lines-only match and never enables reverse preprocs', () => {
  expect(allPreprocs.every(([, , reverse]) => reverse === false)).toBe(true);
  const content = 'line3\nline2\nline1\n';
  const hunk = ['-line1\n', '-line2\n', '-line3\n', '+done\n'];
  expect(directlyApplyHunk(content, hunk)).toBeUndefined();
  expect(applyHunk(content, hunk)).toBeUndefined();
});
