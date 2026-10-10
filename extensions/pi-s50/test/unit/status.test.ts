import { describe, expect, test } from 'vitest';
import type { Finding } from '../../src/domain/findings.ts';
import type { NextAction } from '../../src/orchestrator/command.ts';
import { describeAction, renderStatus } from '../../src/orchestrator/status.ts';
import { freshRun, graphNode, measured } from './support.ts';

describe('describeAction', () => {
  test.for([
    {
      action: { kind: 'human_gate', gate: { kind: 'user_workflow', skill: 'web-design-guidelines', action: '/skill:web-design-guidelines' } },
      text: 'wait: user must run /skill:web-design-guidelines',
    },
    {
      action: { kind: 'human_gate', gate: { kind: 'missing_skill', skill: 'tdd', install: 'npx skills add vercel-labs/tdd' } },
      text: 'wait: install tdd: npx skills add vercel-labs/tdd',
    },
    {
      action: {
        kind: 'human_gate',
        gate: {
          kind: 'decisions',
          questions: [
            { id: 'q1', title: 'A', body: 'a', recommendation: 'yes', dependsOn: [] },
            { id: 'q2', title: 'B', body: 'b', recommendation: 'no', dependsOn: [] },
          ],
        },
      },
      text: 'wait: answer decisions: q1, q2',
    },
    {
      action: { kind: 'human_gate', gate: { kind: 'shared_understanding' } },
      text: 'wait: confirm shared understanding',
    },
    {
      action: { kind: 'human_gate', gate: { kind: 'seam_confirmation', seams: ['seam-cli', 'seam-parser'] } },
      text: 'wait: confirm test seams: seam-cli, seam-parser',
    },
    {
      action: { kind: 'human_gate', gate: { kind: 'authorization', action: 'force_push', scope: 'git push --force' } },
      text: 'wait: authorize force_push for git push --force',
    },
    { action: { kind: 'advance', to: 'VERIFY' }, text: 'advance to VERIFY' },
    { action: { kind: 'invoke_skill', skill: 'tdd' }, text: 'invoke skill tdd' },
    {
      action: { kind: 'start_nodes', ids: ['a', 'b'], workspaces: ['.s50/worktrees/a'] },
      text: 'start nodes a in .s50/worktrees/a, b in .',
    },
    {
      action: { kind: 'verify', route: { kind: 'drive_executable' }, criteria: ['lists invoices', 'exit 0'] },
      text: 'verify via drive_executable: lists invoices; exit 0',
    },
    {
      action: { kind: 'verify', route: { kind: 'inconclusive', missing: 'browser driver' }, criteria: ['page loads'] },
      text: 'verify via inconclusive (browser driver): page loads',
    },
    { action: { kind: 'freeze_revision' }, text: 'freeze revision' },
    {
      action: {
        kind: 'review',
        dimensions: ['correctness', 'security'],
        assurance: { kind: 'independent' },
        guidelinesRequired: false,
      },
      text: 'review (independent): correctness, security',
    },
    {
      action: {
        kind: 'review',
        dimensions: ['visual'],
        assurance: { kind: 'reduced', reason: 'same-agent read-only review; no independent agents' },
        guidelinesRequired: true,
      },
      text: 'review (reduced assurance: same-agent read-only review; no independent agents, fetch web-design-guidelines): visual',
    },
    { action: { kind: 'work', phase: 'IMPLEMENT', task: 'build export CSV' }, text: 'IMPLEMENT: build export CSV' },
    { action: { kind: 'done', revision: 'abc123' }, text: 'PR ready at abc123' },
  ] as const satisfies readonly { readonly action: NextAction; readonly text: string }[])('$text', ({ action, text }) => {
    expect(describeAction(action)).toBe(text);
  });
});

describe('renderStatus', () => {
  test('formats empty findings, risks, and ready nodes as none', () => {
    const state = freshRun();
    expect(renderStatus(state)).toBe(
      [
        'objective: export invoices as CSV',
        'phase: START (active)',
        'revision: r1',
        'blockers: revision not frozen; criterion "csv export lists every invoice" lacks MEASURED cli evidence at r1; no review at r1; graph has no nodes',
        'open findings: none',
        'risks: none',
        'ready nodes: none',
        'running nodes: none',
        'stale evidence: 0',
        'next automatic action: advance to PREFLIGHT',
        'next human gate: none',
        '',
      ].join('\n'),
    );
  });

  test('lists populated fields, frozen revision, stale evidence, and a human gate', () => {
    const finding: Finding = {
      id: 'F1',
      severity: 'high',
      trigger: 'missing test',
      consequence: 'regressions',
      evidence: 'no coverage',
      revision: 'r1',
      owner: 'lead',
      status: 'open',
      reviewer: 'r',
      guidelines: null,
    };
    const base = freshRun();
    const state = {
      ...base,
      run: {
        ...base.run,
        phase: 'IMPLEMENT' as const,
        status: { kind: 'blocked' as const, gate: { kind: 'authorization' as const, action: 'deploy' as const, scope: 'prod' } },
        frozenRevision: 'r1',
        blockers: ['need deploy grant'],
        risks: ['shared DB'],
      },
      graph: {
        schemaVersion: 1 as const,
        nodes: [graphNode('export', 'pending'), graphNode('list', 'running'), graphNode('done', 'integrated')],
      },
      evidence: [measured('csv export lists every invoice', 'r1', { state: 'STALE' })],
      findings: [finding, { ...finding, id: 'F2', status: 'resolved' as const }],
    };
    expect(renderStatus(state)).toBe(
      [
        'objective: export invoices as CSV',
        'phase: IMPLEMENT (blocked)',
        'revision: r1 frozen r1',
        'blockers: need deploy grant',
        'open findings: F1 high',
        'risks: shared DB',
        'ready nodes: export',
        'running nodes: list',
        'stale evidence: 1',
        'next automatic action: none',
        'next human gate: authorize deploy for prod',
        '',
      ].join('\n'),
    );
  });
});
