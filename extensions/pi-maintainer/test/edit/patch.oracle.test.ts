import { type Static, Type } from 'typebox';
import { expect, test } from 'vitest';
import { ValueError } from '../../src/edit/errors.ts';
import { applyEdits, applyEditsDryRun, type Chunk, type EditResult, getEdits, type PatchAction } from '../../src/edit/patch.ts';
import { parsePatchText } from '../../src/edit/patch-parse.ts';
import { findContext, findContextCore, identifyFilesNeeded, peekNextSection } from '../../src/edit/patch-sections.ts';
import { oracleCases, outcomeOf } from '../support/oracle.ts';
import { recordingNotices, workspace } from './patch-workspace.ts';

const lines = Type.Array(Type.String());
const chunk = Type.Object({ orig_index: Type.Integer(), del_lines: lines, ins_lines: lines });
const action = Type.Union([
  Type.Object({ type: Type.Literal('Add'), path: Type.String(), new_content: Type.String() }),
  Type.Object({ type: Type.Literal('Delete'), path: Type.String() }),
  Type.Object({ type: Type.Literal('Update'), path: Type.String(), chunks: Type.Array(chunk), move_path: Type.Optional(Type.String()) }),
]);
const project = { files: Type.Optional(Type.Record(Type.String(), Type.String())), dirs: Type.Optional(lines), dry_run: Type.Optional(Type.Boolean()) };

const aiderChunk = (part: Chunk) => ({ orig_index: part.origIndex, del_lines: part.delLines, ins_lines: part.insLines });

/** The `PatchAction` dataclass as `asdict` serializes it, defaults included. */
function aiderAction(patchAction: PatchAction) {
  return {
    type: patchAction.type,
    path: patchAction.path,
    new_content: patchAction.type === 'Add' ? patchAction.newContent : null,
    chunks: patchAction.type === 'Update' ? patchAction.chunks.map(aiderChunk) : [],
    move_path: patchAction.type === 'Update' ? patchAction.movePath : null,
  };
}

const aiderEdits = (edits: readonly EditResult[]) => edits.map(([path, edit]) => [path, aiderAction(edit)]);

function portAction(data: Static<typeof action>): PatchAction {
  switch (data.type) {
    case 'Add':
      return { type: 'Add', path: data.path, newContent: data.new_content };
    case 'Delete':
      return { type: 'Delete', path: data.path };
    case 'Update':
      return { type: 'Update', path: data.path, chunks: data.chunks.map((part) => ({ origIndex: part.orig_index, delLines: part.del_lines, insLines: part.ins_lines })), movePath: data.move_path ?? null };
  }
}

/** Mirrors the oracle's capture: a ValueError becomes data next to the state it left behind. */
async function attempt<T>(run: () => T | Promise<T>, root?: string): Promise<readonly [value: T | null, raised: { type: string; message: string } | null]> {
  try {
    return [await run(), null];
  } catch (error) {
    if (!(error instanceof ValueError)) throw error;
    const message = root === undefined ? error.message : error.message.replaceAll(root, '<root>');
    return [null, { type: error.name, message }];
  }
}

test.for(oracleCases('patch', 'patch.find_context_core', Type.Object({ lines, context: lines, start: Type.Integer() })))('findContextCore $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => findContextCore(args.lines, args.context, args.start))).toEqual(expected);
});

test.for(oracleCases('patch', 'patch.find_context', Type.Object({ lines, context: lines, start: Type.Integer(), eof: Type.Boolean() })))('findContext $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => findContext(args.lines, args.context, args.start, args.eof))).toEqual(expected);
});

test.for(oracleCases('patch', 'patch.peek_next_section', Type.Object({ lines, index: Type.Integer() })))('peekNextSection $id', async ({ args, expected }) => {
  const outcome = await outcomeOf(() => {
    const [contextLines, chunks, nextIndex, isEof] = peekNextSection(args.lines, args.index);
    return [contextLines, chunks.map(aiderChunk), nextIndex, isEof];
  });
  expect(outcome).toEqual(expected);
});

test.for(oracleCases('patch', 'patch.identify_files_needed', Type.Object({ text: Type.String() })))('identifyFilesNeeded $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => identifyFilesNeeded(args.text).toSorted())).toEqual(expected);
});

const parseArgs = Type.Object({ lines, start_index: Type.Integer(), current_files: Type.Record(Type.String(), Type.String()) });

test.for(oracleCases('patch', 'patch.parse_patch_text', parseArgs))('parsePatchText $id', async ({ args, expected }) => {
  const { io, recorded } = recordingNotices();
  const outcome = await outcomeOf(async () => {
    const [patch, raised] = await attempt(() => parsePatchText(args.lines, args.start_index, new Map(Object.entries(args.current_files)), io));
    return { patch: patch === null ? null : { actions: aiderEdits([...patch.actions]), fuzz: patch.fuzz }, raised, notices: recorded };
  });
  expect(outcome).toEqual(expected);
});

test.for(oracleCases('patch', 'patch.get_edits', Type.Object({ reply: Type.String(), ...project })))('getEdits $id', async ({ args, expected }) => {
  const space = await workspace({ files: args.files, dirs: args.dirs, dryRun: args.dry_run });
  const outcome = await outcomeOf(async () => {
    const [edits, raised] = await attempt(() => getEdits(args.reply, space.ctx), space.root);
    return { edits: edits === null ? null : aiderEdits(edits), raised, notices: space.notices() };
  });
  expect(outcome).toEqual(expected);
});

test.for(oracleCases('patch', 'patch.apply_edits', Type.Object({ edits: Type.Array(Type.Tuple([Type.String(), action])), ...project })))('applyEdits $id', async ({ args, expected }) => {
  const space = await workspace({ files: args.files, dirs: args.dirs, dryRun: args.dry_run });
  const edits = args.edits.map(([path, data]): EditResult => [path, portAction(data)]);
  const outcome = await outcomeOf(async () => {
    const [, raised] = await attempt(() => applyEdits(edits, space.ctx), space.root);
    return { raised, notices: space.notices(), tree: await space.snapshot() };
  });
  expect(outcome).toEqual(expected);
});

test.for(oracleCases('patch', 'patch.apply_reply', Type.Object({ reply: Type.String(), ...project })))('applies reply $id', async ({ args, expected }) => {
  const space = await workspace({ files: args.files, dirs: args.dirs, dryRun: args.dry_run });
  const outcome = await outcomeOf(async () => {
    const [, raised] = await attempt(async () => applyEdits(applyEditsDryRun(await getEdits(args.reply, space.ctx), space.ctx), space.ctx), space.root);
    return { raised, notices: space.notices(), tree: await space.snapshot() };
  });
  expect(outcome).toEqual(expected);
});
