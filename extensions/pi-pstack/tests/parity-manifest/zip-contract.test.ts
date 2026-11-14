import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { loadInputs, sourceDigest } from '../../scripts/parity-lib.mjs';
import { evaluateZip, type ZipRegister, zipRequirementDigest } from '../../scripts/zip-contract.mjs';
import { type MiniRoot, miniRoot, PKG, script } from './helpers.ts';

let mini: MiniRoot;
afterEach(() => mini?.cleanup());
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const register = (): ZipRegister => JSON.parse(readFileSync(join(PKG, 'requirements/requirements.json'), 'utf8')).zip;
const setup = () => {
  mini = miniRoot();
  const inputs = JSON.parse(readFileSync(join(mini.root, 'requirements/requirements.json'), 'utf8'));
  inputs.zip = register();
  mini.write('requirements/requirements.json', JSON.stringify(inputs));
  const lock = JSON.parse(readFileSync(join(mini.root, 'generated/upstream-lock.json'), 'utf8'));
  lock.revision = inputs.zip.upstreamRevision;
  mini.write('generated/upstream-lock.json', JSON.stringify(lock));
  execFileSync('git', ['init', '-q'], { cwd: mini.root });
  execFileSync('git', ['add', '-A'], { cwd: mini.root });
};
const receipt = () => {
  const zip = register();
  const artifact = 'fixture acceptance output\n';
  mini.write('parity-results/zip/output.txt', artifact);
  return {
    schemaVersion: 1,
    sourceDigest: sourceDigest(mini.root),
    upstreamRevision: zip.upstreamRevision,
    piVersion: 'fixture-pi',
    requirements: zip.requirements.map((r) => ({
      id: r.id,
      requirementDigest: zipRequirementDigest(r),
      verdict: 'PASS',
      stimulus: r.stimulus,
      expected: r.evidence,
      command: 'fixture acceptance command',
      observed: 'fixture acceptance output',
      artifacts: [{ path: 'zip/output.txt', sha256: sha(artifact) }],
    })),
  };
};
const evaluate = (evidence?: ReturnType<typeof receipt>) => {
  const path = join(mini.root, 'parity-results/zip-evidence.json');
  if (evidence) mini.write('parity-results/zip-evidence.json', JSON.stringify(evidence));
  return evaluateZip(mini.root, loadInputs(mini.root), evidence ? path : null, 'fixture-pi');
};

