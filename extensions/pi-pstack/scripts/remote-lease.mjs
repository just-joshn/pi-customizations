import { readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const [directory, owner, action] = process.argv.slice(2);
try {
  if (!directory || !isAbsolute(directory) || !/^[a-zA-Z0-9-]+$/.test(owner ?? '') || !['claim', 'release'].includes(action)) throw new Error('Invalid machine lease request.');
  const path = join(directory, 'machine-owner');
  if (action === 'claim') {
    try {
      await writeFile(path, owner, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Independent VM is occupied. Close and reconcile its prior task or choose another machine.');
      throw error;
    }
  } else {
    try {
      if ((await readFile(path, 'utf8')) === owner) await unlink(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
