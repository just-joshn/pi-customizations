import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ThemeToken } from '@earendil-works/pi-coding-agent';
import { screen } from '../lib/align.ts';
import { type CapturePointer, type ColorValue, type Direction, type MappingClass, MappingSchema, parsePointer, readJson, roleEntries, ThemeSchema } from '../lib/schemas.ts';
import type { Color } from '../lib/sgr.ts';

const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(dev, '..');
const stock = readJson(join(homedir(), '.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json'), ThemeSchema);
const mapping = readJson(resolve(dev, process.argv[2] ?? 'mapping.json'), MappingSchema);
const stockValue = (role: ThemeToken): string | number => {
  const v = stock.colors[role];
  return typeof v === 'string' ? (stock.vars?.[v] ?? v) : v;
};

const kindOf = (c: Color): ColorValue => (c.kind === 'rgb' ? c.hex : c.kind === 'default' ? 'default' : `ansi:${c.index}`);
const errors: string[] = [];
const fail = (role: ThemeToken, msg: string) => errors.push(`${role}: ${msg}`);

function charAt(pointer: CapturePointer): string | undefined {
  const { scene, row, col } = parsePointer(pointer);
  return screen(readFileSync(join(dev, 'captures/claude', `${scene}.ansi`), 'utf8')).cells[row]?.[col]?.char;
}

function cellAt(pointer: CapturePointer, direction: Direction): string | undefined {
  const { scene, row, col } = parsePointer(pointer);
  const view = screen(readFileSync(join(dev, 'captures/claude', `${scene}.ansi`), 'utf8'));
  const cell = view.cells[row]?.[col];
  return cell ? kindOf(cell.style[direction]) : undefined;
}

function toThemeValue(value: ColorValue): string | number {
  if (value === 'default') return '';
  if (value.startsWith('ansi:')) return Number(value.slice(5));
  return value;
}

const roles = roleEntries(stock.colors).map(([role]) => role);
const colors: Partial<Record<ThemeToken, string | number>> = {};
const provenance: Partial<Record<ThemeToken, { class: MappingClass; source: string; value: string | number; evidence: CapturePointer[] }>> = {};
for (const role of roles) {
  const m = mapping.roles[role];
  if (m.source === 'stock-pi') {
    if (m.class === 'measured') fail(role, 'a measured role must come from a capture');
    colors[role] = stockValue(role);
    provenance[role] = { class: m.class, source: 'pi-1.5.2-dark', value: stockValue(role), evidence: [] };
    continue;
  }
  if (m.class === 'unmappable' || m.class === 'pi-only') {
    fail(role, `an ${m.class} role keeps the stock Pi value, not a capture value`);
    continue;
  }
  for (const pointer of m.evidence) {
    if (m.direction === 'fg' && !charAt(pointer)?.trim()) fail(role, `evidence ${pointer} is a blank cell, which shows no foreground`);
    const seen = cellAt(pointer, m.direction);
    if (seen !== m.value) fail(role, `evidence ${pointer} (${m.direction}) shows ${seen ?? 'nothing'}, mapping says ${m.value}`);
  }
  const value = toThemeValue(m.value);
  colors[role] = value;
  provenance[role] = { class: m.class, source: 'claude-capture', value, evidence: m.evidence };
}

if (errors.length) {
  console.error(`theme not generated, ${errors.length} problem(s):\n${errors.join('\n')}`);
  process.exit(1);
}

const theme = {
  $schema: 'https://pi.dev/schemas/theme.schema.json',
  name: 'claude-default-dark',
  appearance: 'dark',
  colors,
};
writeFileSync(join(pkg, 'themes/claude-default-dark.json'), `${JSON.stringify(theme, null, 2)}\n`);
writeFileSync(join(dev, 'theme-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
const tally: Record<string, number> = {};
for (const p of Object.values(provenance)) tally[`${p.class}/${p.source}`] = (tally[`${p.class}/${p.source}`] ?? 0) + 1;
console.log(JSON.stringify({ roles: Object.keys(colors).length, tally }));
