import { expect, test } from 'vitest';
import { capture, docUnit, fixture, gate, json, put, row, runner, testUnit } from './fixture.ts';

test('accepts a current passing slice with a real behavior assertion', async () => {
  const { root } = await fixture();
  const result = gate(root, ['--feature', 'edit']);
  expect(result.code).toBe(0);
  expect(result.output).toContain('edit: slice 2 units, 2 covered, 0 uncovered, 1 rows, 1 verified');
  expect(result.output).toContain('PASS');
});

test.for([
  { name: 'missing', args: ['--fragment'] },
  { name: 'empty', args: ['--fragment', ''] },
])('rejects a $name fragment path', async ({ args }) => {
  const { root } = await fixture();
  const result = gate(root, args);
  expect(result.code).toBe(1);
  expect(result.output).toContain('FAIL --fragment must name a JSON file');
});

test.for([
  { name: 'omitted', args: [] },
  { name: 'empty', args: ['--units', ''] },
  { name: 'unknown', args: ['--units', 'missing'] },
  { name: 'partly unknown', args: ['--units', 'edit,missing'] },
])('rejects a $name fragment selection', async ({ args }) => {
  const { root, coverage } = await fixture();
  await json(root, 'fragment.json', args.at(-1) === 'edit,missing' ? { rows: [row], coverage: { [docUnit]: coverage[docUnit] } } : { rows: [], coverage: {} });
  const result = gate(root, ['--fragment', 'fragment.json', ...args]);
  expect(result.code).toBe(1);
  expect(result.output).toContain('FAIL --units');
});

test('accepts a nonempty fragment of the intended census', async () => {
  const { root, coverage } = await fixture();
  await json(root, 'fragment.json', { rows: [row], coverage: { [docUnit]: coverage[docUnit] } });
  const result = gate(root, ['--fragment', 'fragment.json', '--units', 'edit']);
  expect(result).toEqual({ code: 0, output: 'fragment: 1 units, 1 rows\nPASS\n' });
});

test.for([
  { name: 'missing report', fault: 'fs.unlinkSync(report);', diagnostic: 'no vitest JSON report' },
  { name: 'parse error', fault: "fs.writeFileSync(report, '{');", diagnostic: 'invalid vitest JSON report' },
  { name: 'failure status', fault: 'process.exit(7);', diagnostic: 'vitest exited with status 7' },
  { name: 'unsuccessful report', fault: 'const data = JSON.parse(fs.readFileSync(report)); fs.writeFileSync(report, JSON.stringify({ ...data, success: false }));', diagnostic: 'vitest report.success is not true' },
])('rejects a runner $name after passing referenced tests', async ({ fault, diagnostic }) => {
  const { root } = await fixture();
  const bin = await runner(root, fault);
  const result = gate(root, ['--feature', 'edit'], bin);
  expect(result.code).toBe(1);
  expect(result.output).toContain(diagnostic);
});

test('rejects unrelated failed assertions in the package', async () => {
  const { root } = await fixture();
  await put(root, 'test/unrelated.test.ts', "import { expect, test } from 'vitest'; test('preserves another contract', () => expect(3).toBe(4));\n");
  const result = gate(root, ['--feature', 'edit']);
  expect(result.code).toBe(1);
  expect(result.output).toContain('vitest failed test/unrelated.test.ts::preserves another contract');
});

test('rejects collection errors even if referenced assertions pass', async () => {
  const { root } = await fixture();
  await put(root, 'test/broken.test.ts', "throw new Error('collection failed');\n");
  const result = gate(root, ['--feature', 'edit']);
  expect(result.code).toBe(1);
  expect(result.output).toContain('vitest exited with status 1');
});

test('does not trust a stale report after integrated source changes', async () => {
  const { root } = await fixture();
  capture(root);
  const before = gate(root, ['--feature', 'edit', '--report', 'saved.json']);
  expect(before.code).toBe(0);
  await put(root, 'src/value.ts', 'export const editableValue = () => 99;\n');
  const after = gate(root, ['--feature', 'edit', '--report', 'saved.json']);
  expect(after.code).toBe(1);
  expect(after.output).toContain('returns the editable value is failed');
});

