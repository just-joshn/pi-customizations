/** Aider `prompts.run_output` used when `/test` fails and output is added to chat. */
export function formatRunOutput(command: string, output: string): string {
  return `I ran this command:\n\n${command}\n\nAnd got this output:\n\n${output}\n`;
}
