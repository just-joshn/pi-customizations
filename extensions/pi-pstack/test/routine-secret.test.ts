import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, onTestFinished, test } from 'vitest';
import { prepareRoutine } from '../scripts/routine-client.mjs';

const run = promisify(execFile);

test.for(['write', 'interrupt'])('hidden terminal initializer restores echo after %s', { timeout: 15000 }, async (mode) => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-routine-tty-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const draft = await prepareRoutine(root, { name: 'secret', prompt: 'Read action.', fields: ['action'] });
  const { stdout } = await run('python3', ['test/routine-secret-pty.py', process.execPath, join(process.cwd(), 'scripts/routine-secret.mjs'), draft.directory, mode]);
  expect(JSON.parse(stdout)).toMatchObject({ hidden: true, restored: true, exposed: false });
  if (mode === 'write') {
    expect(await readFile(join(draft.directory, 'secrets/sender-key'), 'utf8')).toBe('fixture-terminal-key-with-32-characters');
    expect((await stat(join(draft.directory, 'secrets/sender-key'))).mode & 0o777).toBe(0o600);
  } else {
    await expect(stat(join(draft.directory, 'secrets/sender-key'))).rejects.toThrow('ENOENT');
  }
});
