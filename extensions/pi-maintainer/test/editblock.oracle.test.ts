import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { Type } from 'typebox';
import { expect, onTestFinished, test } from 'vitest';
import { absRootPath } from '../src/edit/coder-paths.ts';
import { applyEdits, applyEditsDryRun, doReplace, getEdits, stripQuotedWrapping } from '../src/edit/editblock.ts';
import { findSimilarLines, matchButForLeadingWhitespace, perfectOrWhitespace, perfectReplace, prep, replaceMostSimilarChunk, replacePartWithMissingLeadingWhitespace, tryDotdotdots } from '../src/edit/editblock-match.ts';
import { DEFAULT_FENCE, findFilename, findOriginalUpdateBlocks, stripFilename } from '../src/edit/editblock-parse.ts';
import { createWorkingTree } from '../src/edit/working-tree.ts';
import { oracleCases, outcomeOf } from './support/oracle.ts';

const fence = Type.Tuple([Type.String(), Type.String()]);
const lines = Type.Array(Type.String());
const edit = Type.Tuple([Type.String(), Type.String(), Type.String()]);

test.for(oracleCases('editblock', 'editblock.find_original_update_blocks', Type.Object({ content: Type.String(), valid_fnames: Type.Optional(Type.Array(Type.String())), fence: Type.Optional(fence) })))(
  'find blocks $id',
  async ({ args, expected }) => {
    expect(await outcomeOf(() => findOriginalUpdateBlocks(args.content, args.fence ?? DEFAULT_FENCE, args.valid_fnames ?? null))).toEqual(expected);
  },
);

test.for(oracleCases('editblock', 'editblock.replace_most_similar_chunk', Type.Object({ whole: Type.String(), part: Type.String(), replace: Type.String() })))('replace chunk $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => replaceMostSimilarChunk(args.whole, args.part, args.replace))).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.find_similar_lines', Type.Object({ search_lines: Type.String(), content_lines: Type.String(), threshold: Type.Optional(Type.Number()) })))('similar lines $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => findSimilarLines(args.search_lines, args.content_lines, args.threshold ?? 0.6))).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.strip_filename', Type.Object({ filename: Type.String(), fence: Type.Optional(fence) })))('strip filename $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => stripFilename(args.filename, args.fence ?? DEFAULT_FENCE))).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.find_filename', Type.Object({ lines, valid_fnames: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])), fence: Type.Optional(fence) })))(
  'find filename $id',
  async ({ args, expected }) => {
    expect(await outcomeOf(() => findFilename(args.lines, args.fence ?? DEFAULT_FENCE, args.valid_fnames ?? null))).toEqual(expected);
  },
);

test.for(oracleCases('editblock', 'editblock.prep', Type.Object({ content: Type.String() })))('prep $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => prep(args.content))).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.perfect_replace', Type.Object({ whole_lines: lines, part_lines: lines, replace_lines: lines })))('perfect replace $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => perfectReplace(args.whole_lines, args.part_lines, args.replace_lines))).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.perfect_or_whitespace', Type.Object({ whole_lines: lines, part_lines: lines, replace_lines: lines })))('perfect or whitespace $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => perfectOrWhitespace(args.whole_lines, args.part_lines, args.replace_lines))).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.match_but_for_leading_whitespace', Type.Object({ whole_lines: lines, part_lines: lines })))('match whitespace $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => matchButForLeadingWhitespace(args.whole_lines, args.part_lines))).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.replace_part_with_missing_leading_whitespace', Type.Object({ whole_lines: lines, part_lines: lines, replace_lines: lines })))('missing whitespace $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => replacePartWithMissingLeadingWhitespace(args.whole_lines, args.part_lines, args.replace_lines))).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.try_dotdotdots', Type.Object({ whole: Type.String(), part: Type.String(), replace: Type.String() })))('dotdotdots $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => tryDotdotdots(args.whole, args.part, args.replace))).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.strip_quoted_wrapping', Type.Object({ res: Type.String(), fname: Type.Optional(Type.Union([Type.String(), Type.Null()])), fence: Type.Optional(fence) })))(
  'strip wrapping $id',
  async ({ args, expected }) => {
    expect(await outcomeOf(() => stripQuotedWrapping(args.res, args.fname ?? null, args.fence ?? DEFAULT_FENCE))).toEqual(expected);
  },
);

test.for(
  oracleCases(
    'editblock',
    'editblock.do_replace',
    Type.Object({
      fname: Type.String(),
      exists: Type.Optional(Type.Boolean()),
      content: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      before_text: Type.String(),
      after_text: Type.String(),
      fence: Type.Optional(fence),
    }),
  ),
)('do replace $id', async ({ args, expected }) => {
  const root = await mkdtemp(join(tmpdir(), 'editblock-do-replace-'));
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
      const result = await doReplace(path, args.content ?? null, args.before_text, args.after_text, args.fence ?? DEFAULT_FENCE, tree);
      return { result, exists_after: await tree.exists(path) };
    }),
  ).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.get_edits', Type.Object({ content: Type.String(), chat_files: Type.Optional(Type.Array(Type.String())), fence: Type.Optional(fence) })))('get edits $id', async ({ args, expected }) => {
  const root = await mkdtemp(join(tmpdir(), 'editblock-get-edits-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  expect(
    await outcomeOf(() => {
      const parsed = getEdits(args.content, {
        fence: args.fence ?? DEFAULT_FENCE,
        root,
        absFnames: new Set((args.chat_files ?? []).map((name) => absRootPath(root, name))),
      });
      return { edits: parsed.edits, shell_commands: parsed.shellCommands };
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
  chat_files: Type.Optional(Type.Array(Type.String())),
  fence: Type.Optional(fence),
  io_dry_run: Type.Optional(Type.Boolean()),
});

async function runCoder(
  args: {
    readonly edits: readonly (readonly [string, string, string])[];
    readonly files?: Record<string, string | null>;
    readonly chat_files?: readonly string[];
    readonly fence?: readonly [string, string];
    readonly io_dry_run?: boolean;
  },
  method: 'apply_edits' | 'apply_edits_dry_run',
) {
  const root = await mkdtemp(join(tmpdir(), 'editblock-coder-'));
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
    fence: args.fence ?? DEFAULT_FENCE,
    root,
    absFnames: new Set((args.chat_files ?? []).map((name) => absRootPath(root, name))),
    absRootPath: (path: string) => absRootPath(root, path),
    tree,
  };
  const outcome = await outcomeOf(async () => {
    if (method === 'apply_edits_dry_run') return applyEditsDryRun(args.edits, ctx);
    await applyEdits(args.edits, ctx);
    return null;
  });
  return {
    outcome,
    files: await treeState(root),
    errors: errors.map((message) => message.replaceAll(root, '<root>').replaceAll(resolve(root), '<root>')),
  };
}

test.for(oracleCases('editblock', 'editblock.apply_edits', coderArgs))('apply edits $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => runCoder(args, 'apply_edits'))).toEqual(expected);
});

test.for(oracleCases('editblock', 'editblock.apply_edits_dry_run', coderArgs))('apply dry run $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => runCoder(args, 'apply_edits_dry_run'))).toEqual(expected);
});
