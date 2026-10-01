import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, onTestFinished, test } from 'vitest';
import { filesystemLaunch } from '../scripts/filesystem-launch.mjs';

const run = promisify(execFile);

test.skipIf(process.platform !== 'darwin')('the real routine subprocess cannot read its key or change coordinator state but can write its session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-routine-isolation-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const secrets = join(root, 'secrets');
  const session = join(root, 'session');
  await mkdir(secrets);
  await mkdir(session);
  await writeFile(join(secrets, 'sender-key'), 'fixture-private-key');
  await writeFile(join(root, 'status.json'), 'original');
  const script = `const fs = require('node:fs'); const root = process.argv[1]; const result = {}; for (const [name, action] of Object.entries({read:()=>fs.readFileSync(root+'/secrets/sender-key'),write:()=>fs.writeFileSync(root+'/status.json','changed'),session:()=>fs.writeFileSync(root+'/session/entry','ok')})) {try {action();result[name]='allowed'}catch{result[name]='denied'}} process.stdout.write(JSON.stringify(result));`;
  const launch = await filesystemLaunch(process.execPath, ['-e', script, root], root, { denied: [secrets], allowed: [], writeDenied: [root], writeAllowed: [session] });
  const { stdout } = await run(launch.executable, launch.args);
  expect(JSON.parse(stdout)).toEqual({ read: 'denied', write: 'denied', session: 'allowed' });
  expect(await readFile(join(root, 'status.json'), 'utf8')).toBe('original');
});
