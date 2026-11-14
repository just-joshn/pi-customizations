import { describe, expect, test } from 'vitest';
import { g3Verdict, g4Verdict, g10Verdict } from '../lib/gates.ts';

const tally = (PASS: number, FAIL = 0, INCONCLUSIVE = 0) => ({ PASS, FAIL, INCONCLUSIVE });

describe('g4Verdict', () => {
  const comparable = ['accent', 'text'] as const;
  test('a role with an empty tally is not measured', () => {
    expect(g4Verdict({ comparableRoles: ['accent'], byRole: { accent: tally(0) } })).toBe('INCONCLUSIVE');
  });
  test('passes only when every comparable role has observations and all of them pass', () => {
    expect(g4Verdict({ comparableRoles: [...comparable], byRole: { accent: tally(2), text: tally(1) } })).toBe('PASS');
  });
  test('a comparable role with no observations blocks PASS', () => {
    expect(g4Verdict({ comparableRoles: [...comparable], byRole: { accent: tally(2) } })).toBe('INCONCLUSIVE');
  });
  test('any mismatch fails', () => {
    expect(g4Verdict({ comparableRoles: [...comparable], byRole: { accent: tally(2, 1), text: tally(1) } })).toBe('FAIL');
  });
  test('an inconclusive observation blocks PASS', () => {
    expect(g4Verdict({ comparableRoles: [...comparable], byRole: { accent: tally(2, 0, 1), text: tally(1) } })).toBe('INCONCLUSIVE');
  });
});

describe('g3Verdict', () => {
  const base: Parameters<typeof g3Verdict>[0] = { blockingRoles: 0, claudeOnly: [[], []], comparableRoles: ['accent'], byRole: { accent: tally(1) } };
  test('passes with no blockers, empty inventories, and every comparable role measured exactly', () => {
    expect(g3Verdict(base)).toBe('PASS');
  });
  test('a missing Claude-only inventory is not an empty one', () => {
    expect(g3Verdict({ ...base, claudeOnly: [[], undefined] })).toBe('INCONCLUSIVE');
  });
  test('a comparable role without an exact observation is uncovered', () => {
    expect(g3Verdict({ ...base, byRole: { accent: tally(0, 0, 2) } })).toBe('FAIL');
  });
  test('blocking roles or Claude-only surfaces fail', () => {
    expect(g3Verdict({ ...base, blockingRoles: 1 })).toBe('FAIL');
    expect(g3Verdict({ ...base, claudeOnly: [[{}], []] })).toBe('FAIL');
  });
});

describe('g10Verdict', () => {
  test('fails while any other gate is not PASS', () => {
    expect(g10Verdict({ others: ['PASS', 'FAIL'], generated: 'x', approved: 'x' })).toBe('FAIL');
  });
  test('without approved hashes the audit is inconclusive even if every gate passes', () => {
    expect(g10Verdict({ others: ['PASS', 'PASS'], generated: 'x', approved: undefined })).toBe('INCONCLUSIVE');
  });
  test('generated hashes must equal the approved ones', () => {
    expect(g10Verdict({ others: ['PASS'], generated: 'x', approved: 'y' })).toBe('FAIL');
    expect(g10Verdict({ others: ['PASS'], generated: 'x', approved: 'x' })).toBe('PASS');
  });
});
