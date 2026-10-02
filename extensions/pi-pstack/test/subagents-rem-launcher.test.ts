import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { consolidationPrompt, detachedSessionVariable, launchRemOnShutdown, type Spawn } from '../src/subagents/rem-launcher.ts';
import { scratchDir } from './support/scratch.ts';

const command = { command: '/usr/bin/pi', args: ['--flag'] };

function board(entries: Record<string, string>): string {
  const dir = scratchDir('pstack-rem-');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'board.json');
  writeFileSync(file, JSON.stringify(entries));
  return file;
}

function launch(env: NodeJS.ProcessEnv, boardFile: string) {
  const spawned: { args: readonly string[]; env: NodeJS.ProcessEnv; cwd: string }[] = [];
  const spawnProcess: Spawn = (_command, args, spawnEnv, cwd) => spawned.push({ args, env: spawnEnv, cwd });
  return { launched: launchRemOnShutdown({ env, cwd: '/repo', boardFile, spawnProcess, command }), spawned };
}

test('with the subconscious flag and a populated board shutdown spawns one marked detached session', () => {
  const { launched, spawned } = launch({ COPILOT_SUBCONSCIOUS: '1' }, board({ a: 'b' }));
  expect(launched).toBe(true);
  expect(spawned).toEqual([{ args: ['-p', consolidationPrompt], env: { COPILOT_SUBCONSCIOUS: '1', [detachedSessionVariable]: '1' }, cwd: '/repo' }]);
});

test.for([
  { name: 'the flag is off', env: {} },
  { name: 'this is already the detached session', env: { COPILOT_SUBCONSCIOUS: '1', COPILOT_DETACHED_SESSION: '1' } },
])('nothing spawns when $name', ({ env }) => {
  const { launched, spawned } = launch(env, board({ a: 'b' }));
  expect({ launched, spawned }).toEqual({ launched: false, spawned: [] });
});

test('an empty board spawns nothing', () => {
  expect(launch({ COPILOT_SUBCONSCIOUS: '1' }, board({})).launched).toBe(false);
});
