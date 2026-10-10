import { type EditPrompts, examples } from './base.ts';
import { unifiedDiffPrompts } from './udiff.ts';

/** `aider/coders/udiff_simple_prompts.py` `UnifiedDiffSimplePrompts`. */
export const unifiedDiffSimplePrompts = Object.freeze({
  ...unifiedDiffPrompts,
  exampleMessages: examples(),
  systemReminder: `# File editing rules:

Return edits similar to unified diffs that \`diff -U0\` would produce.

The user's patch tool needs CORRECT patches that apply cleanly against the current contents of the file!
Think carefully and make sure you include and mark all lines that need to be removed or changed as \`-\` lines.
Make sure you mark all new or modified lines with \`+\`.
Don't leave out any lines or the diff patch won't apply correctly.

To make a new file, show a diff from \`--- /dev/null\` to \`+++ path/to/new/file.ext\`.

{final_reminders}
`,
}) satisfies EditPrompts;
