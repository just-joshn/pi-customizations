import { realpath } from 'node:fs/promises';

import { expect, test } from 'vitest';
import { inspectManagedArtifactFromPath } from '../src/analysis/managed-artifact.ts';
import type { ReaError } from '../src/contract/errors.ts';
import { managedPeFixture } from './support/managed-pe.ts';
import { tempTargets } from './support/temp-targets.ts';

const payloadOf = async (run: () => Promise<unknown>): Promise<ReaError['payload']> => {
  try {
    await run();
  } catch (error) {
    return (error as ReaError).payload;
  }
  throw new Error('the analyzer returned instead of throwing');
};

const withFixture = async (bytes: Buffer): Promise<string> => {
  const targets = await tempTargets();
  return targets.write('Fixture.exe', bytes);
};

test('resolves the module MVID from the #GUID heap in REA GUID order', async () => {
  const mvid = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10]);
  const path = await withFixture(managedPeFixture({ mvid }));

  const { record } = await inspectManagedArtifactFromPath(path);

  expect(record.module).toStrictEqual({ name: 'Fixture.dll', mvid: '04030201-0605-0807-090a-0b0c0d0e0f10' });
});

test('reports a zero GUID when the module row points at the zero heap entry', async () => {
  const path = await withFixture(managedPeFixture({ mvid: Buffer.alloc(16) }));

  const { record } = await inspectManagedArtifactFromPath(path);

  expect(record.module?.mvid).toBe('00000000-0000-0000-0000-000000000000');
});

test('marks coverage partial when the table stream is absent', async () => {
  const path = await withFixture(managedPeFixture({ includeTables: false }));

  const { record } = await inspectManagedArtifactFromPath(path);

  expect(record.coverage.state).toBe('partial');
  expect(record.coverage.issues).toStrictEqual(['metadata stream is incomplete']);
  expect(record.metadata.status).toBe('partial');
});

test('marks coverage partial when the table row-count region is truncated', async () => {
  const path = await withFixture(managedPeFixture({ truncateTablesAt: 26 }));

  const { record } = await inspectManagedArtifactFromPath(path);

  expect(record.coverage.state).toBe('partial');
  expect(record.coverage.issues).toStrictEqual(['table row-count region truncated']);
});

test('refuses a PE machine that REA does not admit for managed inspection', async () => {
  const path = await withFixture(managedPeFixture({ machine: 0x1234 }));
  const canonical = await realpath(path);

  const payload = await payloadOf(() => inspectManagedArtifactFromPath(path));

  expect(payload).toStrictEqual({
    code: 'target_unavailable',
    category: 'unsupported_target',
    message: 'Cannot open artifact: unsupported PE architecture (COFF machine 0x1234).',
    retryable: false,
    remediation: { action: 'Review the reported file-format reason and select a supported, well-formed target.' },
    details: {
      path: canonical,
      reason: 'unsupported PE architecture (COFF machine 0x1234)',
      constraint: 'file_format_rejected',
    },
  });
});