test('removing a shared owner fails even for a fragment', async () => {
  const { root, coverage } = await fixture();
  await json(root, 'fragment.json', { rows: [row], coverage: { [docUnit]: coverage[docUnit] } });
  const before = gate(root, ['--fragment', 'fragment.json', '--units', 'edit']);
  expect(before.code).toBe(0);
  await json(root, 'parity/test-owners.json', {});
  const after = gate(root, ['--fragment', 'fragment.json', '--units', 'edit']);
  expect(after.code).toBe(1);
  expect(after.output).toContain(`unit ${testUnit} has no owner`);
});

test.for(['git', 'map', 'lint'])('cannot move all edit claims to an open %s row', async (feature) => {
  const { root, coverage } = await fixture();
  const later = { ...row, id: `${feature}.fixture.integration`, feature, status: 'open', pi: [], src: [], tests: [] };
  await json(root, 'parity/ledger.json', { rows: [later] });
  await json(root, 'parity/coverage.json', { ...coverage, [docUnit]: { rows: [later.id] }, [testUnit]: { rows: [later.id] } });
  const result = gate(root, ['--feature', 'edit']);
  expect(result.code).toBe(1);
  expect(result.output).toContain(`unit ${docUnit}: no edit contract row`);
});

test('a failed assertion still fails with falsified success totals', async () => {
  const { root } = await fixture();
  await put(root, 'test/unrelated.test.ts', "import { expect, test } from 'vitest'; test('preserves another contract', () => expect(3).toBe(4));\n");
  const bin = await runner(
    root,
    "const data = JSON.parse(fs.readFileSync(report)); fs.writeFileSync(report, JSON.stringify({ ...data, success: true, numFailedTests: 0, numFailedTestSuites: 0, testResults: data.testResults.map(file => ({ ...file, status: 'passed' })) })); process.exit(0);",
  );
  const result = gate(root, ['--feature', 'edit'], bin);
  expect(result.code).toBe(1);
  expect(result.output).toContain('vitest failed test/unrelated.test.ts::preserves another contract');
});

test('cannot discharge all edit obligations with broad nonclaims', async () => {
  const { root, coverage } = await fixture();
  await json(root, 'parity/ledger.json', { rows: [] });
  await json(root, 'parity/coverage.json', { ...coverage, [docUnit]: { nonclaim: 'meta', note: 'Broad navigation exemption.' }, [testUnit]: { nonclaim: 'meta', note: 'Broad navigation exemption.' } });
  const result = gate(root, ['--feature', 'edit']);
  expect(result.code).toBe(1);
  expect(result.output).toContain('edit slice has no contract rows');
});

test('defers integration verification until the final gate', async () => {
  const { root, coverage } = await fixture();
  const later = { ...row, id: 'git.fixture.integration', feature: 'git', status: 'open', pi: [], src: [], tests: [] };
  await json(root, 'parity/ledger.json', { rows: [row, later] });
  await json(root, 'parity/coverage.json', { ...coverage, [docUnit]: { rows: [row.id, later.id] } });
  expect(gate(root, ['--feature', 'edit']).code).toBe(0);
  const final = gate(root, ['--final']);
  expect(final.code).toBe(1);
  expect(final.output).toContain('row git.fixture.integration is open, not verified');
});

test('a genuinely shared later-owned test waits for its owner', async () => {
  const { root, coverage } = await fixture();
  const later = { ...row, id: 'git.fixture.integration', feature: 'git', status: 'open', pi: [], src: [], tests: [] };
  await json(root, 'parity/test-owners.json', { [testUnit]: 'git' });
  await json(root, 'parity/ledger.json', { rows: [row, later] });
  await json(root, 'parity/coverage.json', { ...coverage, [testUnit]: { rows: [later.id] } });
  const edit = gate(root, ['--feature', 'edit']);
  expect(edit.code).toBe(0);
  expect(edit.output).toContain('edit: slice 1 units');
  const git = gate(root, ['--feature', 'git']);
  expect(git.code).toBe(1);
  expect(git.output).toContain('row git.fixture.integration is open, not verified');
});
