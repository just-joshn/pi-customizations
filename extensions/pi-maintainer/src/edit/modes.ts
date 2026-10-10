import { type EditContext, type EditFormatName, registerEditFormat } from '../feature.ts';
import { applyEdits as applyEditBlocks, applyEditsDryRun as applyEditBlocksDryRun, type ParsedBlock, pathEditsFromReply } from './editblock.ts';
import { applyEdits as applyWholeEdits, getEdits as getWholeEdits, type WholeFileEdit } from './wholefile.ts';

/** Empty edit tuple for modes that never write files (`ask`, `architect`, `context`). */
export type NoWriteEdit = readonly [null];

const noWriteFormat = {
  editIntent: (_edit: NoWriteEdit) => null,
  getEdits: (_content: string, _context: EditContext): NoWriteEdit[] => [],
  applyEditsDryRun: (edits: readonly NoWriteEdit[]) => [...edits],
  applyEdits: async (_edits: readonly NoWriteEdit[], _context: EditContext) => {},
};

function editBlockContext(context: EditContext) {
  return {
    fence: context.fence,
    root: context.root,
    absFnames: new Set(context.inchatRelativeFiles.map(context.absRootPath)),
    absRootPath: context.absRootPath,
    tree: context.tree,
  };
}

const editBlockMethods = {
  editIntent: (edit: ParsedBlock) => (edit[0] === null ? null : { kind: 'upsert' as const, path: edit[0] }),
  getEdits: (content: string, context: EditContext) => pathEditsFromReply(content, editBlockContext(context)),
  applyEditsDryRun: (edits: readonly ParsedBlock[], context: EditContext) => applyEditBlocksDryRun(edits, editBlockContext(context)),
  applyEdits: (edits: readonly ParsedBlock[], context: EditContext) => applyEditBlocks(edits, editBlockContext(context)),
};

/** Ask mode. Base no-op edits; questions only. */
export const askFormat = registerEditFormat<NoWriteEdit>({
  name: 'ask',
  prompts: 'ask',
  ...noWriteFormat,
});

/** Architect mode. Writes happen only in the nested editor frame. */
export const architectFormat = registerEditFormat<NoWriteEdit>({
  name: 'architect',
  prompts: 'architect',
  ...noWriteFormat,
});

/** Context mode. File selection only; never applies reply-text edits. */
export const contextFormat = registerEditFormat<NoWriteEdit>({
  name: 'context',
  prompts: 'context',
  ...noWriteFormat,
});

export const editorDiffFormat = registerEditFormat<ParsedBlock>({
  name: 'editor-diff',
  prompts: 'editor-diff',
  ...editBlockMethods,
});

export const editorDiffFencedFormat = registerEditFormat<ParsedBlock>({
  name: 'editor-diff-fenced',
  prompts: 'editor-diff-fenced',
  ...editBlockMethods,
});

export const editorWholeFormat = registerEditFormat<WholeFileEdit>({
  name: 'editor-whole',
  prompts: 'editor-whole',
  editIntent: (edit) => ({ kind: 'upsert', path: edit[0] }),
  getEdits: (content, context) => getWholeEdits(content, context.inchatRelativeFiles, context.fence),
  applyEditsDryRun: (edits) => [...edits],
  applyEdits: applyWholeEdits,
});

/** Resolve Aider's editor edit format when `--editor-edit-format` is unset. */
export function defaultEditorFormat(requested: EditFormatName | null): EditFormatName {
  if (requested === 'diff' || requested === 'editor-diff') return 'editor-diff';
  if (requested === 'diff-fenced' || requested === 'editor-diff-fenced') return 'editor-diff-fenced';
  if (requested === 'whole' || requested === 'editor-whole') return 'editor-whole';
  return 'editor-diff';
}
