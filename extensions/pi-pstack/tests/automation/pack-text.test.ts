import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test } from 'vitest';
import { parsePstackArgs } from '../../src/commands.ts';

const PACK = resolve('generated/automations/benny');
const files = readdirSync(PACK, { recursive: true })
  .map(String)
  .filter((file) => statSync(join(PACK, file)).isFile())
  .map((file) => ({ file, text: readFileSync(join(PACK, file), 'utf8') }));

// A path such as `.pi/automations/benny/` is not the old slash command, so a match must not sit inside one.
const REMOVED = [/(?<![\w.~/-])\/automations?(?![\w/.-])/, /environment:\s*["']cloud["']/, /sessionStrategy/, /cloud machine/];

test('no file of the shipped Benny pack names a mechanism this package no longer has', () => {
  expect(files.length).toBeGreaterThan(10);
  const found = files.flatMap(({ file, text }) => REMOVED.filter((pattern) => pattern.test(text)).map((pattern) => `${file}: ${pattern}`));
  expect(found).toEqual([]);
});

test('every /pstack command the pack tells an agent to run parses as a real subcommand', () => {
  const mentioned = files.flatMap(({ file, text }) => {
    const bare = text.match(/(?<![\w.~-])\/pstack(?![\w/-])/g)?.length ?? 0;
    const quoted = [...text.matchAll(/`\/pstack ([^`]*)`/g)].map((match) => match[1] as string);
    expect({ file, unquoted: bare - quoted.length }).toEqual({ file, unquoted: 0 });
    return quoted;
  });
  expect(mentioned.length).toBeGreaterThan(3);
  for (const args of mentioned) expect(parsePstackArgs(args.replace(/<[^>]*>/g, 'benny-triage')), args).toMatchObject({ kind: 'automation' });
});

test('every package script the pack tells an agent to run exists', () => {
  const scripts = files.flatMap(({ text }) => [...text.matchAll(/node (scripts\/[\w-]+\.mjs)/g)].map((match) => match[1] as string));
  expect(scripts).toContain('scripts/benny-setup.mjs');
  for (const script of scripts) expect(existsSync(resolve(script)), script).toBe(true);
});
