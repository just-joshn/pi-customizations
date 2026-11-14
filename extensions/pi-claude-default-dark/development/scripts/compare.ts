import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ThemeToken } from '@earendil-works/pi-coding-agent';
import { attrList, type Observation, occurrences, resolve, type Screen, screen } from '../lib/align.ts';
import { currentInputs, evidenceFingerprint, g4Verdict, gateVerdict } from '../lib/gates.ts';
import {
  type CapturePointer,
  CaptureRunSchema,
  type Coordinate,
  type Direction,
  type MappingClass,
  MappingSchema,
  ObservationsSchema,
  PaletteSchema,
  ProbeMapSchema,
  parseCoordinate,
  parsePointer,
  ReviewsSchema,
  readJson,
  roleEntries,
  SurfacesSchema,
  type Verdict,
} from '../lib/schemas.ts';
import { ANIMATED_SCENES } from './scenes.mjs';

interface Pointer {
  scene: string;
  at: Coordinate;
  direction: Direction;
  from: string;
}

const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
const cap = (dir: string, scene: string) => join(dev, 'captures', dir, `${scene}.ansi`);
const palette = readJson(join(dev, 'captures/terminal-palette.json'), PaletteSchema);
const mapping = readJson(join(dev, 'mapping.json'), MappingSchema).roles;
const observations = readJson(join(dev, 'captures/observations.json'), ObservationsSchema);
const reviews = ['claude', 'gpt'].map((name) => ({ name, roles: readJson(join(dev, 'mapping-review', `${name}.json`), ReviewsSchema).roles }));
const themed = process.argv[2] ?? 'pi-claude-default-dark';
const themedRun = readJson(join(dev, 'captures', themed, 'run.json'), CaptureRunSchema);

const screens = new Map<string, Screen>();
const view = (dir: string, scene: string) => {
  const key = `${dir}/${scene}`;
  const existing = screens.get(key);
  if (existing) return existing;
  const loaded = screen(readFileSync(cap(dir, scene), 'utf8'));
  screens.set(key, loaded);
  return loaded;
};
const rgb = (value: string) => (value === 'default-fg' ? palette.foreground_rgb : value === 'default-bg' ? palette.background_rgb : value);
const cellStyle = (s: Screen, at: Coordinate, direction: Direction) => {
  const { row, col } = parseCoordinate(at);
  const cell = s.cells[row]?.[col];
  return cell && { char: cell.char, color: rgb(resolve(cell.style[direction], direction, palette)), attrs: attrList(cell.style) };
};

const probeMap = readJson(join(dev, 'captures/role-probe.map.json'), ProbeMapSchema);
function roleCell(scene: string, role: ThemeToken, direction: Direction): Coordinate | undefined {
  if (!existsSync(cap('pi-role-probe', scene))) return undefined;
  const s = view('pi-role-probe', scene);
  for (const [row, cells] of s.cells.entries())
    for (const [col, cell] of cells.entries()) {
      const c = cell.style[direction];
      if (c.kind === 'rgb' && probeMap[c.hex] === role && cell.char.trim()) return `${row}:${col}`;
    }
  return undefined;
}

function pointers(role: ThemeToken): Pointer[] {
  const out: Pointer[] = [];
  for (const { name, roles } of reviews) {
    const r = roles[role];
    if (!r) continue;
    const add = (p: CapturePointer, direction?: Direction) => {
      const { scene, at } = parsePointer(p);
      out.push({ scene, at, direction: direction ?? mapping[role].direction, from: name });
    };
    if (r.class === 'measured') for (const p of r.evidence ?? []) add(p);
    for (const c of r.contexts ?? []) for (const p of c.evidence ?? (c.at ? [c.at] : [])) add(p, c.direction);
  }
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(`${p.scene}@${p.at}:${p.direction}`) && seen.add(`${p.scene}@${p.at}:${p.direction}`));
}

function verdictFor({ matches, pairing }: { matches: boolean; pairing: 'text-anchor' | 'role-in-scene' }): Verdict {
  switch (pairing) {
    case 'text-anchor':
      return matches ? 'PASS' : 'FAIL';
    case 'role-in-scene':
      return 'INCONCLUSIVE';
    default: {
      const _exhaustive: never = pairing;
      return _exhaustive;
    }
  }
}

