import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { scratchDir } from './support/scratch.ts';

const script = new URL('../scripts/check-subagent-parity.mjs', import.meta.url).pathname;
const header = ['id', 'contract', 'spec_pointer', 'status', 'impl_pointer', 'test_pointer', 'gap', 'pi_native_approach'].join('\t');

function gate(rows: readonly string[][], extra: readonly string[] = []) {
  const root = scratchDir('pstack-subagent-parity-');
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'src/real.ts'), 'export {};\n');
  writeFileSync(join(root, 'test/real.test.ts'), "test('the real behavior', () => {});\n");
  const matrix = join(root, 'matrix.tsv');
  writeFileSync(matrix, `${[header, ...rows.map((row) => row.join('\t'))].join('\n')}\n`);
  const result = spawnSync(process.execPath, [script, '--matrix', matrix, '--root', root, ...extra], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const closedRow = ['T01', 'a contract', 'L1', 'done-tested', 'src/real.ts:1', 'test/real.test.ts::the real behavior', '-', '-'];

test('a closed row whose pointers resolve passes the gate', () => {
  expect(gate([closedRow])).toEqual({ code: 0, out: 'done-tested\t1\n', err: '' });
});

test('an open row fails the gate and is listed', () => {
  const result = gate([['T02', 'still to do', 'L2', 'open', '-', '-', '-', '-']]);
  expect(result).toEqual({ code: 1, out: 'open\t1\nopen\tT02\tstill to do\n', err: '' });
});

test('allow-open keeps pointer checks but tolerates open rows', () => {
  const result = gate([['T02', 'still to do', 'L2', 'open', '-', '-', '-', '-']], ['--allow-open']);
  expect(result.code).toBe(0);
});

test('a dangling impl pointer is reported', () => {
  const result = gate([['T03', 'c', 'L3', 'done-tested', 'src/missing.ts', 'test/real.test.ts', '-', '-']]);
  expect(result).toEqual({ code: 1, out: 'done-tested\t1\n', err: 'problem\tT03: impl pointer does not exist: src/missing.ts\n' });
});

test('a test title absent from the named file is reported', () => {
  const result = gate([['T04', 'c', 'L4', 'done-tested', 'src/real.ts', 'test/real.test.ts::a title nobody wrote', '-', '-']]);
  expect(result.err).toBe('problem\tT04: test title not found in test/real.test.ts: a title nobody wrote\n');
});

test('a done-tested row with no test pointer is reported', () => {
  const result = gate([['T05', 'c', 'L5', 'done-tested', 'src/real.ts', '-', '-', '-']]);
  expect(result.err).toBe('problem\tT05: closed row names no test pointer\n');
});

test('an unspecified row needs only a gap explanation', () => {
  expect(gate([['T09', 'c', 'L9', 'unspecified', '-', '-', 'the source leaves this open; the port chooses x', '-']])).toEqual({ code: 0, out: 'unspecified\t1\n', err: '' });
  expect(gate([['T10', 'c', 'L10', 'pi-na', '-', '-', 'impossible in pi because y', '-']]).out).toBe('pi-na\t1\n');
});

test('an unspecified row must explain itself in gap', () => {
  const result = gate([['T06', 'c', 'L6', 'unspecified', 'src/real.ts', 'test/real.test.ts', '-', '-']]);
  expect(result.err).toBe('problem\tT06: unspecified row must explain itself in gap\n');
});

test('a duplicate id and an unknown status are reported', () => {
  const result = gate([closedRow, closedRow, ['T07', 'c', 'L7', 'maybe', '-', '-', '-', '-']]);
  expect(result.err.trimEnd().split('\n')).toEqual(['problem\tT01: duplicate id', 'problem\tT07: unknown status maybe']);
});

test('a short row is reported with its line number', () => {
  const result = gate([['T08', 'only two cells']]);
  expect(result.err).toBe('problem\tline 2: expected 8 columns, found 2\n');
});

test('the committed matrix is well formed and every closed row resolves', () => {
  const result = spawnSync(process.execPath, [script, '--allow-open'], { encoding: 'utf8' });
  expect({ code: result.status, err: result.stderr }).toEqual({ code: 0, err: '' });
});
