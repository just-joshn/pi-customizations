import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { Type } from 'typebox';
import { expect, onTestFinished, test } from 'vitest';
import { absRootPath } from '../src/edit/coder-paths.ts';
import { allPreprocs, diffLines, flexibleSearchAndReplace, relativeIndent, searchAndReplace } from '../src/edit/search-replace.ts';
import { applyEdits, applyHunk, cleanupPureWhitespaceLines, directlyApplyHunk, doReplace, findDiffs, getEdits, hunkToBeforeAfter, makeNewLinesExplicit, normalizeHunk, type UdiffEdit } from '../src/edit/udiff.ts';
import { createWorkingTree } from '../src/edit/working-tree.ts';
import { oracleCases, outcomeOf } from './support/oracle.ts';

const lines = Type.Array(Type.String());
const hunk = Type.Array(Type.String());
const edit = Type.Tuple([Type.Union([Type.String(), Type.Null()]), hunk]);

test.for(oracleCases('udiff', 'udiff.find_diffs', Type.Object({ content: Type.String() })))('find diffs $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => findDiffs(args.content))).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.get_edits', Type.Object({ content: Type.String() })))('get edits $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => getEdits(args.content))).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.hunk_to_before_after', Type.Object({ hunk, lines: Type.Optional(Type.Boolean()) })))('hunk before after $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => (args.lines ? hunkToBeforeAfter(args.hunk, true) : hunkToBeforeAfter(args.hunk)))).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.cleanup_pure_whitespace_lines', Type.Object({ lines })))('cleanup whitespace $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => cleanupPureWhitespaceLines(args.lines))).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.normalize_hunk', Type.Object({ hunk })))('normalize hunk $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => normalizeHunk(args.hunk))).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.diff_lines', Type.Object({ search_text: Type.String(), replace_text: Type.String() })))('diff lines $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => diffLines(args.search_text, args.replace_text))).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.search_and_replace', Type.Object({ search_text: Type.String(), replace_text: Type.String(), original_text: Type.String() })))('search and replace $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => searchAndReplace([args.search_text, args.replace_text, args.original_text]) ?? null)).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.flexible_search_and_replace', Type.Object({ search_text: Type.String(), replace_text: Type.String(), original_text: Type.String() })))('flexible search replace $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => flexibleSearchAndReplace([args.search_text, args.replace_text, args.original_text], [[searchAndReplace, allPreprocs]]) ?? null)).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.relative_indent_roundtrip', Type.Object({ search_text: Type.String(), replace_text: Type.String(), original_text: Type.String() })))('relative indent $id', async ({ args, expected }) => {
  expect(
    await outcomeOf(() => {
      const texts = [args.search_text, args.replace_text, args.original_text] as const;
      const [ri, relative] = relativeIndent(texts);
      return { relative: [...relative], absolute: relative.map((text) => ri.makeAbsolute(text)), marker: ri.marker };
    }),
  ).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.directly_apply_hunk', Type.Object({ content: Type.String(), hunk })))('directly apply $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => directlyApplyHunk(args.content, args.hunk) ?? null)).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.make_new_lines_explicit', Type.Object({ content: Type.String(), hunk })))('make new lines $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => makeNewLinesExplicit(args.content, args.hunk))).toEqual(expected);
});

test.for(oracleCases('udiff', 'udiff.apply_hunk', Type.Object({ content: Type.String(), hunk })))('apply hunk $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => applyHunk(args.content, args.hunk) ?? null)).toEqual(expected);
});

test.for(
  oracleCases(
    'udiff',
    'udiff.do_replace',
    Type.Object({
      fname: Type.String(),
      exists: Type.Optional(Type.Boolean()),
      content: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      hunk,
    }),
  ),
)('do replace $id', async ({ args, expected }) => {
  const root = await mkdtemp(join(tmpdir(), 'udiff-do-replace-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, args.fname);
  if (args.exists) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, args.content ?? '', 'utf8');
  }
  const tree = createWorkingTree({
    notices: {
      output() {},
      warning() {},
      error() {},
    },
  });
  expect(
    await outcomeOf(async () => {
      const result = await doReplace(path, args.content ?? null, args.hunk, tree);
      return { result: result ?? null, exists_after: await tree.exists(path) };
    }),
  ).toEqual(expected);
});

async function plant(root: string, files: Record<string, string | null>) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    if (content === null) {
      await mkdir(path, { recursive: true });
      continue;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }
}

async function treeState(root: string): Promise<Record<string, string | null>> {
  const entries: Record<string, string | null> = {};
  async function walk(dir: string) {
    for (const name of await readdir(dir)) {
      const path = join(dir, name);
      const info = await stat(path);
      const rel = relative(root, path).split('\\').join('/');
      if (info.isDirectory()) {
        entries[rel] = null;
        await walk(path);
      } else {
        entries[rel] = await readFile(path, 'utf8');
      }
    }
  }
  await walk(root);
  return Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)));
}

const coderArgs = Type.Object({
  edits: Type.Array(edit),
  files: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()]))),
  io_dry_run: Type.Optional(Type.Boolean()),
});

test.for(oracleCases('udiff', 'udiff.apply_edits', coderArgs))('apply edits $id', async ({ args, expected }) => {
  expect(
    await outcomeOf(async () => {
      const root = await mkdtemp(join(tmpdir(), 'udiff-apply-'));
      onTestFinished(() => rm(root, { recursive: true, force: true }));
      await plant(root, args.files ?? {});
      const errors: string[] = [];
      const tree = createWorkingTree({
        dryRun: args.io_dry_run ?? false,
        notices: {
          output() {},
          warning() {},
          error(message) {
            errors.push(message);
          },
        },
      });
      const ctx = {
        root,
        absFnames: new Set<string>(),
        absRootPath: (path: string) => absRootPath(root, path),
        tree,
      };
      const outcome = await outcomeOf(async () => {
        await applyEdits(args.edits as UdiffEdit[], ctx);
        return null;
      });
      return {
        outcome,
        files: await treeState(root),
        errors: errors.map((message) => message.replaceAll(root, '<root>').replaceAll(resolve(root), '<root>')),
      };
    }),
  ).toEqual(expected);
});
