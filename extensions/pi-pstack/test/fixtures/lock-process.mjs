import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

import { acquireRunLock } from '../../src/task/records.ts';

const [mode, directory, agentId] = process.argv.slice(2);
const wait = new Int32Array(new SharedArrayBuffer(4));

if (mode === 'zombie') {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  process.send({ phase: 'spawned', pid: child.pid });
  Atomics.wait(wait, 0, 0);
} else {
  if (mode === 'pause-removal') {
    const original = fs.rmSync;
    fs.rmSync = (path, options) => {
      if (path === join(directory, `${agentId}.lock`)) {
        process.send({ phase: 'before-stale-removal' });
        while (!fs.existsSync(join(directory, 'continue'))) Atomics.wait(wait, 0, 0, 5);
      }
      return original(path, options);
    };
    syncBuiltinESMExports();
  }
  process.on('message', () => {});
  try {
    acquireRunLock(directory, agentId);
    process.send({ phase: 'acquired' });
  } catch (error) {
    process.send({ phase: 'blocked', message: error.message });
  }
}
