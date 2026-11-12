import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { renderStatusSection, spliceStatusSection } from '../../scripts/parity-lib.mjs';
import { type MiniRoot, miniRoot, PKG, script } from './helpers.ts';

let mini: MiniRoot;
afterEach(() => mini?.cleanup());

const build = (tests: Record<string, string>) => {
  const r = script('build-parity-manifest.mjs', ['--root', mini.root, '--results', mini.report(tests), '--no-docs']);
  expect(r.status, r.stderr).toBe(0);
};
const gate = () => script('check-release.mjs', ['--root', mini.root]);

describe('release gate', () => {
  test('exits 0 only when every mandatory requirement is PASS', () => {
    mini = miniRoot();
    build({ 'suite passes': 'passed' });
    const r = gate();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('release gate: OPEN');
  });

  test('exits non-zero and names each non-PASS requirement by id and source', () => {
    mini = miniRoot();
    build({ 'suite passes': 'skipped' });
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('INCONCLUSIVE BEH-ONE  [vendor/upstream-pstack/skills/x/SKILL.md:3-4]');
    expect(r.stderr).toContain('INCONCLUSIVE SRC/pstack/skills/x/SKILL.md  [vendor/upstream-pstack/skills/x/SKILL.md:1-4]');
    expect(r.stderr).toContain('release gate: CLOSED');
  });

  test('a failure is listed as FAIL and cannot be outweighed by passes', () => {
    mini = miniRoot();
    build({ 'suite passes': 'failed' });
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAIL\s+BEH-ONE/);
    expect(r.stderr).not.toContain('%');
  });

  test('a status edited by hand is caught by recomputing it from the recorded test results', () => {
    mini = miniRoot();
    build({ 'suite passes': 'failed' });
    const path = join(mini.root, 'generated/parity-manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    for (const r of manifest.requirements) r.status = 'PASS';
    writeFileSync(path, JSON.stringify(manifest));
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('the status was edited by hand');
  });

  test('a manifest built before the requirements changed is stale', () => {
    mini = miniRoot();
    build({ 'suite passes': 'passed' });
    const path = join(mini.root, 'requirements/requirements.json');
    writeFileSync(path, `${readFileSync(path, 'utf8')} `);
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('manifest is stale');
  });

  test('no manifest is a failure, not a pass', () => {
    mini = miniRoot();
    const r = gate();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no parity manifest');
  });

  test('a not-applicable requirement does not hold the gate shut', () => {
    mini = miniRoot({
      behavioral: [
        {
          id: 'BEH-NA',
          title: 'N',
          specSection: '12',
          source: { specOnly: true, reason: 'package property' },
          observable: 'o',
          invariants: ['i'],
          piMechanism: 'm',
          dependencies: [],
          prerequisites: [],
          applicability: { mandatory: false, justification: 'Cursor-only service' },
          verification: 'v',
          tests: [],
        },
      ],
    });
    build({ 'suite passes': 'passed' });
    expect(gate().status).toBe(0);
  });
});

describe('the committed manifest', () => {
  const manifest = () => JSON.parse(readFileSync(join(PKG, 'generated/parity-manifest.json'), 'utf8'));

  test('was built from the current requirements and upstream lock', () => {
    const r = script('check-release.mjs', []);
    expect(r.stderr).not.toContain('manifest is stale');
    expect(r.stderr).not.toContain('edited by hand');
    expect(r.stderr).not.toContain('missing from the manifest');
  });

  test('is the source of the generated section of docs/parity-status.md', () => {
    const doc = readFileSync(join(PKG, 'docs/parity-status.md'), 'utf8');
    expect(spliceStatusSection(doc, renderStatusSection(manifest()))).toBe(doc);
  });

  test('records the run it was derived from', () => {
    const { run } = manifest();
    expect(run.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(run.startedAt).toMatch(/^\d{4}-/);
    expect(run.totalTests).toBeGreaterThan(0);
  });
});
