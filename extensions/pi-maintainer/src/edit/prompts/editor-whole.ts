import type { EditPrompts } from './base.ts';
import { wholeFilePrompts } from './wholefile.ts';

/** `aider/coders/editor_whole_prompts.py` `EditorWholeFilePrompts`. */
export const editorWholeFilePrompts = Object.freeze({
  ...wholeFilePrompts,
  mainSystem: `Act as an expert software developer and make changes to source code.
{final_reminders}
Output a copy of each file that needs changes.
`,
}) satisfies EditPrompts;
