import type { EditPrompts } from './base.ts';
import { editBlockFencedPrompts } from './editblock-fenced.ts';

/** `aider/coders/editor_diff_fenced_prompts.py` `EditorDiffFencedPrompts`. */
export const editorDiffFencedPrompts = Object.freeze({
  ...editBlockFencedPrompts,
  shellCmdPrompt: '',
  noShellCmdPrompt: '',
  shellCmdReminder: '',
  goAheadTip: '',
  renameWithShell: '',
}) satisfies EditPrompts;
