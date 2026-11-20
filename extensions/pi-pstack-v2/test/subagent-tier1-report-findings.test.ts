import { describe, expect, test } from 'vitest';
import { loadSubagent, textOf, useWorkspace } from './subagent-host.ts';

useWorkspace();
const TOOL = 'report_findings';
const MAX_FINDINGS = 32;
const MAX_SHORT = 60;

const FINDING = {
  file: 'src/a.ts',
  line: 12,
  summary: 'Unchecked input reaches the shell',
  short_summary: 'Shell injection',
  failure_scenario: 'A crafted name runs a command',
  category: 'security',
  verdict: 'CONFIRMED',
  outcome: 'fixed',
} as const;

const findings = (count: number) => Array.from({ length: count }, () => FINDING);
const report = (params: unknown) => loadSubagent().named(TOOL).call(params);

describe('the report_findings tool', () => {
  test('is registered next to the subagent tool', () => {
    expect(loadSubagent().toolNames()).toEqual(['subagent', TOOL]);
  });

  test('says so when there are no findings, and keeps the structured payload', async () => {
    const result = await report({ findings: [] });
    expect(textOf(result)).toBe('No findings reported.');
    expect(result.details).toEqual({ findings: [] });
  });

  test('counts findings and keeps every field in details', async () => {
    const result = await report({ level: 'high', findings: [FINDING, { file: 'b.ts', summary: 's', failure_scenario: 'f', verdict: 'PLAUSIBLE', outcome: 'skipped' }] });
    expect(textOf(result)).toBe('2 finding(s) reported.');
    expect(result.details).toEqual({ level: 'high', findings: [FINDING, { file: 'b.ts', summary: 's', failure_scenario: 'f', verdict: 'PLAUSIBLE', outcome: 'skipped' }] });
  });

  test('accepts the most findings allowed', async () => {
    expect(textOf(await report({ findings: findings(MAX_FINDINGS) }))).toBe('32 finding(s) reported.');
  });
});

describe('what report_findings refuses', () => {
  test.for([
    ['more than 32 findings', { findings: findings(MAX_FINDINGS + 1) }],
    ['a short_summary over 60 characters', { findings: [{ ...FINDING, short_summary: 'x'.repeat(MAX_SHORT + 1) }] }],
    ['an unknown verdict', { findings: [{ ...FINDING, verdict: 'MAYBE' }] }],
    ['an unknown outcome', { findings: [{ ...FINDING, outcome: 'ignored' }] }],
    ['an unknown level', { level: 'extreme', findings: [] }],
    ['an empty summary', { findings: [{ ...FINDING, summary: '' }] }],
    ['a zero line', { findings: [{ ...FINDING, line: 0 }] }],
  ] as const)('rejects %s', async ([, params]) => {
    await expect(report(params)).rejects.toThrow();
  });
});

describe('how report_findings draws', () => {
  const tool = () => loadSubagent().named(TOOL);
  const sample = { level: 'high', findings: [FINDING, { file: 'b.ts', summary: 'Long summary only', failure_scenario: 'Boom', verdict: 'PLAUSIBLE' }] };

  test('the call shows the count and level', () => {
    expect(tool().renderCall(sample)).toBe('report_findings 2 finding(s) [high]');
  });

  test('the collapsed result lists each finding with verdict, place and short summary', async () => {
    const result = await report(sample);
    expect(tool().renderResult(result)).toBe(['report_findings 2 finding(s) [high]', '  [CONFIRMED] src/a.ts:12 Shell injection', '  [PLAUSIBLE] b.ts Long summary only'].join('\n'));
  });

  test('the expanded result adds each failure scenario', async () => {
    const drawn = tool().renderResult(await report(sample), true);
    expect(drawn).toContain('[CONFIRMED] src/a.ts:12 Shell injection');
    expect(drawn).toContain('Failure: A crafted name runs a command');
    expect(drawn).toContain('Failure: Boom');
  });

  test('an empty result says there are none', async () => {
    expect(tool().renderResult(await report({ findings: [] }))).toBe('No findings reported.');
  });
});
