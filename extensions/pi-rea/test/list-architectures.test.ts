import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { listArchitectures } from '../src/tools/arch-tools.ts';
import { closeBinary, openBinary } from '../src/tools/session-tools.ts';
import { fixturePath, readFixture } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };
const CPU_ARM64 = 0x0100000c;
const CPU_X86_64 = 0x01000007;

const thin = (cpuType: number, cpuSubtype: number): Buffer => {
  const header = Buffer.alloc(48);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cpuType, 4);
  header.writeUInt32LE(cpuSubtype, 8);
  header.writeUInt32LE(2, 12);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(0, 20);
  header.writeUInt32LE(0, 24);
  return header;
};

const universal = (): Buffer => {
  const slices = [thin(CPU_X86_64, 3), thin(CPU_ARM64, 0x80000000 + 2)];
  const header = Buffer.alloc(8 + slices.length * 20);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(slices.length, 4);
  let offset = header.length;
  slices.forEach((slice, index) => {
    const at = 8 + index * 20;
    header.writeUInt32BE(index === 0 ? CPU_X86_64 : CPU_ARM64, at);
    header.writeUInt32BE(index === 0 ? 3 : (0x80000000 + 2) >>> 0, at + 4);
    header.writeUInt32BE(offset, at + 8);
    header.writeUInt32BE(slice.length, at + 12);
    header.writeUInt32BE(14, at + 16);
    offset += slice.length;
  });
  return Buffer.concat([header, ...slices]);
};

const write = async (name: string, bytes: Buffer): Promise<{ path: string; cleanup: () => Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-arch-'));
  const path = join(dir, name);
  await writeFile(path, bytes);
  return { path, cleanup: async () => rm(dir, { recursive: true, force: true }) };
};

const payloadOf = (result: { structuredContent?: unknown }): Record<string, unknown> => (result.structuredContent as { result: Record<string, unknown> }).result;

test('TOOL-061: a universal target reports every slice and its file range', async ({ onTestFinished }) => {
  const { path, cleanup } = await write('universal.bin', universal());
  onTestFinished(cleanup);
  const session = new ReaSession(runtime);
  await openBinary(session, { path });
  const record = (await listArchitectures(session, {})).structuredContent as Record<string, unknown>;
  const normalized = record['normalized_result'] as Record<string, unknown>;
  const reference = readFixture<{ response: { result: { structuredContent: { normalized_result: Record<string, unknown> } } } }>('captures/pass14/list_architectures--fat-ls.json').response.result.structuredContent.normalized_result;

  expect(record['operation']).toBe('list_architectures');
  expect(record['parameters']).toStrictEqual({
    input_path: (record['subject'] as { local_path: string }).local_path,
  });
  expect(record['limitations']).toStrictEqual([]);
  expect(record['subject']).toMatchObject({ format: 'mach-o-universal' });
  expect(Object.keys(normalized).toSorted()).toStrictEqual(Object.keys(reference).toSorted());
  expect(normalized['architectures']).toStrictEqual({
    items: [
      { name: 'x86_64', hidden: false, cpu_type: 'CPU_TYPE_X86_64', cpu_subtype: 'CPU_SUBTYPE_X86_ALL', file_offset: 48, size: 48, alignment: 16384 },
      { name: 'arm64e', hidden: false, cpu_type: 'CPU_TYPE_ARM64', cpu_subtype: 'CPU_SUBTYPE_ARM64E', file_offset: 96, size: 48, alignment: 16384 },
    ],
    total: 2,
    exhaustive: true,
    limitations: [],
  });
  expect(normalized['limitations']).toStrictEqual([]);
  expect(record['locations']).toStrictEqual([
    { kind: 'file-offset-range', start: 48, end: 96 },
    { kind: 'file-offset-range', start: 96, end: 144 },
  ]);
});

test('TOOL-061: a thin target reports one architecture with no slice facts', async ({ onTestFinished }) => {
  const { path, cleanup } = await write('thin.bin', thin(CPU_ARM64, 0));
  onTestFinished(cleanup);
  const session = new ReaSession(runtime);
  await openBinary(session, { path });
  const record = (await listArchitectures(session, {})).structuredContent as Record<string, unknown>;
  const reference = readFixture<{ response: { result: { structuredContent: { normalized_result: Record<string, unknown> } } } }>('captures/pass14/list_architectures--thin-go.json').response.result.structuredContent.normalized_result;
  const architectures = reference['architectures'] as {
    items: Record<string, unknown>[];
    total: number;
    exhaustive: boolean;
    limitations: unknown[];
  };
  expect(record['parameters']).toStrictEqual({
    input_path: (record['subject'] as { local_path: string }).local_path,
  });
  expect(record['normalized_result']).toStrictEqual({
    architectures: {
      ...architectures,
      items: architectures.items.map((item) => ({ ...item, hidden: false })),
    },
    provenance: (record['normalized_result'] as { provenance: unknown[] }).provenance,
    limitations: [],
  });
});

test('TOOL-061: a target that is not Mach-O reports capability_unavailable', async () => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/minimal-elf.bin') });
  let thrown: unknown;
  try {
    await listArchitectures(session, {});
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('capability_unavailable');
  expect(payload.category).toBe('unsupported_provider');
  expect(payload.retryable).toBe(false);
  expect(payload.details?.['operation']).toBe('list_architectures');
  expect(String(payload.details?.['reason'])).toContain('Mach-O');
  expect(session.evidence.size).toBe(0);
});

test('TOOL-061: no open target reports target_unavailable and records nothing', async () => {
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    await listArchitectures(session, {});
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('target_unavailable');
  expect(payload.category).toBe('unavailable');
  expect(payload.retryable).toBe(false);
  expect(payload.details).toBeUndefined();
  expect(session.evidence.size).toBe(0);
});

test('TOOL-061: the inventory is retained as Evidence and cleared with the session', async ({ onTestFinished }) => {
  const { path, cleanup } = await write('retain.bin', thin(CPU_X86_64, 3));
  onTestFinished(cleanup);
  const session = new ReaSession(runtime);
  await openBinary(session, { path });
  const record = (await listArchitectures(session, {})).structuredContent as Record<string, unknown>;
  expect(session.evidence.size).toBe(1);
  expect(session.evidence.get(record['evidence_id'] as string)?.operation).toBe('list_architectures');
  expect(session.evidence.summary({ operation: 'list_architectures' }).entries).toHaveLength(1);
  expect(closeBinary(session, {}).structuredContent).toStrictEqual({ result: null });
  expect(session.evidence.size).toBe(0);
});

test('TOOL-061: the open_binary availability report reflects the target format', async ({ onTestFinished }) => {
  const { path, cleanup } = await write('report.bin', thin(CPU_ARM64, 0));
  onTestFinished(cleanup);
  const session = new ReaSession(runtime);
  await openBinary(session, { path });
  const report = payloadOf((await import('../src/tools/session-tools.ts')).binarySession(session, {}));
  const availability = (report['tool_availability'] as { groups: { names: string[]; available: boolean }[] }).groups.find((group) => group.names.includes('list_architectures'));
  expect(availability?.available).toBe(true);
});
