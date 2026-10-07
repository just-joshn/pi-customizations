import { execFile } from 'node:child_process';

export type CommandResult = { readonly stdout: string; readonly stderr: string; readonly exitCode: number };

export type Shell = (cmd: string, args: readonly string[]) => Promise<CommandResult>;

export function localShell(cwd: string, signal: AbortSignal | undefined): Shell {
  return (cmd, args) =>
    new Promise((resolve, reject) => {
      execFile(cmd, [...args], { cwd, encoding: 'utf8', ...(signal === undefined ? {} : { signal }) }, (error, stdout, stderr) => {
        if (error !== null && error.name === 'AbortError') {
          reject(error);
          return;
        }
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ stdout, stderr, exitCode });
      });
    });
}
