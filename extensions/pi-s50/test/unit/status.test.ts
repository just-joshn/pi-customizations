import { expect, test } from 'vitest';
import type { RunState } from '../../src/domain/run.ts';
import type { NextAction } from '../../src/orchestrator/command.ts';
import { describeAction, renderStatus } from '../../src/orchestrator/status.ts';
import { freshRun, node } from './support.ts';

const cases: readonly { name: string; action: NextAction; expected: string }[] = [
  { name: 'manual workflow', action: { kind: 'human_gate', gate: { kind: 'user_workflow', skill: 'triage', action: '/skill:triage' } }, expected: 'wait: user must run /skill:triage' },
  { name: 'missing skill', action: { kind: 'human_gate', gate: { kind: 'missing_skill', skill: 'design', install: 'install design' } }, expected: 'wait: install design: install design' },
  { name: 'decisions', action: { kind: 'human_gate', gate: { kind: 'decisions', questions: [{ id: 'format', title: 'Format', body: 'Choose a format', recommendation: 'CSV', dependsOn: [] }] } }, expected: 'wait: answer decisions: format' },
  { name: 'understanding', action: { kind: 'human_gate', gate: { kind: 'shared_understanding' } }, expected: 'wait: confirm shared understanding' },
  { name: 'test seams', action: { kind: 'human_gate', gate: { kind: 'seam_confirmation', seams: ['export', 'download'] } }, expected: 'wait: confirm test seams: export, download' },
  { name: 'authorization', action: { kind: 'human_gate', gate: { kind: 'authorization', action: 'deploy', scope: 'production' } }, expected: 'wait: authorize deploy for production' },
  { name: 'phase advance', action: { kind: 'advance', to: 'VERIFY' }, expected: 'advance to VERIFY' },
  { name: 'skill invocation', action: { kind: 'invoke_skill', skill: 'review' }, expected: 'invoke skill review' },
  { name: 'workspace and fallback', action: { kind: 'start_nodes', ids: ['export', 'download'], workspaces: ['/work/export'] }, expected: 'start nodes export in /work/export, download in .' },
  { name: 'no nodes', action: { kind: 'start_nodes', ids: [], workspaces: [] }, expected: 'start nodes ' },
  { name: 'executable verification', action: { kind: 'verify', route: { kind: 'drive_executable' }, criteria: ['CSV works', 'no omitted rows'] }, expected: 'verify via drive_executable: CSV works; no omitted rows' },
  { name: 'inconclusive verification', action: { kind: 'verify', route: { kind: 'inconclusive', missing: 'browser driver' }, criteria: [] }, expected: 'verify via inconclusive (browser driver): ' },
  { name: 'freeze', action: { kind: 'freeze_revision' }, expected: 'freeze revision' },
  { name: 'independent review', action: { kind: 'review', assurance: { kind: 'independent' }, guidelinesRequired: false, dimensions: ['security'] }, expected: 'review (independent): security' },
  {
    name: 'reduced review',
    action: { kind: 'review', assurance: { kind: 'reduced', reason: 'no independent agent' }, guidelinesRequired: true, dimensions: ['UX', 'security'] },
    expected: 'review (reduced assurance: no independent agent, fetch web-design-guidelines): UX, security',
  },
  { name: 'work', action: { kind: 'work', phase: 'IMPLEMENT', task: 'build CSV export' }, expected: 'IMPLEMENT: build CSV export' },
  { name: 'ready revision', action: { kind: 'done', revision: 'r2' }, expected: 'PR ready at r2' },
];

test.for(cases)('status describes $name', ({ action, expected }) => {
  expect(describeAction(action)).toBe(expected);
});

test('blocked status lists frozen revision, findings, risks, work, and stale evidence', () => {
  const initial = freshRun();
  const state: RunState = {
    ...initial,
    run: { ...initial.run, phase: 'CLARIFY', status: { kind: 'blocked', gate: { kind: 'shared_understanding' } }, frozenRevision: 'r1', blockers: [], risks: ['encoding mismatch'] },
    graph: {
      schemaVersion: 1,
      nodes: [
        { ...node('export'), status: 'pending' },
        { ...node('download'), status: 'running' },
      ],
    },
    findings: [{ id: 'encoding', severity: 'high', trigger: 'non-ASCII input', consequence: 'corrupt CSV', evidence: 'capture.json', revision: 'r1', owner: 'export', status: 'open', reviewer: 'reviewer', guidelines: null }],
    evidence: [
      {
        id: 'old-export',
        claim: 'CSV works',
        criterion: 'CSV works',
        state: 'STALE',
        revision: 'r0',
        dependencies: [],
        method: 'cli',
        expected: 'CSV',
        observed: 'CSV',
        artifact: 'capture.json',
        recordedAt: '2026-10-07T00:00:00Z',
        supersedes: null,
      },
    ],
  };
  expect(renderStatus(state)).toBe(
    'objective: export invoices as CSV\nphase: CLARIFY (blocked)\nrevision: r1 frozen r1\nblockers: none\nopen findings: encoding high\nrisks: encoding mismatch\nready nodes: export\nrunning nodes: download\nstale evidence: 1\nnext automatic action: none\nnext human gate: confirm shared understanding\n',
  );
});

test('fresh status exposes the completion blockers and advances to preflight', () => {
  expect(renderStatus(freshRun())).toBe(
    'objective: export invoices as CSV\nphase: START (active)\nrevision: r1\nblockers: revision not frozen; criterion "csv export lists every invoice" lacks MEASURED cli evidence at r1; no review at r1; graph has no nodes\nopen findings: none\nrisks: none\nready nodes: none\nrunning nodes: none\nstale evidence: 0\nnext automatic action: advance to PREFLIGHT\nnext human gate: none\n',
  );
});
