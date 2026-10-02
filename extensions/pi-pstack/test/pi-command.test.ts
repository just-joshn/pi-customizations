import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { resolvePiCommand } from '../src/subagents/pi-command.ts';

const execPath = '/usr/bin/node-under-test';

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-command-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function binWith(mode: number): Promise<string> {
  const dir = await tempDir();
  await writeFile(join(dir, 'pi'), '#!/bin/sh\n');
  await chmod(join(dir, 'pi'), mode);
  return dir;
}

test.for([
  { configured: '/opt/pi/cli.js', expected: { command: execPath, args: ['/opt/pi/cli.js'] } },
  { configured: '  /opt/pi/cli.mjs  ', expected: { command: execPath, args: ['/opt/pi/cli.mjs'] } },
  { configured: '/opt/pi/cli.cjs', expected: { command: execPath, args: ['/opt/pi/cli.cjs'] } },
  { configured: '/opt/bin/pi', expected: { command: '/opt/bin/pi', args: [] } },
])('PSTACK_PI_COMMAND "$configured" wins over everything else', ({ configured, expected }) => {
  expect(resolvePiCommand({ PSTACK_PI_COMMAND: configured, PATH: '' }, '', execPath)).toEqual(expected);
});

test('the running pi script is used when it is a real javascript file', async () => {
  const dir = await tempDir();
  const script = join(dir, 'cli.js');
  await writeFile(script, '');
  const pathDir = await binWith(0o755);
  expect(resolvePiCommand({ PATH: pathDir }, script, execPath)).toEqual({ command: execPath, args: [script] });
});

test.for([
  { name: 'a missing script', argv1: (dir: string) => join(dir, 'gone.js') },
  { name: 'a non-script entry', argv1: (dir: string) => join(dir, 'pi') },
  { name: 'an empty entry', argv1: () => '' },
])('$name falls through to the PATH lookup', async ({ argv1 }) => {
  const dir = await binWith(0o755);
  const found = resolvePiCommand({ PATH: dir }, argv1(dir), execPath);
  expect(found).toEqual({ command: join(dir, 'pi'), args: [] });
});

test('PATH lookup takes the first executable pi and skips non-executable ones', async () => {
  const locked = await binWith(0o644);
  const open = await binWith(0o755);
  const empty = await tempDir();
  expect(resolvePiCommand({ PATH: ['', locked, empty, open].join(delimiter) }, '', execPath)).toEqual({ command: join(open, 'pi'), args: [] });
});

test('nothing is resolved when no pi can be found', async () => {
  const dir = await binWith(0o644);
  expect([resolvePiCommand({ PATH: dir }, '', execPath), resolvePiCommand({}, '', execPath)]).toEqual([undefined, undefined]);
});

test('a blank configured command is ignored', async () => {
  const dir = await binWith(0o755);
  expect(resolvePiCommand({ PSTACK_PI_COMMAND: '   ', PATH: dir }, '', execPath)).toEqual({ command: join(dir, 'pi'), args: [] });
});
