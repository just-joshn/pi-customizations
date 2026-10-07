import { describe, expect, test } from 'vitest';
import type { ConsumerKind } from '../../src/domain/run.ts';
import { invalidate, latestByClaim, matches } from '../../src/evidence/invalidation.ts';
import { redact, routeConsumer } from '../../src/evidence/verification.ts';
import type { EvidenceInput } from '../../src/orchestrator/command.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { fixedClock } from '../support/clock.ts';
import { applyAll, expectOk, freshRun, measured, NO_CAPS } from './support.ts';

const INPUT: EvidenceInput = {
  claim: 'export prints CSV header',
  criterion: 'csv export lists every invoice',
  state: 'MEASURED',
  dependencies: ['src/export/**'],
  method: 'cli',
  expected: 'id,total',
  observed: 'id,total',
  artifact: 'out.csv',
};

describe('evidence records', () => {
  test('record_evidence binds to the current revision', () => {
    const state = expectOk(apply(freshRun(), { kind: 'record_evidence', evidence: INPUT }, fixedClock()));
    expect(state.evidence).toEqual([{ ...INPUT, id: 'ev-1', revision: 'r1', recordedAt: '2026-10-07T00:00:00.000Z', supersedes: null }]);
  });

  test('identical evidence is idempotent', () => {
    const { state } = applyAll(freshRun(), [{ kind: 'record_evidence', evidence: INPUT }]);
    expect(apply(state, { kind: 'record_evidence', evidence: INPUT }, fixedClock())).toEqual({ kind: 'ok', state, decisions: [] });
  });

  test('a newer record for the claim supersedes the old one', () => {
    const { state } = applyAll(freshRun(), [
      { kind: 'record_evidence', evidence: { ...INPUT, state: 'FAILED', observed: 'empty' } },
      { kind: 'record_evidence', evidence: INPUT },
    ]);
    expect(state.evidence.map((record) => [record.id, record.state, record.supersedes])).toEqual([
      ['ev-1', 'FAILED', null],
      ['ev-2', 'MEASURED', 'ev-1'],
    ]);
    expect(latestByClaim(state.evidence).map((record) => record.id)).toEqual(['ev-2']);
  });
});

describe('invalidation', () => {
  test.for([
    ['src/**', 'src/a/b.ts', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['src/**/*.ts', 'src/x.ts', true],
    ['docs/readme.md', 'docs/readme.md', true],
    ['docs/*.md', 'docs/a.txt', false],
  ] as const)('matches(%s, %s) is %s', ([glob, path, expected]) => {
    expect(matches(glob, path)).toBe(expected);
  });

  test('evidence without declared dependencies stales on any change', () => {
    const next = invalidate([measured('loose', 'r1', { dependencies: [] })], ['README.md'], 'r2', fixedClock());
    expect(latestByClaim(next).map((record) => [record.claim, record.state, record.revision])).toEqual([['loose', 'STALE', 'r1']]);
  });

  test('only affected evidence turns STALE', () => {
    const evidence = [measured('export', 'r1', { dependencies: ['src/export/**'] }), measured('docs', 'r1', { dependencies: ['docs/**'] })];
    const next = invalidate(evidence, ['src/export/csv.ts'], 'r2', fixedClock());
    expect(latestByClaim(next).map((record) => [record.claim, record.state, record.revision, record.supersedes])).toEqual([
      ['export', 'STALE', 'r1', 'ev-export'],
      ['docs', 'MEASURED', 'r2', 'ev-docs'],
    ]);
    expect(next.slice(0, 2)).toEqual(evidence);
  });

  test('revision_changed leaves PR_READY for REVERIFY_STALE', () => {
    const base = freshRun();
    const state = { ...base, run: { ...base.run, phase: 'PR_READY' as const, status: { kind: 'pr_ready' as const, revision: 'r1' } } };
    const next = expectOk(apply(state, { kind: 'revision_changed', revision: 'r2', changedPaths: ['src/a.ts'] }, fixedClock()));
    expect([next.run.phase, next.run.status, next.run.currentRevision]).toEqual(['REVERIFY_STALE', { kind: 'active' }, 'r2']);
  });
});

describe('consumer routing', () => {
  test.for([
    ['browser', NO_CAPS, { kind: 'inconclusive', missing: 'browser driver (agent-browser) unavailable' }],
    ['browser', { ...NO_CAPS, browserDriver: true }, { kind: 'agent_browser' }],
    ['electron', NO_CAPS, { kind: 'inconclusive', missing: 'electron driver (agent-browser) unavailable' }],
    ['cli', NO_CAPS, { kind: 'drive_executable' }],
    ['tui', NO_CAPS, { kind: 'drive_executable' }],
    ['http', NO_CAPS, { kind: 'protocol_request' }],
    ['rpc', NO_CAPS, { kind: 'protocol_request' }],
    ['library', NO_CAPS, { kind: 'public_api' }],
    ['native', NO_CAPS, { kind: 'inconclusive', missing: 'native automation unavailable' }],
    ['native', { ...NO_CAPS, nativeAutomation: true }, { kind: 'native_automation' }],
  ] as const)('%s consumer routes to %o', ([kind, capabilities, expected]) => {
    expect(routeConsumer(kind satisfies ConsumerKind, capabilities)).toEqual(expected);
  });
});

describe('secret redaction', () => {
  test.for([
    ['Authorization: Bearer abc.def', 'Authorization: <REDACTED>'],
    ['token Bearer abcdef123456', 'token Bearer <REDACTED>'],
    // biome-ignore lint/security/noSecrets: synthetic test value
    [`key ${['sk', 'abcdefghijklmnop1234'].join('-')}`, 'key <REDACTED>'],
    // biome-ignore lint/security/noSecrets: synthetic test value
    [`gh ${['ghp', 'abcdefghijklmnopqrstuvwxyz0123'].join('_')}`, 'gh <REDACTED>'],
    ['slack xoxb-1234-abcd', 'slack <REDACTED>'],
    // biome-ignore lint/security/noSecrets: synthetic test value
    [`aws ${'AKIA'}${'ABCDEFGHIJKLMNOP'}`, 'aws <REDACTED>'],
    // biome-ignore lint/security/noSecrets: synthetic test value
    ['db password=hunter2 ok', 'db password=<REDACTED> ok'],
    ['jwt eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl', 'jwt <REDACTED>'],
    [['BEGIN', 'END'].map((edge) => `-----${edge} RSA ${'PRIVATE'} KEY-----`).join('\nMIIE\n'), '<REDACTED>'],
  ] as const)('redacts %j', ([input, expected]) => {
    expect(redact(input)).toBe(expected);
  });

  test('record_evidence stores redacted text', () => {
    const state = expectOk(apply(freshRun(), { kind: 'record_evidence', evidence: { ...INPUT, observed: 'curl -H "Authorization: Bearer x" password=pw' } }, fixedClock()));
    expect(state.evidence[0]?.observed).toBe('curl -H "Authorization: <REDACTED>');
  });
});
