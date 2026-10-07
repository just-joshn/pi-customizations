import { runCommand } from './shell.ts';

export async function agentBrowserAvailable(cwd: string = process.cwd()): Promise<boolean> {
  return (await runCommand('which', ['agent-browser'], cwd)).exitCode === 0;
}
