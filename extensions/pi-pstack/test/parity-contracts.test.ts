import { expect, test } from 'vitest';
import { auditClause, auditSlice, contentLines, reusedQuotes } from '../scripts/parity-contracts.mjs';

const range = { id: 's1', from: 1, to: 10 };
const quote = { type: 'quote', path: 'src/workers.ts', quote: 'registerWorkers(pi: ExtensionAPI)' };
const clause = { id: 'L2.1', lines: [2, 2], requirement: 'Run the worker.', kind: 'behavior', verdict: 'verified', checks: [quote] };

test('content lines skip blanks, headings, table rules, and fence markers but keep fenced text', () => {
  expect(contentLines('# Title\n\nBody\n|---|---|\n```\n# not a heading\n```\n| a | b |')).toEqual([3, 6, 8]);
});

test('a verified behavior clause with a native check has no findings', () => {
  expect(auditClause(clause, range)).toEqual([]);
  expect(auditClause({ ...clause, checks: [] }, range)).toEqual(['L2.1 needs a native quote or test check.']);
});

test.for([
  [{ checks: [] }, 'L2.1 needs a native quote or test check.'],
  [{ runtime: true }, 'L2.1 is runtime behavior without a test check.'],
  [{ kind: 'fact' }, 'L2.1 needs a source or commit check.'],
  [{ verdict: 'gap' }, 'L2.1 is gap without a note.'],
  [{ lines: [2, 11] }, 'L2.1 has a span outside its slice.'],
  [{ checks: [{ ...quote, quote: 'short' }] }, 'L2.1 check quotes fewer than 15 characters.'],
  [{ id: 'L2-clause-1' }, 'L2-clause-1 has an invalid identity.'],
] as const)('clause %j reports %s', ([change, finding]) => {
  expect(auditClause({ ...clause, ...change }, range)).toEqual([finding]);
});

test('a defect needs source evidence, native handling, and a note', () => {
  expect(auditClause({ ...clause, kind: 'defect' }, range)).toEqual(['L2.1 needs a source or commit check.', 'L2.1 needs a note.']);
});

test('a slice reports duplicate clauses and uncovered reference lines', () => {
  expect(auditSlice(range, [clause, clause], [2, 3, 12])).toEqual(['Duplicate clause L2.1.', 's1 leaves 1 reference lines without a clause: 3.']);
});

test('one quote backing more clauses than the limit is generic evidence', () => {
  const clauses = [1, 2, 3].map((n) => ({ ...clause, id: `L${n}.1` }));
  expect(reusedQuotes(clauses, 2)).toEqual(['src/workers.ts quote "registerWorkers(pi: ExtensionAPI)" backs 3 clauses; cite clause-specific evidence.']);
  expect(reusedQuotes(clauses, 3)).toEqual([]);
});

test('file checks count as native evidence and source-file checks as provenance', () => {
  expect(auditClause({ ...clause, checks: [{ type: 'file', path: 'skills/poteto-mode/SKILL.md' }] }, range)).toEqual([]);
  expect(auditClause({ ...clause, kind: 'fact', checks: [{ type: 'file', path: 'skills/poteto-mode/SKILL.md' }] }, range)).toEqual(['L2.1 needs a source or commit check.']);
  expect(auditClause({ ...clause, kind: 'fact', checks: [{ type: 'source-file', path: 'upstream/assets/logo.png' }] }, range)).toEqual([]);
});
