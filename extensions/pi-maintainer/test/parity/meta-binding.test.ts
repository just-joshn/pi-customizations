import { expect, test } from 'vitest';
import { gate, json, put, row, unboundFixture } from './fixture.ts';

const cases = [{ tag: 'aider' }, { tag: 'evidence' }] satisfies { tag: 'aider' | 'evidence' }[];
const portedPath = 'test/ported.test.ts';
const portedTitle = 'ports the editable value';
const portedSelector = `${portedPath}::${portedTitle}`;

async function portedTest(root: string, metadata: Record<string, string[]>) {
  await put(root, portedPath, `import { expect, test } from 'vitest'; import { editableValue } from '../src/value.ts'; test(${JSON.stringify(portedTitle)}, { meta: ${JSON.stringify(metadata)} }, () => expect(editableValue()).toBe(2));\n`);
}

test.for(cases)('rejects unreferenced passing meta.$tag', async ({ tag }) => {
  const { root, unit, metadata } = await unboundFixture(tag);
  await put(root, 'test/unrelated.test.ts', `import { expect, test } from 'vitest'; test('checks an unrelated value', { meta: ${JSON.stringify(metadata)} }, () => expect(3).toBe(3));\n`);
  const result = gate(root, ['--feature', 'edit']);
  expect(result.code).toBe(1);
  expect(result.output).toContain(`unit ${unit}: no passing referenced edit contract test`);
  expect(result.output).toContain(`meta.${tag}`);
});

test.for(cases)('accepts meta.$tag from another mapped local row', async ({ tag }) => {
  const { root, coverage, unit, metadata } = await unboundFixture(tag);
  const ported = { ...row, id: 'edit.fixture.ported', tests: [portedSelector] };
  await json(root, 'parity/ledger.json', { rows: [row, ported] });
  await json(root, 'parity/coverage.json', { ...coverage, [unit]: { rows: [row.id, ported.id] } });
  await portedTest(root, metadata);
  const result = gate(root, ['--feature', 'edit']);
  expect(result.code).toBe(0);
  expect(result.output).toContain('2 rows, 2 verified');
});

test.for(cases)('accepts referenced wildcard meta.$tag', async ({ tag }) => {
  const { root, metadata } = await unboundFixture(tag);
  await json(root, 'parity/ledger.json', { rows: [{ ...row, tests: [...row.tests, `${portedPath}::*`] }] });
  await portedTest(root, metadata);
  expect(gate(root, ['--feature', 'edit']).code).toBe(0);
});

test.for(cases)('cannot borrow meta.$tag from a mapped later row', async ({ tag }) => {
  const { root, coverage, unit, metadata } = await unboundFixture(tag);
  const later = { ...row, id: 'git.fixture.ported', feature: 'git', tests: [portedSelector] };
  await json(root, 'parity/ledger.json', { rows: [row, later] });
  await json(root, 'parity/coverage.json', { ...coverage, [unit]: { rows: [row.id, later.id] } });
  await portedTest(root, metadata);
  const edit = gate(root, ['--feature', 'edit']);
  expect(edit.code).toBe(1);
  expect(edit.output).toContain(`unit ${unit}: no passing referenced edit contract test`);
  const final = gate(root, ['--final']);
  expect(final.code).toBe(1);
  expect(final.output).toContain(`unit ${unit}: no passing referenced edit contract test`);
});

test('accepts bound metadata for a later-owned shared test', async () => {
  const { root, coverage, unit, metadata } = await unboundFixture('aider');
  const later = { ...row, id: 'git.fixture.ported', feature: 'git', tests: [portedSelector] };
  await json(root, 'parity/test-owners.json', { [unit]: 'git' });
  await json(root, 'parity/ledger.json', { rows: [row, later] });
  await json(root, 'parity/coverage.json', { ...coverage, [unit]: { rows: [later.id] } });
  await portedTest(root, metadata);
  expect(gate(root, ['--feature', 'edit']).code).toBe(0);
  expect(gate(root, ['--feature', 'git']).code).toBe(0);
  expect(gate(root, ['--final']).code).toBe(0);
});
