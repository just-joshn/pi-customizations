import { describe, expect, test } from 'vitest';
import { piHostCapabilities } from '../../src/adapters/agents.ts';
import { fixedClock } from '../../src/orchestrator/clock.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { captureGuidelines, type FindingInput } from '../../src/review/findings.ts';
import { REVIEW_DIMENSIONS, reviewAssurance, reviewDimensions } from '../../src/review/reviewer.ts';
import { applyAll, expectOk, freshRun } from './support.ts';

// biome-ignore lint/security/noSecrets: sha256 of "abc"
const ABC_SHA256 = 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

const FINDING: FindingInput = {
  severity: 'high',
  trigger: 'empty invoice list',
  consequence: 'CSV has no header',
  evidence: 'out.csv is 0 bytes',
  owner: 'IMPLEMENT',
  reviewer: 'reviewer-agent',
  guidelines: null,
};

describe('findings', () => {
  test('record_finding opens a finding at the current revision', () => {
    const state = expectOk(apply(freshRun(), { kind: 'record_finding', finding: FINDING }, fixedClock()));
    expect(state.findings).toEqual([{ ...FINDING, id: 'finding-1', status: 'open', revision: 'r1' }]);
  });

  test('resolving a finding closes it', () => {
    const { state } = applyAll(freshRun(), [
      { kind: 'record_finding', finding: FINDING },
      { kind: 'resolve_finding', id: 'finding-1', resolution: 'resolved' },
    ]);
    expect(state.findings.map((finding) => finding.status)).toEqual(['resolved']);
  });

  test('duplicate open finding is idempotent', () => {
    const { state } = applyAll(freshRun(), [{ kind: 'record_finding', finding: FINDING }]);
    expect(apply(state, { kind: 'record_finding', finding: FINDING }, fixedClock())).toEqual({ kind: 'ok', state, decisions: [] });
  });

  test('finding text is redacted', () => {
    // biome-ignore lint/security/noSecrets: synthetic test value
    const state = expectOk(apply(freshRun(), { kind: 'record_finding', finding: { ...FINDING, evidence: 'logged sk-livekey12345678' } }, fixedClock()));
    expect(state.findings[0]?.evidence).toBe('logged <REDACTED>');
  });

  test('unknown finding cannot be resolved', () => {
    expect(apply(freshRun(), { kind: 'resolve_finding', id: 'x', resolution: 'dismissed' }, fixedClock())).toEqual({ kind: 'rejected', reason: 'unknown finding x', gate: null });
  });
});

describe('review assurance', () => {
  test('Pi host defaults to no independent agents', () => {
    expect(piHostCapabilities()).toEqual({ independentAgents: false, isolatedWorktrees: false, browserDriver: false, nativeAutomation: false, installedSkills: [] });
  });

  test('independent agents give independent review', () => {
    expect(reviewAssurance(piHostCapabilities({ independentAgents: true }))).toEqual({ kind: 'independent' });
  });

  test('self review is labelled reduced assurance', () => {
    expect(reviewAssurance(piHostCapabilities())).toEqual({ kind: 'reduced', reason: 'same-agent read-only review; no independent agents' });
  });

  test('non-web review covers the twelve required dimensions', () => {
    expect(reviewDimensions({ kind: 'non_web' })).toEqual(REVIEW_DIMENSIONS);
  });

  test('react web UI review adds react best practices', () => {
    expect(reviewDimensions({ kind: 'web_ui', react: true }).slice(12)).toEqual(['frontend_design_contract', 'web_design_guidelines', 'agent_browser_verification', 'vercel_react_best_practices']);
  });

  test('non-react web UI review omits react rules', () => {
    expect(reviewDimensions({ kind: 'web_ui', react: false }).slice(12)).toEqual(['frontend_design_contract', 'web_design_guidelines', 'agent_browser_verification']);
  });
});

describe('web guidelines', () => {
  test('captures sha256 of fetched guideline content', () => {
    expect(captureGuidelines('abc', 'web-design-guidelines@abc123')).toEqual({
      contentHash: ABC_SHA256,
      skillLock: 'web-design-guidelines@abc123',
    });
  });

  test('guideline hash is stored on the finding', () => {
    const guidelines = captureGuidelines('abc', 'web-design-guidelines@abc123');
    const state = expectOk(apply(freshRun(), { kind: 'record_finding', finding: { ...FINDING, guidelines } }, fixedClock()));
    expect(state.findings[0]?.guidelines?.contentHash).toBe(ABC_SHA256);
  });
});

describe('prototype retention', () => {
  test('prototype without a branch is rejected', () => {
    expect(apply(freshRun(), { kind: 'record_prototype', question: 'stream?', verdict: 'yes', branch: ' ', issuePointer: null }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'prototype branch required; prototypes are retained on a branch',
      gate: null,
    });
  });

  test('prototype branch is kept as evidence artifact', () => {
    const state = expectOk(apply(freshRun(), { kind: 'record_prototype', question: 'stream?', verdict: 'yes', branch: 'proto/stream', issuePointer: '#12' }, fixedClock()));
    expect(state.run.prototypes).toEqual([{ question: 'stream?', verdict: 'yes', branch: 'proto/stream', issuePointer: '#12' }]);
    expect(state.evidence.map((record) => [record.method, record.artifact, record.state])).toEqual([['prototype', 'proto/stream', 'MEASURED']]);
  });
});

function inReview(consumer: 'cli' | 'browser', independentAgents = false) {
  const base = freshRun({ consumer: { kind: consumer, userPath: 'invoices' }, capabilities: piHostCapabilities({ independentAgents }) });
  return { ...base, run: { ...base.run, phase: 'REVIEW' as const } };
}

const fullReview = (guidelinesContent: string | null) => ({ kind: 'record_review', reviewer: 'reviewer-agent', dimensions: [...reviewDimensions({ kind: 'web_ui', react: true })], guidelinesContent }) as const;

describe('review phase', () => {
  test('a review missing a required dimension is rejected', () => {
    expect(apply(inReview('cli'), { kind: 'record_review', reviewer: 'r', dimensions: ['correctness_and_acceptance_criteria'], guidelinesContent: null }, fixedClock())).toMatchObject({
      kind: 'rejected',
      reason: expect.stringMatching(/^review misses dimensions: domain_invariants, authorization_and_data_integrity,/),
    });
  });

  test('web UI review without fetched guidelines is rejected', () => {
    expect(apply(inReview('browser'), fullReview(null), fixedClock())).toEqual({ kind: 'rejected', reason: 'web UI review needs the fetched web-design-guidelines content', gate: null });
  });

  test('same-agent review is stored with reduced assurance', () => {
    const state = expectOk(apply(inReview('cli'), fullReview(null), fixedClock()));
    expect(state.evidence.map((record) => [record.claim, record.observed])).toEqual([['review', 'reviewer-agent (reduced: same-agent read-only review; no independent agents)']]);
  });

  test('independent agents give a review stored as independent', () => {
    const state = expectOk(apply(inReview('cli', true), fullReview(null), fixedClock()));
    expect(state.evidence.map((record) => record.observed)).toEqual(['reviewer-agent (independent)']);
  });

  test('web guideline hash binds to every later finding', () => {
    const { state } = applyAll(inReview('browser'), [fullReview('abc'), { kind: 'record_finding', finding: FINDING }]);
    expect(state.findings.map((finding) => [finding.revision, finding.guidelines])).toEqual([['r1', { contentHash: ABC_SHA256, skillLock: 'web-design-guidelines@063bee94c3f4df8453406c830b0a7df0f2860278' }]]);
  });
});
