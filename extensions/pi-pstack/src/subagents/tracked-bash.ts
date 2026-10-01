import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

import { type BashOperations, createBashToolDefinition, getShellConfig, type ToolDefinition } from '@earendil-works/pi-coding-agent';

const exitStdioGraceMs = 100;
type ExecOptions = Parameters<BashOperations['exec']>[2];

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group already exited.
  }
}

function run(command: string, cwd: string, options: ExecOptions, onGroup: (pid: number) => void): Promise<{ exitCode: number | null }> {
  const { shell, args } = getShellConfig();
  const child = spawn(shell, [...args, command], { cwd, detached: true, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const pid = child.pid;
  if (pid) onGroup(pid);
  let timedOut = false;
  const abort = () => killTree(pid);
  const timer = options.timeout === undefined ? undefined : setTimeout(() => ((timedOut = true), abort()), options.timeout * 1000);
  options.signal?.addEventListener('abort', abort, { once: true });
  child.stdout?.on('data', options.onData);
  child.stderr?.on('data', options.onData);
  return new Promise<{ exitCode: number | null }>((resolve, reject) => {
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null) => {
      clearTimeout(grace);
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (options.signal?.aborted) reject(new Error('aborted'));
      else if (timedOut) reject(new Error(`timeout:${options.timeout}`));
      else resolve({ exitCode: code ?? 1 });
    };
    child.once('error', reject);
    child.once('close', finish);
    // A descendant that inherited the pipes can keep them open after the shell exits.
    child.once('exit', (code) => {
      grace = setTimeout(finish, exitStdioGraceMs, code);
    });
  });
}

export function trackedBashOperations(onGroup: (pid: number) => void): BashOperations {
  return {
    exec: async (command, cwd, options) => {
      if (options.signal?.aborted) throw new Error('aborted');
      await access(cwd).catch(() => {
        throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
      });
      return run(command, cwd, options, onGroup);
    },
  };
}

export function trackedBashTool(cwd: string, onGroup: (pid: number) => void): ToolDefinition {
  return createBashToolDefinition(cwd, { operations: trackedBashOperations(onGroup) }) as unknown as ToolDefinition;
}
