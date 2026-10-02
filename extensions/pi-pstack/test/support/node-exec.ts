import { execFile } from 'node:child_process';

import type { Exec } from '../../src/subagents/environment-facts.ts';

/** A real command runner with the shape of pi.exec, for tests that probe the machine. */
export const nodeExec: Exec = (command, args, options) =>
  new Promise((resolve) => {
    execFile(command, args, { cwd: options?.cwd }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, killed: false });
    });
  });
