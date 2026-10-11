import type { Host } from '../core/host.ts';

/** POSIX single-quote escape for a path appended to a shell lint command (Aider `oslex.quote`). */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Run a command string as `/bin/sh -c` via Host.exec (Aider's non-interactive `shell=True` path). */
export async function runShellCommand(host: Host, command: string, cwd: string, signal?: AbortSignal): Promise<{ readonly code: number; readonly output: string }> {
  signal?.throwIfAborted();
  const outcome = await host.exec({ command: '/bin/sh', args: ['-c', command], cwd, ...(signal ? { signal } : {}) });
  return { code: outcome.code, output: `${outcome.stdout}${outcome.stderr}` };
}
