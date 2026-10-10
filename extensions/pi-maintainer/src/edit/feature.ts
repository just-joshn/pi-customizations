import { type EditContext, type EditFormatName, type EditFormats, type Feature, isEditFormatName, registerEditFormat } from '../feature.ts';
import { editCommands } from './commands.ts';
import { applyEdits as applyEditBlocks, applyEditsDryRun as applyEditBlocksDryRun, type ParsedBlock, pathEditsFromReply } from './editblock.ts';
import { architectFormat, askFormat, contextFormat, defaultEditorFormat, editorDiffFencedFormat, editorDiffFormat, editorWholeFormat } from './modes.ts';
import { editOptionList, editOptions } from './options.ts';
import { applyEdits as applyPatchEdits, applyEditsDryRun as applyPatchEditsDryRun, type EditResult, getEdits as getPatchEdits, type PatchContext, editIntent as patchEditIntent } from './patch.ts';
import { applyEdits as applyUdiffEdits, applyEditsDryRun as applyUdiffEditsDryRun, getEdits as getUdiffEdits, type UdiffEdit } from './udiff.ts';
import { applyEdits, getEdits, type WholeFileEdit } from './wholefile.ts';
import { createWorkingTree, type LineEndings } from './working-tree.ts';

export { editIntent as patchEditIntent } from './patch.ts';

const lineEndings = (value: string | null): LineEndings => (value === 'lf' || value === 'crlf' ? value : 'platform');

function editBlockContext(context: EditContext) {
  return {
    fence: context.fence,
    root: context.root,
    absFnames: new Set(context.inchatRelativeFiles.map(context.absRootPath)),
    absRootPath: context.absRootPath,
    tree: context.tree,
  };
}

function udiffContext(context: EditContext) {
  return {
    root: context.root,
    absFnames: new Set(context.inchatRelativeFiles.map(context.absRootPath)),
    absRootPath: context.absRootPath,
    tree: context.tree,
  };
}

function patchContext(context: EditContext): PatchContext {
  return {
    absRootPath: context.absRootPath,
    io: context.notices,
    tree: context.tree,
  };
}

const editBlockFormat = {
  editIntent: (edit: ParsedBlock) => (edit[0] === null ? null : { kind: 'upsert' as const, path: edit[0] }),
  getEdits: (content: string, context: EditContext) => pathEditsFromReply(content, editBlockContext(context)),
  applyEditsDryRun: (edits: readonly ParsedBlock[], context: EditContext) => applyEditBlocksDryRun(edits, editBlockContext(context)),
  applyEdits: (edits: readonly ParsedBlock[], context: EditContext) => applyEditBlocks(edits, editBlockContext(context)),
};

const udiffFormat = {
  editIntent: (edit: UdiffEdit) => (edit[0] === null ? null : { kind: 'upsert' as const, path: edit[0] }),
  getEdits: (content: string) => getUdiffEdits(content),
  applyEditsDryRun: (edits: readonly UdiffEdit[]) => applyUdiffEditsDryRun(edits),
  applyEdits: (edits: readonly UdiffEdit[], context: EditContext) => applyUdiffEdits(edits, udiffContext(context)),
};

export const wholeFileFormat = registerEditFormat<WholeFileEdit>({
  name: 'whole',
  prompts: 'whole',
  editIntent: (edit) => ({ kind: 'upsert', path: edit[0] }),
  getEdits: (content, context) => getEdits(content, context.inchatRelativeFiles, context.fence),
  applyEditsDryRun: (edits) => [...edits],
  applyEdits,
});

export const diffFormat = registerEditFormat<ParsedBlock>({
  name: 'diff',
  prompts: 'diff',
  ...editBlockFormat,
});

/** Same SEARCH/REPLACE apply path as `diff`; only the prompts differ. */
export const diffFencedFormat = registerEditFormat<ParsedBlock>({
  name: 'diff-fenced',
  prompts: 'diff-fenced',
  ...editBlockFormat,
});

export const udiffEditFormat = registerEditFormat<UdiffEdit>({
  name: 'udiff',
  prompts: 'udiff',
  ...udiffFormat,
});

/** Same unified-diff apply path as `udiff`; only the prompts differ. */
export const udiffSimpleFormat = registerEditFormat<UdiffEdit>({
  name: 'udiff-simple',
  prompts: 'udiff-simple',
  ...udiffFormat,
});

export const patchFormat = registerEditFormat<EditResult>({
  name: 'patch',
  prompts: 'patch',
  editIntent: patchEditIntent,
  getEdits: (content, context) => getPatchEdits(content, patchContext(context)),
  applyEditsDryRun: (edits, context) => applyPatchEditsDryRun(edits, patchContext(context)),
  applyEdits: (edits, context) => applyPatchEdits(edits, patchContext(context)),
});

export const editFeature: Feature<EditFormats> & { readonly name: 'edit' } = {
  name: 'edit',
  options: editOptionList,
  commands: editCommands,
  create({ settings, host }) {
    const requested = settings.value(editOptions.editFormat);
    const editorEditFormat = settings.value(editOptions.editorEditFormat);
    const dryRun = settings.value(editOptions.dryRun);
    return {
      formats: new Map([
        ['whole', wholeFileFormat],
        ['diff', diffFormat],
        ['diff-fenced', diffFencedFormat],
        ['udiff', udiffEditFormat],
        ['udiff-simple', udiffSimpleFormat],
        ['patch', patchFormat],
        ['ask', askFormat],
        ['architect', architectFormat],
        ['context', contextFormat],
        ['editor-diff', editorDiffFormat],
        ['editor-diff-fenced', editorDiffFencedFormat],
        ['editor-whole', editorWholeFormat],
      ]),
      requestedFormat: requested !== null && isEditFormatName(requested) ? requested : null,
      initialFiles: { editable: settings.value(editOptions.file), readOnly: settings.value(editOptions.read) },
      messageFile: settings.value(editOptions.messageFile),
      dryRun,
      yesAlways: settings.value(editOptions.yesAlways),
      autoAcceptArchitect: settings.value(editOptions.autoAcceptArchitect),
      editorModel: settings.value(editOptions.editorModel),
      editorEditFormat: defaultEditorFormat(editorEditFormat !== null && isEditFormatName(editorEditFormat) ? (editorEditFormat as EditFormatName) : null),
      chatLanguage: settings.value(editOptions.chatLanguage),
      tree: createWorkingTree({ notices: host, encoding: settings.value(editOptions.encoding) ?? 'utf-8', lineEndings: lineEndings(settings.value(editOptions.lineEndings)), dryRun }),
    };
  },
};
