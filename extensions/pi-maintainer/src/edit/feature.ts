import { type EditContext, type EditFormats, type Feature, isEditFormatName, registerEditFormat } from '../feature.ts';
import { applyEdits as applyEditBlocks, applyEditsDryRun as applyEditBlocksDryRun, type EditBlock, getEdits as getEditBlocks } from './editblock.ts';
import { editOptionList, editOptions } from './options.ts';
import { applyEdits, getEdits, type WholeFileEdit } from './wholefile.ts';
import { createWorkingTree, type LineEndings } from './working-tree.ts';

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

const editBlockFormat = {
  editIntent: (edit: EditBlock) => ({ kind: 'upsert' as const, path: edit[0] }),
  getEdits: (content: string, context: EditContext) => getEditBlocks(content, editBlockContext(context)).edits,
  applyEditsDryRun: (edits: readonly EditBlock[], context: EditContext) => applyEditBlocksDryRun(edits, editBlockContext(context)),
  applyEdits: (edits: readonly EditBlock[], context: EditContext) => applyEditBlocks(edits, editBlockContext(context)),
};

export const wholeFileFormat = registerEditFormat<WholeFileEdit>({
  name: 'whole',
  prompts: 'whole',
  editIntent: (edit) => ({ kind: 'upsert', path: edit[0] }),
  getEdits: (content, context) => getEdits(content, context.inchatRelativeFiles, context.fence),
  applyEditsDryRun: (edits) => [...edits],
  applyEdits,
});

export const diffFormat = registerEditFormat<EditBlock>({
  name: 'diff',
  prompts: 'diff',
  ...editBlockFormat,
});

/** Same SEARCH/REPLACE apply path as `diff`; only the prompts differ. */
export const diffFencedFormat = registerEditFormat<EditBlock>({
  name: 'diff-fenced',
  prompts: 'diff-fenced',
  ...editBlockFormat,
});

export const editFeature: Feature<EditFormats> & { readonly name: 'edit' } = {
  name: 'edit',
  options: editOptionList,
  commands: [],
  create({ settings, host }) {
    const requested = settings.value(editOptions.editFormat);
    const dryRun = settings.value(editOptions.dryRun);
    return {
      formats: new Map([
        ['whole', wholeFileFormat],
        ['diff', diffFormat],
        ['diff-fenced', diffFencedFormat],
      ]),
      requestedFormat: requested !== null && isEditFormatName(requested) ? requested : null,
      initialFiles: { editable: settings.value(editOptions.file), readOnly: settings.value(editOptions.read) },
      dryRun,
      yesAlways: settings.value(editOptions.yesAlways),
      tree: createWorkingTree({ notices: host, encoding: settings.value(editOptions.encoding) ?? 'utf-8', lineEndings: lineEndings(settings.value(editOptions.lineEndings)), dryRun }),
    };
  },
};
