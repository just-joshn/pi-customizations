import { spawn } from 'node:child_process';

import { readBoard } from './context-board.ts';
import { subconsciousEnabled } from './feature-flags.ts';
import { type PiCommand, resolvePiCommand } from './pi-command.ts';

export const detachedSessionVariable = 'COPILOT_DETACHED_SESSION';
export const consolidationPrompt = 'Call the task tool with agent_type "rem-agent" and mode "sync" to consolidate the shared context board. Then stop.';

export type Spawn = (command: PiCommand, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string) => void;

const detached: Spawn = (command, args, env, cwd) => {
  const child = spawn(command.command, [...command.args, ...args], { cwd, env, detached: true, stdio: 'ignore' });
  child.unref();
};

/** At shutdown a session with a populated board starts one detached pi that runs the rem-agent; that process is a root session. */
export function launchRemOnShutdown(input: { env: NodeJS.ProcessEnv; cwd: string; boardFile: string; spawnProcess?: Spawn; command?: PiCommand | undefined }): boolean {
  const { env, cwd, boardFile } = input;
  if (!subconsciousEnabled(env) || env[detachedSessionVariable] || Object.keys(readBoard(boardFile)).length === 0) return false;
  const command = input.command ?? resolvePiCommand(env);
  if (!command) return false;
  (input.spawnProcess ?? detached)(command, ['-p', consolidationPrompt], { ...env, [detachedSessionVariable]: '1' }, cwd);
  return true;
}
