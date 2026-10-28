import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectPeResources } from '../src/tools/pe-tools.ts';
import { fixturePath, readFixture } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };
const FIXTURE = fixturePath('targets/pe/fixture-pe-resources.exe');
const PLAIN_PE = fixturePath('targets/pe/fixture-go-pe.exe');

const recordOf = async (path: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
  const session = new ReaSession(runtime);
  const result = await inspectPeResources(session, { path, ...params } as never);
  return result.structuredContent as Record<string, unknown>;
};

const normalizedOf = async (path: string): Promise<Record<string, unknown>> => (await recordOf(path))['normalized_result'] as Record<string, unknown>;

test('TOOL-087: the reference fixture yields the captured resource inventory', async () => {
  const reference = readFixture<{ response: { result: { structuredContent: { normalized_result: Record<string, unknown> } } } }>('captures/pass12/inspect_pe_resources--resources.json').response.result.structuredContent.normalized_result;
  const normalized = await normalizedOf(FIXTURE);
  expect(normalized['format']).toBe(reference['format']);
  expect(normalized['machine']).toBe(reference['machine']);
  expect(normalized['directory']).toStrictEqual(reference['directory']);
  expect(normalized['coverage']).toStrictEqual(reference['coverage']);
  expect(normalized['resources']).toStrictEqual(reference['resources']);
  expect(normalized['icon_groups']).toStrictEqual(reference['icon_groups']);
  const directories = normalized['directories'] as Record<string, unknown>[];
  expect(
    directories.map(({ path: _path, entry_locations: _entries, ...rest }) => rest),
  ).toStrictEqual(reference['directories']);
  expect(directories[0]).toMatchObject({ path: [], entry_locations: [] });
  expect(directories[1]).toMatchObject({
    path: [{ kind: 'id', id: 24 }],
    entry_locations: [{ offset: expect.any(Number), bytes: 8 }],
  });
});

test('TOOL-087: the recorded artifact identity and limits are reported', async () => {
  const record = await recordOf(FIXTURE);
  const bytes = await readFile(FIXTURE);
  expect(record['operation']).toBe('inspect_pe_resources');
  expect(record['confidence']).toBe('observed');
  expect(record['authority']).toBe('shipped-artifact');
  expect(record['parameters']).toStrictEqual({ path: FIXTURE, max_file_bytes: 67_108_864, max_entries: 4096 });
  expect(record['locations']).toStrictEqual([{ kind: 'artifact-path', path: FIXTURE }]);
  expect(record['subject']).toMatchObject({ name: 'fixture-pe-resources.exe', format: 'pe', architecture: 'x86_64' });
  const normalized = record['normalized_result'] as Record<string, unknown>;
  expect(normalized['artifact']).toStrictEqual({ path: FIXTURE, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: bytes.length });
});

test('TOOL-087: an image without a resource directory reports an empty inventory', async () => {
  const reference = readFixture<{ response: { result: { structuredContent: { normalized_result: Record<string, unknown> } } } }>('captures/pass12/inspect_pe_resources--no-resources.json').response.result.structuredContent.normalized_result;
  const normalized = await normalizedOf(PLAIN_PE);
  expect(normalized['directory']).toBeNull();
  expect(normalized['directories']).toStrictEqual([]);
  expect(normalized['resources']).toStrictEqual([]);
  expect(normalized['icon_groups']).toStrictEqual([]);
  expect(normalized['coverage']).toStrictEqual({ status: 'complete', examined_entries: 0, resources: 0 });
  expect(normalized['format']).toBe(reference['format']);
  expect(normalized['machine']).toBe(reference['machine']);
});

test('TOOL-087: a file that is not a PE image reports the reference issue', async () => {
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    await inspectPeResources(session, { path: fixturePath('targets/minimal-elf.bin') });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('invalid_request');
  expect(payload.category).toBe('invalid_input');
  expect(payload.retryable).toBe(true);
  expect(payload.details?.['operation']).toBe('inspect_pe_resources');
  const issues = payload.details?.['issues'] as { path: string[]; reason: string; message: string }[];
  expect(issues[0]).toMatchObject({ path: ['path'], reason: 'invalid_format' });
  expect(String(issues[0]?.message)).toContain('minimal-elf.bin');
  expect(session.evidence.size).toBe(0);
});

test('TOOL-087: a missing file and an out-of-range limit are refused', async () => {
  const session = new ReaSession(runtime);
  let missing: unknown;
  try {
    await inspectPeResources(session, { path: fixturePath('targets/absent.exe') });
  } catch (error) {
    missing = error;
  }
  const issues = (missing as ReaError).payload.details?.['issues'] as { message: string }[];
  expect(String(issues[0]?.message)).toContain('no file exists there');
  let limit: unknown;
  try {
    await inspectPeResources(session, { path: FIXTURE, max_file_bytes: 8 });
  } catch (error) {
    limit = error;
  }
  const limitIssues = (limit as ReaError).payload.details?.['issues'] as { message: string }[];
  expect(String(limitIssues[0]?.message)).toContain('max_file_bytes');
  expect(session.evidence.size).toBe(0);
});

test('TOOL-087: the inventory is retained as Evidence and clears with the session', async () => {
  const session = new ReaSession(runtime);
  const record = (await inspectPeResources(session, { path: FIXTURE })).structuredContent as Record<string, unknown>;
  expect(session.evidence.size).toBe(1);
  expect(session.evidence.get(record['evidence_id'] as string)?.operation).toBe('inspect_pe_resources');
  expect(session.evidence.summary({ operation: 'inspect_pe_resources' }).entries).toHaveLength(1);
  session.closeTarget();
  expect(session.evidence.size).toBe(0);
});

test('TOOL-087: the inventory works without an open target', async () => {
  const session = new ReaSession(runtime);
  expect(session.open).toBe(false);
  const normalized = ((await inspectPeResources(session, { path: FIXTURE })).structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;
  expect(normalized['coverage']).toStrictEqual({ status: 'complete', examined_entries: 12, resources: 4 });
});

test('TOOL-087: relative paths resolve against the session working directory', async () => {
  const session = new ReaSession(runtime);
  const root = FIXTURE.slice(0, FIXTURE.indexOf('/parity/pi-rea/'));
  await expect(inspectPeResources(session, { path: 'parity/pi-rea/fixtures/targets/pe/fixture-pe-resources.exe' }, { cwd: root })).resolves.toBeDefined();
  expect(session.evidence.size).toBe(1);
});
