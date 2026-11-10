import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LIMITS = [
  'sleeping host',
  'Slack poll',
  'loopback webhook',
  'no Debug/Ask',
  'sandbox stronger than instructions',
  'team-kit rules unwired',
  'Claude Code omitted',
  'host MCP in cloud',
  'background run outlives a crashed main chat',
  'no in-app browser or Canvas',
  'mode skill via section, not durable blocks',
  'media via read and open',
  'no parent usage rollup',
  'fork needs idle source',
  's390x readonly network fail-closed',
  'no Bugbot product',
  'plan review is a dialog',
];

test('docs/host-limits.md exists and names every locked host difference', () => {
  const path = join(root, 'docs/host-limits.md');
  expect(existsSync(path)).toBe(true);
  const text = readFileSync(path, 'utf8');
  expect(LIMITS.filter((name) => !text.includes(name))).toEqual([]);
  expect(text).toContain('Nothing here marks a live Slack workspace');
});

test('parity status points remaining host differences at the registry', () => {
  const status = readFileSync(join(root, 'docs/parity-status.md'), 'utf8');
  const section = status.slice(status.indexOf('## Remaining host differences'));
  expect(section.startsWith('## Remaining host differences')).toBe(true);
  expect(section).toContain('](host-limits.md)');
});
