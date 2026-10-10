import { type EditFormats, type Feature, isEditFormatName, registerEditFormat } from '../feature.ts';
import { editOptionList, editOptions } from './options.ts';
import { applyEdits, getEdits, type WholeFileEdit } from './wholefile.ts';
import { createWorkingTree, type LineEndings } from './working-tree.ts';

const lineEndings = (value: string | null): LineEndings => (value === 'lf' || value === 'crlf' ? value : 'platform');

export const wholeFileFormat = registerEditFormat<WholeFileEdit>({
  name: 'whole',
  prompts: 'whole',
  editIntent: (edit) => ({ kind: 'upsert', path: edit[0] }),
  getEdits: (content, context) => getEdits(content, context.inchatRelativeFiles, context.fence),
  applyEditsDryRun: (edits) => [...edits],
  applyEdits,
});

export const editFeature: Feature<EditFormats> & { readonly name: 'edit' } = {
  name: 'edit',
  options: editOptionList,
  commands: [],
  create({ settings, host }) {
    const requested = settings.value(editOptions.editFormat);
    const dryRun = settings.value(editOptions.dryRun);
    return {
      formats: new Map([['whole', wholeFileFormat]]),
      requestedFormat: requested !== null && isEditFormatName(requested) ? requested : null,
      initialFiles: { editable: settings.value(editOptions.file), readOnly: settings.value(editOptions.read) },
      dryRun,
      yesAlways: settings.value(editOptions.yesAlways),
      tree: createWorkingTree({ notices: host, encoding: settings.value(editOptions.encoding) ?? 'utf-8', lineEndings: lineEndings(settings.value(editOptions.lineEndings)), dryRun }),
    };
  },
};
