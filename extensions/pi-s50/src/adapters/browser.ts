import type { Shell } from './shell.ts';

export async function agentBrowserAvailable(shell: Shell): Promise<boolean> {
  return (await shell('agent-browser', ['--version']).catch(() => ({ exitCode: 1 }))).exitCode === 0;
}
