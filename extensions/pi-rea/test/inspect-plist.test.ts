import { expect, test } from 'vitest';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectPlist } from '../src/tools/plist-tools.ts';
import { binarySession, closeBinary, openBinary } from '../src/tools/session-tools.ts';
import { fixturePath } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };
const ELF = fixturePath('targets/minimal-elf.bin');
const plist = (name: string): string => fixturePath(`targets/plist/${name}`);

const recordOf = (result: { structuredContent?: unknown }): Record<string, unknown> => result.structuredContent as Record<string, unknown>;

const sessionWithTarget = async (): Promise<ReaSession> => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: ELF });
  return session;
};

const normalizedOf = (result: { structuredContent?: unknown }): Record<string, unknown> => recordOf(result)['normalized_result'] as Record<string, unknown>;

test('TOOL-060: an XML plist yields the reference value, format and bundle projection', async () => {
  const session = await sessionWithTarget();
  const record = recordOf(await inspectPlist(session, { path: plist('sample-plain.plist') }));
  const normalized = record['normalized_result'] as Record<string, unknown>;
  expect(record['operation']).toBe('inspect_plist');
  expect(record['predicate_type']).toBe('rea.analysis');
  expect(record['confidence']).toBe('observed');
  expect(record['authority']).toBe('shipped-artifact');
  expect(normalized['format']).toBe('xml');
  expect(normalized['value']).toStrictEqual({
    CFBundleName: 'Plain Fixture',
    CFBundleVersion: '9',
    Count: -12,
    Flag: true,
    Items: ['one', 2],
    Ratio: 0.5,
  });
  expect(normalized['bundle']).toStrictEqual({
    identifier: null,
    executable: null,
    name: 'Plain Fixture',
    version: '9',
    short_version: null,
  });
  expect(normalized['source_path']).toBe(plist('sample-plain.plist'));
  expect(normalized['limitations']).toStrictEqual([]);
  expect(record['limitations']).toStrictEqual([]);
});

test('TOOL-060: a binary plist decodes to the same value with format binary', async () => {
  const session = await sessionWithTarget();
  const first = normalizedOf(await inspectPlist(session, { path: plist('sample-plain.plist') }));
  const second = normalizedOf(await inspectPlist(session, { path: plist('sample-plain-binary.plist') }));
  expect(second['format']).toBe('binary');
  expect(second['value']).toStrictEqual(first['value']);
});

test('TOOL-060: data and date values carry the reference typed projection', async () => {
  const session = await sessionWithTarget();
  const normalized = normalizedOf(await inspectPlist(session, { path: plist('sample-typed.plist') }));
  expect(normalized['value']).toStrictEqual({
    Blob: { $plist_type: 'data', base64: 'AQIDBA==' },
    When: { $plist_type: 'date', iso8601: '2026-01-02T03:04:05.000Z' },
  });
  expect(normalized['limitations']).toStrictEqual([]);
});

test('TOOL-060: nested dicts, arrays and data from the reference fixture match exactly', async () => {
  const session = await sessionWithTarget();
  const normalized = normalizedOf(await inspectPlist(session, { path: plist('sample-xml.plist') }));
  expect(normalized['value']).toStrictEqual({
    CFBundleIdentifier: 'com.example.fixture',
    CFBundleName: 'Parity Fixture',
    CFBundleShortVersionString: '1.2.3',
    CFBundleVersion: '456',
    LSMinimumSystemVersion: '14.0',
    List: ['alpha', 'beta', { $plist_type: 'data', base64: 'aGVsbG8=' }, 2.5],
    Nested: { count: 7, flag: true },
    Nothing: false,
  });
  expect(normalized['bundle']).toStrictEqual({
    identifier: 'com.example.fixture',
    executable: null,
    name: 'Parity Fixture',
    version: '456',
    short_version: '1.2.3',
  });
});

test('TOOL-060: the record binds the observation to the inspected plist', async () => {
  const session = await sessionWithTarget();
  const record = recordOf(await inspectPlist(session, { path: plist('sample-plain.plist') }));
  const path = plist('sample-plain.plist');
  expect(record['subject']).toMatchObject({ name: 'sample-plain.plist', format: 'plist', architecture: null, local_path: path });
  expect(record['parameters']).toStrictEqual({ input_path: path });
  expect(record['locations']).toStrictEqual([{ kind: 'artifact-path', path }]);
});

test('TOOL-060: the analysis is retained as Evidence and appears in the session', async () => {
  const session = await sessionWithTarget();
  const record = recordOf(await inspectPlist(session, { path: plist('sample-plain.plist') }));
  expect(session.evidence.size).toBe(1);
  const retained = session.evidence.get(record['evidence_id'] as string);
  expect(retained?.operation).toBe('inspect_plist');
  const summary = (binarySession(session, {}).structuredContent as { result: { tool_availability: { groups: { names: string[]; available: boolean }[] } } }).result.tool_availability.groups.find((group) =>
    group.names.includes('inspect_plist'),
  );
  expect(summary?.available).toBe(true);
  expect(session.evidence.summary({ operation: 'inspect_plist' }).entries).toHaveLength(1);
  expect(closeBinary(session, {}).structuredContent).toStrictEqual({ result: null });
  expect(session.evidence.size).toBe(0);
});

test('TOOL-060: inspecting without an open target reports target_unavailable', async () => {
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    await inspectPlist(session, { path: plist('sample-plain.plist') });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('target_unavailable');
  expect(payload.category).toBe('unavailable');
  expect(payload.retryable).toBe(false);
  expect(session.evidence.size).toBe(0);
});

test('TOOL-060: an undecodable or missing plist reports invalid_request with its issue', async () => {
  const session = await sessionWithTarget();
  for (const [path, reason] of [
    [plist('not-a-plist.plist'), 'not a property list'],
    [plist('absent.plist'), 'no file exists there'],
  ] as const) {
    let thrown: unknown;
    try {
      await inspectPlist(session, { path });
    } catch (error) {
      thrown = error;
    }
    const payload = (thrown as ReaError).payload;
    expect(payload.code).toBe('invalid_request');
    expect(payload.category).toBe('invalid_input');
    expect(payload.retryable).toBe(true);
    const issues = payload.details?.['issues'] as { path: string[]; reason: string; message: string }[];
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toStrictEqual(['path']);
    expect(issues[0]?.reason).toBe('invalid_value');
    expect(issues[0]?.message).toContain(path);
    expect(issues[0]?.message).toContain(reason);
  }
  expect(session.evidence.size).toBe(0);
});

test('TOOL-060: provenance states that this port parsed the file in process', async () => {
  const session = await sessionWithTarget();
  const normalized = normalizedOf(await inspectPlist(session, { path: plist('sample-plain.plist') }));
  const provenance = normalized['provenance'] as Record<string, unknown>[];
  expect(provenance).toHaveLength(1);
  expect(provenance[0]).toMatchObject({
    tool: 'pi-rea/plist-parser',
    command: [],
    tool_version: '0.1.0',
    executable_sha256: null,
    exit: { code: 0, signal: null },
  });
  expect(String(provenance[0]?.['version_reason'])).toContain('in process');
});
