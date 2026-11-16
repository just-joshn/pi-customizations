import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import manifest from '../package.json' with { type: 'json' };
import dark from '../themes/snoop-dark.json' with { type: 'json' };
import light from '../themes/snoop-light.json' with { type: 'json' };

const hostRoot = dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')));

test.for([
  ['dark', dark],
  ['light', light],
] as const)('%s theme has exact stock role parity', ([appearance, theme]) => {
  const stock = JSON.parse(readFileSync(join(hostRoot, 'modes/interactive/theme', `${appearance}.json`), 'utf8'));
  expect(Object.keys(theme).sort()).toEqual(Object.keys(stock).sort());
  expect(Object.keys(theme.colors).sort()).toEqual(Object.keys(stock.colors).sort());
  expect(Object.keys(theme.export).sort()).toEqual(Object.keys(stock.export).sort());
  expect(theme.name).toBe(`snoop-${appearance}`);
  expect(theme.appearance).toBe(appearance);
  for (const value of [...Object.values(theme.colors), ...Object.values(theme.export)]) {
    expect(value.startsWith('okhsl(') || Object.hasOwn(theme.vars, value)).toBe(true);
  }
});

test('the package manifest lists every theme file', () => {
  const files = readdirSync(new URL('../themes', import.meta.url)).filter((name) => name.endsWith('.json'));
  expect([...manifest.pi.themes].sort()).toEqual(files.map((name) => `./themes/${name}`).sort());
});
