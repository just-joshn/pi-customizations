import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { evidenceFingerprint, gateVerdict, manualVerdict, measuredSummary, rollup } from '../lib/gates.ts';
import type { Verdict } from '../lib/schemas.ts';

describe('rollup', () => {
  test.for<[string, unknown[], string]>([
    ['all passing checks', ['PASS', 'PASS'], 'PASS'],
    ['any failing check', ['PASS', 'FAIL', 'INCONCLUSIVE'], 'FAIL'],
    ['an inconclusive check', ['PASS', 'INCONCLUSIVE'], 'INCONCLUSIVE'],
    ['a misspelled verdict', ['PASS', 'PASSED'], 'FAIL'],
    ['a missing verdict', ['PASS', undefined], 'FAIL'],
    ['no checks', [], 'INCONCLUSIVE'],
  ])('%s', ([, verdicts, expected]) => {
    expect(rollup(verdicts.map((verdict) => ({ verdict })))).toBe(expected);
  });
});

describe('G4 evidence fingerprint', () => {
  const dir = () => {
    const root = mkdtempSync(join(tmpdir(), 'evidence-'));
    for (const d of ['captures/claude', 'captures/themed', 'captures/pi-role-probe']) mkdirSync(join(root, d), { recursive: true });
    for (const f of ['captures/claude/a.ansi', 'captures/themed/a.ansi', 'captures/pi-role-probe/a.ansi', 'captures/observations.json', 'captures/terminal-palette.json', 'captures/role-probe.map.json', 'mapping.json', 'surfaces.json'])
      writeFileSync(join(root, f), 'x');
    return root;
  };
  test('changes when a capture the comparison read changes', () => {
    const root = dir();
    const before = evidenceFingerprint(root, 'themed');
    writeFileSync(join(root, 'captures/themed/a.ansi'), 'garbage');
    expect(evidenceFingerprint(root, 'themed')).not.toBe(before);
  });
  test('a G4 result is stale when its evidence fingerprint no longer matches, or was never recorded', () => {
    const current = { package: 'aaa', theme: 'bbb', evidence: 'eee' };
    expect(gateVerdict({ verdict: 'PASS', inputs: { package: 'aaa', theme: 'bbb', evidence: 'eee' } }, current, ['package', 'evidence']).stale).toBe(false);
    expect(gateVerdict({ verdict: 'PASS', inputs: { package: 'aaa', theme: 'bbb', evidence: 'old' } }, current, ['package', 'evidence']).stale).toBe(true);
    expect(gateVerdict({ verdict: 'PASS', inputs: { package: 'aaa', theme: 'bbb' } }, current, ['package', 'evidence']).stale).toBe(true);
  });
});

describe('gateVerdict', () => {
  const current = { package: 'aaa', theme: 'bbb' };

  test('keeps a verdict recorded against the current inputs', () => {
    expect(gateVerdict({ verdict: 'PASS', inputs: { package: 'aaa' } }, current)).toEqual({ verdict: 'PASS', stale: false });
  });

  test.for([
    ['different package', { verdict: 'PASS', inputs: { package: 'old' } }],
    ['different theme', { verdict: 'FAIL', inputs: { theme: 'old' } }],
    ['no recorded inputs', { verdict: 'PASS' }],
    ['only a matching theme hash', { verdict: 'PASS', inputs: { theme: 'bbb' } }],
    ['a matching package with a different theme', { verdict: 'PASS', inputs: { package: 'aaa', theme: 'old' } }],
  ] satisfies [string, { verdict: Verdict; inputs?: { package?: string; theme?: string } }][])('treats a result with %s as stale and inconclusive', ([, result]) => {
    expect(gateVerdict(result, current)).toEqual({ verdict: 'INCONCLUSIVE', stale: true });
  });
});

describe('measuredSummary', () => {
  test('counts only roles with an exact match and no mismatch as exact', () => {
    const mapping = { accent: { class: 'measured' }, border: { class: 'measured' }, text: { class: 'measured' }, muted: { class: 'measured' }, error: { class: 'renderer-required' } } satisfies Parameters<typeof measuredSummary>[0];
    const byRole = {
      accent: { PASS: 2, FAIL: 0, INCONCLUSIVE: 1 },
      border: { PASS: 0, FAIL: 0, INCONCLUSIVE: 3 },
      text: { PASS: 1, FAIL: 1, INCONCLUSIVE: 0 },
      error: { PASS: 4, FAIL: 0, INCONCLUSIVE: 0 },
    };
    expect(measuredSummary(mapping, byRole)).toEqual({ total: 4, exact: 1, mismatched: 1, uncompared: 2 });
  });
});

describe('manualVerdict', () => {
  const record = { name: 'IME', verdict: 'PASS' as const, note: 'composition inline', packageSha256: 'pkg', evidence: [{ file: 'results/manual/a.jpg', sha256: 'aaa' }] };
  test('keeps the recorded verdict when the package and evidence are unchanged', () => {
    expect(manualVerdict(record, 'pkg', () => 'aaa')).toEqual({ verdict: 'PASS', reason: 'composition inline' });
  });
  test('is inconclusive when nothing was recorded', () => {
    expect(manualVerdict(undefined, 'pkg', () => 'aaa').verdict).toBe('INCONCLUSIVE');
  });
  test('is inconclusive when the package changed since the check', () => {
    expect(manualVerdict(record, 'other', () => 'aaa').verdict).toBe('INCONCLUSIVE');
  });
  test('is inconclusive when an evidence file is missing or altered', () => {
    expect(manualVerdict(record, 'pkg', () => undefined).verdict).toBe('INCONCLUSIVE');
    expect(manualVerdict(record, 'pkg', () => 'bbb').verdict).toBe('INCONCLUSIVE');
  });
  test('is inconclusive without evidence files', () => {
    expect(manualVerdict({ ...record, evidence: [] }, 'pkg', () => 'aaa').verdict).toBe('INCONCLUSIVE');
  });
});
