/**
 * The lint and test text shared with the model through the system prompt,
 * mirroring the reference platform-info wording for configured commands.
 */

import type { LintCommands } from './types.ts';

export function lintTestPromptSection(commands: LintCommands, testCmd: string | undefined, autoLint: boolean, autoTest: boolean): string | undefined {
  let text = '';

  if (commands.entries.length > 0) {
    text += autoLint ? "- The user's pre-commit runs these lint commands, don't suggest running them:\n" : '- The user prefers these lint commands:\n';
    for (const entry of commands.entries) {
      text += entry.lang === undefined ? `  - ${entry.cmd}\n` : `  - ${entry.lang}: ${entry.cmd}\n`;
    }
  }

  if (testCmd !== undefined && testCmd !== '') {
    text += autoTest ? "- The user's pre-commit runs this test command, don't suggest running them: " : '- The user prefers this test command: ';
    text += `${testCmd}\n`;
  }

  return text.length > 0 ? text : undefined;
}
