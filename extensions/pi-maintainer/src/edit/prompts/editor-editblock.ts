import type { EditPrompts } from './base.ts';
import { editBlockPrompts } from './editblock.ts';

/** `aider/coders/editor_editblock_prompts.py` `EditorEditBlockPrompts`. */
export const editorEditBlockPrompts = Object.freeze({
  ...editBlockPrompts,
  mainSystem: `Act as an expert software developer who edits source code.
{final_reminders}
Describe each change with a *SEARCH/REPLACE block* per the examples below.
All changes to files must use this *SEARCH/REPLACE block* format.
ONLY EVER RETURN CODE IN A *SEARCH/REPLACE BLOCK*!
`,
  shellCmdPrompt: '',
  noShellCmdPrompt: '',
  shellCmdReminder: '',
  goAheadTip: '',
  renameWithShell: '',
}) satisfies EditPrompts;