const results: {
  role: ThemeToken;
  class: MappingClass;
  scene: string;
  claudeAt: Coordinate;
  piAt?: Coordinate;
  direction: Direction;
  expected?: string;
  actual?: string;
  verdict: Verdict;
  reason?: string;
  pairing?: string;
  surface?: string;
}[] = [];
const surfaces = readJson(join(dev, 'surfaces.json'), SurfacesSchema).surfaces;
const surfaceKeys = new Set(surfaces.map((s) => `${s.role}|${s.claude}|${s.direction}`));
for (const [role, m] of roleEntries(mapping)) {
  for (const p of pointers(role)) {
    if (surfaceKeys.has(`${role}|${p.scene}@${p.at}|${p.direction}`)) continue;
    const base = { role, class: m.class, scene: p.scene, claudeAt: p.at, direction: p.direction };
    const { row: prow, col: pcol } = parseCoordinate(p.at);
    const contains = (o: Observation) => {
      const { row: r, col: c } = parseCoordinate(o.claudeAt);
      return r === prow && pcol >= c && pcol < c + [...o.token].length;
    };
    const same = observations.filter((o) => o.role === role && o.scene === p.scene && o.direction === p.direction);
    const anchored = same.find((o) => o.claudeAt === p.at) ?? same.find(contains);
    const probeCell = anchored ? undefined : roleCell(p.scene, role, p.direction);
    const offset = anchored ? pcol - parseCoordinate(anchored.claudeAt).col : 0;
    const piAnchor = anchored ? parseCoordinate(anchored.piAt) : undefined;
    const link: { piAt: Coordinate } | undefined = piAnchor ? { piAt: `${piAnchor.row}:${piAnchor.col + offset}` } : probeCell ? { piAt: probeCell } : undefined;
    if (!link) {
      results.push({ ...base, verdict: 'INCONCLUSIVE', reason: 'Pi never paints this role in this scene' });
      continue;
    }
    Object.assign(base, { pairing: anchored ? 'text-anchor' : 'role-in-scene' });
    if (anchored && existsSync(cap(themed, p.scene)) && (occurrences(view('claude', p.scene), anchored.token) > 1 || occurrences(view('pi-role-probe', p.scene), anchored.token) > 1)) {
      results.push({ ...base, piAt: link.piAt, verdict: 'INCONCLUSIVE', reason: `token ${JSON.stringify(anchored.token)} appears more than once, so the text anchor cannot tell which occurrence it pairs` });
      continue;
    }
    if (!existsSync(cap(themed, p.scene))) {
      results.push({ ...base, piAt: link.piAt, verdict: 'INCONCLUSIVE', reason: 'themed Pi capture missing' });
      continue;
    }
    const expected = cellStyle(view('claude', p.scene), p.at, p.direction);
    const probe = cellStyle(view('pi-role-probe', p.scene), link.piAt, p.direction);
    const actual = cellStyle(view(themed, p.scene), link.piAt, p.direction);
    if (!expected || !probe || !actual || probe.char !== actual.char) {
      results.push({ ...base, piAt: link.piAt, verdict: 'INCONCLUSIVE', reason: 'themed layout differs from probe layout at this cell' });
      continue;
    }
    if (anchored && probe.char !== expected.char) {
      results.push({ ...base, piAt: link.piAt, verdict: 'INCONCLUSIVE', reason: `text anchor does not land on the cited character (Pi ${JSON.stringify(probe.char)}, Claude ${JSON.stringify(expected.char)})` });
      continue;
    }
    const exp = `${expected.color} ${expected.attrs}`;
    const act = `${actual.color} ${actual.attrs}`;
    const animated = ANIMATED_SCENES.includes(p.scene.replace(/-expanded$|-\d+ms$/, ''));
    const verdict = verdictFor({ matches: exp === act, pairing: anchored && !animated ? 'text-anchor' : 'role-in-scene' });
    results.push({
      ...base,
      piAt: link.piAt,
      expected: exp,
      actual: act,
      verdict,
      ...(verdict === 'INCONCLUSIVE' ? { reason: animated ? 'one unpinned animation frame cannot prove or disprove a match' : 'cells paired by role only, not by text, so the comparison cannot decide' } : {}),
    });
  }
}

