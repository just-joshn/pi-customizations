/**
 * Exact message strings and templates used across the repair pipeline.
 * Keeping them in one table makes the parity tests direct.
 */

export const LINT_HEADER = '# Fix any errors below, if possible.\n\n';

export const RUN_OUTPUT_TEMPLATE = `I ran this command:

{command}

And got this output:

{output}
`;

export const RUN_PLACEHOLDER = "What's wrong? Fix";

export const FIX_LINT_QUESTION = 'Attempt to fix lint errors?';
export const FIX_TEST_QUESTION = 'Attempt to fix test errors?';

export function reflectionCapWarning(maxReflections: number): string {
  return `Only ${maxReflections} reflections allowed, stopping.`;
}

export function addedOutputMessage(numLines: number): string {
  const plural = numLines === 1 ? 'line' : 'lines';
  return `Added ${numLines} ${plural} of output to the chat.`;
}

export function addOutputQuestion(kTokens: string): string {
  return `Add ${kTokens}k tokens of command output to the chat?`;
}

export function fixFileQuestion(fname: string): string {
  return `Fix lint errors in ${fname}?`;
}

export function formatRunOutput(command: string, output: string): string {
  return RUN_OUTPUT_TEMPLATE.replace(/\{command\}|\{output\}/g, (token) => (token === '{command}' ? command : output));
}

export const REFLECTION_CUSTOM_TYPE = 'maintainer-reflection';
export const COMMAND_OUTPUT_CUSTOM_TYPE = 'maintainer-command-output';
export const WARNING_CUSTOM_TYPE = 'maintainer-warning';
