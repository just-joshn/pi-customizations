import { execFile } from 'node:child_process';

export type CommandResult = { readonly stdout: string; readonly stderr: string; readonly exitCode: number };

export function runCommand(cmd: string, args: readonly string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(cmd, [...args], { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
      const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      resolve({ stdout, stderr, exitCode });
    });
  });
}
