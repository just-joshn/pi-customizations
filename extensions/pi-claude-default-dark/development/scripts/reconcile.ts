import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ThemeToken } from '@earendil-works/pi-coding-agent';
import { screen } from '../lib/align.ts';
import { type CapturePointer, type ColorValue, type Direction, isColorValue, type MappingClass, OverridesSchema, parsePointer, parseRole, ReviewsSchema, type RoleMapping, readJson, roleEntries } from '../lib/schemas.ts';

const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
const review = (name: string) => ({ name, roles: readJson(join(dev, 'mapping-review', `${name}.json`), ReviewsSchema).roles });
const reviews = [review('claude'), review('gpt')] satisfies [ReturnType<typeof review>, ReturnType<typeof review>];
const crosswalk = readFileSync(join(dev, 'crosswalk.csv'), 'utf8').trim().split('\n').slice(1);
const directionOf = new Map<ThemeToken, Direction>(crosswalk.map((line) => [parseRole(line.split(',')[0] ?? ''), line.includes(',background,') ? 'bg' : 'fg']));

const blankAt = (pointer: CapturePointer) => {
  const { scene, row, col } = parsePointer(pointer);
  const char = screen(readFileSync(join(dev, 'captures/claude', `${scene}.ansi`), 'utf8')).cells[row]?.[col]?.char;
  return !char?.trim();
};

const severity = { 'pi-only': 0, measured: 1, 'renderer-required': 2, unmappable: 3 } satisfies Record<MappingClass, number>;
function failClosedClass(a: MappingClass, b: MappingClass, disagree: boolean): MappingClass {
  const floor: MappingClass = disagree ? 'renderer-required' : 'pi-only';
  return [a, b, floor].reduce((worst, next) => (severity[next] > severity[worst] ? next : worst));
}
const roles: Partial<Record<ThemeToken, RoleMapping>> = {};
const unproven: string[] = [];
const disagreements: string[] = [];
for (const [role, direction] of directionOf) {
  const [first, second] = reviews;
  const a = first.roles[role];
  const b = second.roles[role];
  const sameMeasured = a.class === 'measured' && b.class === 'measured' && a.value === b.value && (a.attrs ?? 'none') === (b.attrs ?? 'none');
  const disagree = a.class !== b.class || (a.class === 'measured' && !sameMeasured);
  const cls = failClosedClass(a.class, b.class, disagree);
  if (disagree) disagreements.push(`${role}: claude=${a.class}${a.value ? ` ${a.value}` : ''} gpt=${b.class}${b.value ? ` ${b.value}` : ''} -> ${cls}`);

  const candidates: { value: ColorValue; evidence: CapturePointer[]; from: string }[] = [];
  for (const { name: from, roles: reviewed } of reviews) {
    const r = reviewed[role];
    if (r.class === 'measured' && isColorValue(r.value)) candidates.push({ value: r.value, evidence: r.evidence ?? [], from });
    for (const c of r.contexts ?? []) {
      if ((c.direction ?? direction) !== direction || !isColorValue(c.value)) continue;
      candidates.push({ value: c.value, evidence: c.evidence ?? (c.at ? [c.at] : []), from });
    }
  }
  for (const c of candidates) if (direction === 'fg') c.evidence = c.evidence.filter((p) => !blankAt(p));
  const byValue = new Map<ColorValue, { evidence: Set<CapturePointer>; from: Set<string> }>();
  for (const c of candidates) {
    const entry = byValue.get(c.value) ?? { evidence: new Set(), from: new Set() };
    for (const e of c.evidence) entry.evidence.add(e);
    entry.from.add(c.from);
    byValue.set(c.value, entry);
  }
  const ranked = [...byValue].filter(([, e]) => e.evidence.size > 0).sort((x, y) => y[1].from.size - x[1].from.size || y[1].evidence.size - x[1].evidence.size);
  const chosen = cls === 'pi-only' || cls === 'unmappable' ? undefined : ranked[0];
  if (!chosen && (cls === 'measured' || cls === 'renderer-required')) unproven.push(role);
  roles[role] = chosen
    ? {
        class: cls,
        source: 'capture',
        value: chosen[0],
        direction,
        evidence: [...chosen[1].evidence].slice(0, 4),
        agreedBy: [...chosen[1].from],
        otherContexts: ranked.slice(1).map(([v, e]) => `${v} @ ${[...e.evidence][0] ?? '?'}`),
      }
    : { class: cls, source: 'stock-pi', direction };
}

const overridesPath = join(dev, 'mapping-review/overrides.json');
if (!existsSync(overridesPath)) throw new Error(`missing ${overridesPath}; write {"roles":{}} for no overrides`);
const overrides = readJson(overridesPath, OverridesSchema).roles;
for (const [role, o] of roleEntries(overrides)) {
  roles[role] = { ...o, source: 'capture', agreedBy: ['coordinator'] };
  const at = unproven.indexOf(role);
  if (at >= 0) unproven.splice(at, 1);
}

if (unproven.length) {
  console.error(`no non-blank capture evidence for: ${unproven.join(' ')}`);
  process.exit(1);
}
writeFileSync(join(dev, 'mapping.json'), `${JSON.stringify({ roles, disagreements }, null, 2)}\n`);
const tally: Record<string, number> = {};
for (const r of Object.values(roles)) tally[`${r.class}/${r.source}`] = (tally[`${r.class}/${r.source}`] ?? 0) + 1;
console.log(JSON.stringify({ disagreements: disagreements.length, tally }));