describe('audited ZIP release contract', () => {
  test('retains all 23 exact acceptance IDs and separate mandatory security and definition-of-done obligations', () => {
    const zip = register();
    expect(zip.requirements.filter((r: { kind: string }) => r.kind === 'acceptance').map((r: { id: string }) => r.id)).toEqual([
      'SRC-01',
      'ROUTE-01',
      'TODO-01',
      'ROLE-01',
      'PROC-01',
      'PROC-02',
      'MCP-01',
      'SANDBOX-01',
      'TRUST-01',
      'PLAN-01',
      'VERIFY-01',
      'FORMAL-01',
      'ARENA-01',
      'SWARM-01',
      'INTERROGATE-01',
      'BENCH-01',
      'BABYSIT-01',
      'SHIP-01',
      'AUTOPILOT-01',
      'RECALL-01',
      'PAUSE-01',
      'CLEANUP-01',
      'REPORT-01',
    ]);
    expect(zip.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'ZIP-DONE', mandatory: true }),
        expect.objectContaining({ id: 'ZIP-SECURITY', mandatory: true, unresolved: expect.objectContaining({ verdict: 'FAIL' }) }),
        expect.objectContaining({ id: 'ZIP-BENNY', mandatory: true }),
      ]),
    );
    expect(zip.authority.files).toHaveLength(5);
    for (const r of zip.requirements) {
      expect(r.source.document).toBe('pstack_pi_end_to_end_map.md');
      expect(r.source.lines).toHaveLength(2);
      expect(r.stimulus.length).toBeGreaterThan(15);
      expect(r.evidence.length).toBeGreaterThan(10);
      expect(r.unresolved.verdict).not.toBe('PASS');
    }
  });

  test('never derives ZIP PASS from legacy totals or integration alone without fresh exact experiment receipts', () => {
    const result = evaluateZip(PKG, loadInputs(PKG), null, 'fixture-pi');
    expect(result.status).toBe('NOT RELEASED');
    expect(result.requirements.find((r: { id: string }) => r.id === 'SRC-01')?.status).toBe('INCONCLUSIVE');
    expect(result.requirements.find((r: { id: string }) => r.id === 'TODO-01')?.status).toBe('INCONCLUSIVE');
    expect(result.requirements.find((r: { id: string }) => r.id === 'SANDBOX-01')?.status).toBe('FAIL');
  });

  test('accepts only complete current explicit experiment receipts', () => {
    setup();
    const result = evaluate(receipt());
    expect(result.problems).toEqual([]);
    expect(result.status).toBe('ACCEPTED');
    expect(result.requirements.every((r: { status: string }) => r.status === 'PASS')).toBe(true);
  });

  test.each(['FAIL', 'INCONCLUSIVE', 'BLOCKED', 'UNKNOWN'])('refuses a mandatory %s verdict', (verdict) => {
    setup();
    const evidence = receipt();
    const first = evidence.requirements[0];
    assert(first);
    first.verdict = verdict;
    expect(evaluate(evidence).status).toBe('NOT RELEASED');
  });

  test.each(['missing', 'duplicate', 'unknown', 'stale-source', 'stale-contract', 'wrong-pi', 'wrong-pin', 'forged-artifact', 'missing-artifact', 'no-artifact', 'no-command', 'no-observation', 'wrong-stimulus', 'wrong-evidence'])(
    'refuses %s evidence',
    (fault) => {
      setup();
      const evidence = receipt();
      const first = evidence.requirements[0];
      assert(first);
      const artifact = first.artifacts[0];
      assert(artifact);
      if (fault === 'missing') evidence.requirements.shift();
      if (fault === 'duplicate') evidence.requirements.push(first);
      if (fault === 'unknown') first.id = 'FAKE-01';
      if (fault === 'stale-source') evidence.sourceDigest = '0'.repeat(64);
      if (fault === 'stale-contract') first.requirementDigest = '0'.repeat(64);
      if (fault === 'wrong-pi') evidence.piVersion = 'other-pi';
      if (fault === 'wrong-pin') evidence.upstreamRevision = '0'.repeat(40);
      if (fault === 'forged-artifact') artifact.sha256 = '0'.repeat(64);
      if (fault === 'missing-artifact') artifact.path = 'missing.txt';
      if (fault === 'no-artifact') first.artifacts = [];
      if (fault === 'no-command') first.command = '';
      if (fault === 'no-observation') first.observed = '';
      if (fault === 'wrong-stimulus') first.stimulus = 'unrelated unit test';
      if (fault === 'wrong-evidence') first.expected = '10000 passing tests';
      expect(evaluate(evidence).status).toBe('NOT RELEASED');
    },
  );

  test.each(['removed', 'waived', 'initial-PASS', 'missing-source', 'missing-authority'])('rejects a %s mandatory contract', (fault) => {
    setup();
    const inputs = JSON.parse(readFileSync(join(mini.root, 'requirements/requirements.json'), 'utf8'));
    if (fault === 'removed') inputs.zip.requirements.shift();
    if (fault === 'waived') inputs.zip.requirements[0].mandatory = false;
    if (fault === 'initial-PASS') inputs.zip.requirements[0].unresolved.verdict = 'PASS';
    if (fault === 'missing-source') delete inputs.zip.requirements[0].source;
    if (fault === 'missing-authority') inputs.zip.authority.files.pop();
    mini.write('requirements/requirements.json', JSON.stringify(inputs));
    const result = evaluate(receipt());
    expect(result.status).toBe('NOT RELEASED');
    expect(result.problems.length).toBeGreaterThan(0);
  });

  test.each(['traversal', 'symlink'])('rejects an artifact that escapes through %s despite a correct hash', (fault) => {
    setup();
    const evidence = receipt();
    const outside = 'not an experiment artifact';
    mini.write('outside.txt', outside);
    if (fault === 'symlink') symlinkSync(join(mini.root, 'outside.txt'), join(mini.root, 'parity-results/zip/escape.txt'));
    const first = evidence.requirements[0];
    assert(first);
    first.artifacts = [{ path: fault === 'symlink' ? 'zip/escape.txt' : '../outside.txt', sha256: sha(outside) }];
    expect(evaluate(evidence).problems).toEqual(expect.arrayContaining([expect.stringContaining('artifact leaves its evidence directory')]));
  });

  test('rejects a missing register rather than quietly falling back to the legacy gate', () => {
    setup();
    const inputs = loadInputs(mini.root);
    delete inputs.requirements.zip;
    expect(evaluateZip(mini.root, inputs, null, 'fixture-pi').status).toBe('NOT RELEASED');
  });

  test('the CLI refuses unresolved ZIP even when the legacy gate is OPEN', () => {
    setup();
    const built = script('build-parity-manifest.mjs', ['--root', mini.root, '--results', mini.report({ 'suite passes': 'passed' }), '--zip-evidence', '', '--no-docs']);
    expect(built.status, built.stderr).toBe(0);
    const result = script('check-release.mjs', ['--root', mini.root]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ release: 'NOT RELEASED', legacyGate: 'OPEN', zip: { status: 'NOT RELEASED' } });
  });

  test('the CLI recomputes ZIP evidence instead of trusting forged manifest PASS rows', () => {
    setup();
    const built = script('build-parity-manifest.mjs', ['--root', mini.root, '--results', mini.report({ 'suite passes': 'passed' }), '--zip-evidence', '', '--no-docs']);
    expect(built.status, built.stderr).toBe(0);
    const path = join(mini.root, 'generated/parity-manifest.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest.zip.status = 'ACCEPTED';
    for (const r of manifest.zip.requirements) r.status = 'PASS';
    writeFileSync(path, JSON.stringify(manifest));
    const result = script('check-release.mjs', ['--root', mini.root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ZIP: manifest acceptance was edited');
    expect(JSON.parse(result.stdout).release).toBe('NOT RELEASED');
  });

  test('the CLI states NOT RELEASED as JSON even without a parity manifest', () => {
    mini = miniRoot();
    const result = script('check-release.mjs', ['--root', mini.root]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).release).toBe('NOT RELEASED');
  });
});
