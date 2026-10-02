import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { openPane } from '../src/subagents/tmux-pane.ts';

// Stands in for the tmux binary: records one line per call and answers split-window with `reply`.
async function fakeTmux(reply: string, exitCode = 0) {
  const dir = await mkdtemp(join(tmpdir(), 'tmux-pane-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const log = join(dir, 'calls.log');
  const script = `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nif [ "$1" = split-window ]; then printf '%b' '${reply}'; fi\nexit ${exitCode}\n`;
  await writeFile(join(dir, 'tmux'), script);
  await chmod(join(dir, 'tmux'), 0o755);
  const calls = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { env: { PATH: dir, TMUX: '/tmp/tmux-501/default,123,0' }, calls };
}

test('outside tmux no pane is opened and tmux is never invoked', async () => {
  const { calls } = await fakeTmux('%1\\tmain\\teditor\\n');
  const pane = await openPane({ PATH: process.env.PATH }, '/tmp/out.txt');
  expect({ pane, calls: await calls() }).toEqual({ pane: undefined, calls: [] });
});

test('a pane splits the window tailing the output file and reports where it opened', async () => {
  const { env, calls } = await fakeTmux('%7\\tmain\\teditor\\n');
  const pane = await openPane(env, '/tmp/out.txt');
  expect(pane).toMatchObject({ id: '%7', session: 'main', window: 'editor' });
  expect(await calls()).toEqual(["split-window -d -h -P -F #{pane_id}\t#{session_name}\t#{window_name} tail -n +1 -f '/tmp/out.txt'"]);
});

test('closing the pane kills exactly that pane', async () => {
  const { env, calls } = await fakeTmux('%7\\tmain\\teditor\\n');
  const pane = await openPane(env, '/tmp/out.txt');
  await pane?.close();
  expect((await calls()).at(-1)).toBe('kill-pane -t %7');
});

test('an output path with a single quote is shell-quoted for tail', async () => {
  const { env, calls } = await fakeTmux('%7\\tmain\\teditor\\n');
  await openPane(env, "/tmp/it's.txt");
  expect((await calls())[0]).toContain(`tail -n +1 -f '/tmp/it'\\''s.txt'`);
});

test.for([
  { name: 'tmux fails', reply: '', exitCode: 1 },
  { name: 'tmux prints nothing', reply: '', exitCode: 0 },
  { name: 'tmux prints an incomplete pane description', reply: '%7\\tmain\\n', exitCode: 0 },
])('no pane is returned when $name', async ({ reply, exitCode }) => {
  const { env } = await fakeTmux(reply, exitCode);
  expect(await openPane(env, '/tmp/out.txt')).toBe(undefined);
});

test('no pane is returned when tmux is not installed', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'tmux-none-'));
  onTestFinished(() => rm(empty, { recursive: true, force: true }));
  expect(await openPane({ PATH: empty, TMUX: '/tmp/x,1,0' }, '/tmp/out.txt')).toBe(undefined);
});
