import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { ThemeToken } from '@earendil-works/pi-coding-agent';
import { type Inputs, type ManualCheck, type MappingClass, roleEntries, type Verdict } from './schemas.ts';

export type { Inputs, Verdict } from './schemas.ts';

function hashFiles(root: string, paths: string[]): string {
  const hash = createHash('sha256');
  const visit = (path: string) => {
    if (statSync(path).isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name));
    else hash.update(relative(root, path)).update(readFileSync(path));
  };
  for (const p of paths) visit(join(root, p));
  return hash.digest('hex');
}

export function evidenceFingerprint(dev: string, themed: string): string {
  return hashFiles(dev, ['captures/claude', `captures/${themed}`, 'captures/pi-role-probe', 'captures/observations.json', 'captures/terminal-palette.json', 'captures/role-probe.map.json', 'mapping.json', 'surfaces.json']);
}

export function currentInputs(packageRoot: string): Required<Pick<Inputs, 'package' | 'theme'>> {
  return {
    package: hashFiles(packageRoot, ['package.json', 'extensions', 'themes']),
    theme: createHash('sha256')
      .update(readFileSync(join(packageRoot, 'themes/claude-default-dark.json')))
      .digest('hex'),
  };
}

export function gateVerdict(result: { verdict: Verdict; inputs?: Inputs }, current: Inputs, required: (keyof Inputs)[] = ['package']): { verdict: Verdict; stale: boolean } {
  const keys: (keyof Inputs)[] = ['package', 'theme', 'evidence'];
  const recorded = keys.flatMap((key): [keyof Inputs, string][] => {
    const hash = result.inputs?.[key];
    return hash === undefined ? [] : [[key, hash]];
  });
  const fresh = required.every((key) => result.inputs?.[key] !== undefined) && recorded.every(([key, hash]) => current[key] === hash);
  return fresh ? { verdict: result.verdict, stale: false } : { verdict: 'INCONCLUSIVE', stale: true };
}

export function measuredSummary(mapping: Partial<Record<ThemeToken, { class: MappingClass }>>, byRole: Partial<Record<ThemeToken, Record<Verdict, number>>>) {
  const measured = roleEntries(mapping)
    .filter(([, value]) => value.class === 'measured')
    .map(([role]) => role);
  const of = (role: ThemeToken) => byRole[role] ?? { PASS: 0, FAIL: 0, INCONCLUSIVE: 0 };
  const mismatched = measured.filter((r) => of(r).FAIL > 0).length;
  const exact = measured.filter((r) => of(r).FAIL === 0 && of(r).PASS > 0).length;
  return { total: measured.length, exact, mismatched, uncompared: measured.length - exact - mismatched };
}

type Tally = Record<Verdict, number>;
type ByRole = Partial<Record<ThemeToken, Tally>>;

export function g4Verdict({ comparableRoles, byRole }: { comparableRoles: ThemeToken[]; byRole: ByRole }): Verdict {
  const tallies = Object.values(byRole);
  if (tallies.some((t) => t.FAIL > 0)) return 'FAIL';
  const uncovered = comparableRoles.some((role) => !byRole[role]) || tallies.some((t) => t.PASS + t.FAIL + t.INCONCLUSIVE === 0);
  return uncovered || tallies.length === 0 || tallies.some((t) => t.INCONCLUSIVE > 0) ? 'INCONCLUSIVE' : 'PASS';
}

export function g3Verdict({ blockingRoles, claudeOnly, comparableRoles, byRole }: { blockingRoles: number; claudeOnly: (unknown[] | undefined)[]; comparableRoles: ThemeToken[]; byRole: ByRole }): Verdict {
  const unmeasured = comparableRoles.some((role) => !((byRole[role]?.PASS ?? 0) > 0 && (byRole[role]?.FAIL ?? 0) === 0));
  if (blockingRoles > 0 || claudeOnly.some((list) => (list?.length ?? 0) > 0) || unmeasured) return 'FAIL';
  return claudeOnly.every((list) => list !== undefined) ? 'PASS' : 'INCONCLUSIVE';
}

export function g10Verdict({ others, generated, approved }: { others: Verdict[]; generated: string; approved: string | undefined }): Verdict {
  if (others.includes('FAIL')) return 'FAIL';
  if (others.some((v) => v !== 'PASS') || approved === undefined) return 'INCONCLUSIVE';
  return generated === approved ? 'PASS' : 'FAIL';
}

export function manualVerdict(record: ManualCheck | undefined, currentPackage: string, hashOf: (file: string) => string | undefined): { verdict: Verdict; reason: string } {
  if (!record) return { verdict: 'INCONCLUSIVE', reason: 'no manual check recorded' };
  if (record.packageSha256 !== currentPackage) return { verdict: 'INCONCLUSIVE', reason: 'stale: recorded against another package' };
  if (!record.evidence.length) return { verdict: 'INCONCLUSIVE', reason: 'no evidence files' };
  const broken = record.evidence.find((e) => hashOf(e.file) !== e.sha256);
  if (broken) return { verdict: 'INCONCLUSIVE', reason: `evidence ${broken.file} is missing or changed` };
  return { verdict: record.verdict, reason: record.note };
}

export function rollup(checks: { verdict: unknown }[]): Verdict {
  if (checks.some((c) => c.verdict !== 'PASS' && c.verdict !== 'INCONCLUSIVE')) return 'FAIL';
  return checks.length === 0 || checks.some((c) => c.verdict === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS';
}