for (const s of surfaces) {
  const { scene, at } = parsePointer(s.claude);
  const base = { role: s.role, class: mapping[s.role]?.class ?? 'unmappable', scene, claudeAt: at, direction: s.direction, pairing: 'surface', surface: s.surface };
  const inconclusive = (reason: string) => results.push({ ...base, verdict: 'INCONCLUSIVE', reason });
  if (!existsSync(cap(themed, s.pi.scene))) {
    inconclusive('themed Pi capture missing');
    continue;
  }
  const pi = view(themed, s.pi.scene);
  const rows = pi.lines.flatMap((line, row) => (line.includes(s.pi.find) ? [row] : []));
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) {
    inconclusive(`Pi text ${JSON.stringify(s.pi.find)} found on ${rows.length} rows`);
    continue;
  }
  const line = pi.lines[row] ?? '';
  const after = s.pi.after;
  const offset = line.indexOf(s.pi.find) + (after === undefined ? s.pi.find.indexOf(s.pi.char) : s.pi.find.length);
  const piAt: Coordinate = `${row}:${[...line.slice(0, offset)].length + (after === undefined ? 0 : after - 1)}`;
  const claude = view('claude', scene);
  const expected = cellStyle(claude, at, s.direction);
  const beyondWidth = parseCoordinate(piAt).col >= themedRun.width;
  const actual = cellStyle(pi, piAt, s.direction) ?? (after === undefined || beyondWidth ? undefined : { char: ' ', color: rgb(resolve({ kind: 'default' }, s.direction, palette)), attrs: 'none' });
  const blankBeyondText = after !== undefined && s.pi.char === ' ' && expected?.char === ' ' && actual?.char === ' ' && parseCoordinate(at).col >= (claude.lines[parseCoordinate(at).row] ?? '').trimEnd().length;
  if (!expected || !actual || (!blankBeyondText && (actual.char !== s.pi.char || (!s.differentText && expected.char !== s.pi.char) || !expected.char.trim()))) {
    inconclusive(`cells do not hold the cited characters (Claude ${JSON.stringify(expected?.char)}, Pi ${JSON.stringify(actual?.char)})`);
    continue;
  }
  const exp = `${expected.color} ${expected.attrs}`;
  const act = `${actual.color} ${actual.attrs}`;
  const animated = ANIMATED_SCENES.includes(scene.replace(/-expanded$|-\d+ms$/, ''));
  const verdict = verdictFor({ matches: exp === act, pairing: animated ? 'role-in-scene' : 'text-anchor' });
  results.push({ ...base, piAt, expected: exp, actual: act, verdict, ...(verdict === 'INCONCLUSIVE' ? { reason: 'one unpinned animation frame cannot prove or disprove a match' } : {}) });
}

const byRole: Partial<Record<ThemeToken, Record<Verdict, number>>> = {};
for (const r of results) {
  const tally = byRole[r.role] ?? { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
  byRole[r.role] = tally;
  tally[r.verdict]++;
}
const total = { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
for (const r of results) total[r.verdict]++;
mkdirSync(join(dev, 'results'), { recursive: true });
const inputs = { ...(themedRun.packageSha256 ? { package: themedRun.packageSha256 } : {}), ...(themedRun.themeSha256 ? { theme: themedRun.themeSha256 } : {}) };
const stale = gateVerdict({ verdict: 'PASS', inputs }, currentInputs(join(dev, '..'))).stale;
if (stale) console.error(`stale: ${themed} was captured with inputs ${JSON.stringify(inputs)}, not the current package and theme`);
const comparableRoles = roleEntries(mapping)
  .filter(([, m]) => m.class !== 'pi-only')
  .map(([role]) => role);
const g4: Verdict = stale ? 'INCONCLUSIVE' : g4Verdict({ comparableRoles, byRole });
writeFileSync(join(dev, 'results/g4.json'), `${JSON.stringify({ gate: 'G4', verdict: g4, themed, inputs: { ...inputs, evidence: evidenceFingerprint(dev, themed) }, total, byRole, results }, null, 2)}\n`);
console.log(JSON.stringify({ G4: g4, stale, total, comparableRolesWithoutObservations: comparableRoles.filter((r) => !byRole[r]).length }));
