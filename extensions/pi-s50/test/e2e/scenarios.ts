import type { SkillResult } from '../../src/adapters/skills.ts';
import type { Command, EvidenceInput, GraphNodeInput } from '../../src/orchestrator/coordinator.ts';
import { node } from '../unit/support.ts';

export const FEATURE_CRITERIA = ['csv lists every invoice', 'readme documents export'] as const;

export const BUG_CRITERIA = ['empty line no longer crashes'] as const;

export const FEATURE_NODES: readonly GraphNodeInput[] = [
  node('list-invoices', { objective: 'list invoices from the CLI', writeSet: ['src/list/**'] }),
  node('export-csv', { objective: 'export listed invoices as CSV', dependencies: ['list-invoices'], writeSet: ['src/export/**', 'docs/**'] }),
];

export const BUG_NODES: readonly GraphNodeInput[] = [node('fix-parser', { objective: 'parse empty lines without crashing', writeSet: ['src/parser/**'] })];

export const SEAM = { id: 'seam-cli', description: 'invoices CLI stdout', catches: 'format regressions', misses: 'disk errors' };

export function evidence(criterion: string, claim: string, dependencies: readonly string[], method: EvidenceInput['method'] = 'cli'): EvidenceInput {
  return { claim, criterion, state: 'MEASURED', dependencies, method, expected: 'exit 0 with expected output', observed: 'exit 0 with expected output', artifact: `artifacts/${claim}.log` };
}

export const FEATURE_EVIDENCE: readonly EvidenceInput[] = [evidence('csv lists every invoice', 'csv-output', ['src/export/**', 'src/list/**']), evidence('readme documents export', 'readme-export', ['docs/**'], 'review')];

export const BUG_EVIDENCE: readonly EvidenceInput[] = [evidence('empty line no longer crashes', 'reproducer-green', ['src/parser/**'], 'test'), evidence('empty line no longer crashes', 'consumer-cli-empty-line', ['src/parser/**'])];

export const REVIEW_FINDING: Extract<Command, { kind: 'record_finding' }>['finding'] = {
  severity: 'medium',
  trigger: 'invoice with comma in name',
  consequence: 'CSV column shift',
  evidence: 'artifacts/comma.csv',
  owner: 'IMPLEMENT',
  reviewer: 'review-agent',
  guidelines: null,
};

export const FEATURE_SCRIPT: Readonly<Record<string, readonly SkillResult[]>> = {
  grilling: [
    {
      skill: 'grilling',
      summary: 'one decision, understanding confirmed',
      commands: [{ kind: 'answer_decisions', decisions: [{ id: 'q-format', question: 'CSV or TSV?', answer: 'CSV', decidedBy: 'user' }] }, { kind: 'confirm_understanding' }],
    },
  ],
  'domain-modeling': [{ skill: 'domain-modeling', summary: 'invoice terms', commands: [{ kind: 'record_domain', terms: ['invoice'], invariants: ['every invoice exported once'], scenarios: ['export all'] }] }],
  'codebase-design': [
    {
      skill: 'codebase-design',
      summary: 'two candidates',
      commands: [
        {
          kind: 'propose_designs',
          candidates: [
            { id: 'stream', summary: 'stream rows', tradeoffs: 'more code' },
            { id: 'buffer', summary: 'buffer rows', tradeoffs: 'memory' },
          ],
        },
        { kind: 'choose_design', id: 'stream', reason: 'bounded memory', interfaces: ['exportCsv(stream)'], seams: ['seam-cli'], ownership: ['src/export'] },
      ],
    },
  ],
  tdd: [{ skill: 'tdd', summary: 'one CLI seam', commands: [{ kind: 'propose_seams', seams: [SEAM] }] }],
};
