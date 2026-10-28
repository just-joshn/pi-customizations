import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { catalogDigest } from '../src/contract/catalog.ts';
import { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { binarySession, closeBinary, openBinary } from '../src/tools/session-tools.ts';
import { recordUnknown } from '../src/tools/unknown-tools.ts';
import { fixturePath, referenceSessionReport } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };
const kernelManifestNames = (
  JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../schemas/kernel-manifest.json'), 'utf8')) as {
    kernelToolNames: readonly string[];
  }
).kernelToolNames;

const onTestFinishedEarly = (dir: string, onTestFinished: (cleanup: () => Promise<void>) => void): void => {
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
};

const payloadOf = (result: { structuredContent?: unknown }): Record<string, unknown> => (result.structuredContent as { result: Record<string, unknown> }).result;

test('KERN-011: the session report keeps the reference field set', () => {
  const report = payloadOf(binarySession(new ReaSession(runtime), {}));
  const reference = referenceSessionReport();
  expect(Object.keys(report).toSorted()).toStrictEqual([...Object.keys(reference), 'runtime'].toSorted());
  expect(report['open']).toBe(false);
  expect(report['analysis_run']).toBeNull();
  expect(report['analysis_provider_binding']).toBeNull();
  expect(report['analysis_activity']).toStrictEqual({ status: 'not_observed', providers: [] });
  expect(report['client_features']).toStrictEqual({ elicitation_form: false, elicitation_url: false, roots: false, sampling: false });
});

test('KERN-011: availability has one entry per advertised tool with the reference fields', () => {
  const report = payloadOf(binarySession(new ReaSession(runtime), {}));
  const availability = report['tool_availability'] as Record<string, unknown>[];
  const reference = referenceSessionReport()['tool_availability'] as Record<string, unknown>[];
  expect(availability).toHaveLength(229);
  const referenceByName = new Map(reference.map((entry) => [entry['name'] as string, entry]));
  const requiredKeys = Object.keys(reference[0] ?? {})
    .map((key) => (key === 'remediation_present' ? 'remediation' : key))
    .toSorted();
  for (const entry of availability) {
    const expected = referenceByName.get(entry['name'] as string);
    const keys = Object.keys(entry).toSorted();
    expect(
      requiredKeys.every((key) => keys.includes(key)),
      String(entry['name']),
    ).toBe(true);
    expect(typeof entry['remediation'] === 'string' || entry['remediation'] === null).toBe(true);
    expect(entry['remediation'] === null, String(entry['name'])).toBe(entry['available'] === true);
    if (expected !== undefined) {
      expect(typeof expected['remediation_present'], String(entry['name'])).toBe('boolean');
    }
  }
  const byName = new Map(availability.map((entry) => [entry['name'] as string, entry]));
  const kernel = [...byName].filter(([, entry]) => entry['available'] === true).map(([name]) => name);
  expect(kernel.toSorted()).toStrictEqual([...kernelManifestNames].toSorted());
  expect([...byName.values()].filter((entry) => entry['reason'] === 'not_implemented')).toHaveLength(0);
});

test('KERN-011: the provider candidates are reported as unavailable by this port', () => {
  const report = payloadOf(binarySession(new ReaSession(runtime), {}));
  const candidates = report['analysis_provider_candidates'] as { provider: { id: string }; availability: { code: string } }[];
  expect(candidates.map((candidate) => candidate.provider.id)).toStrictEqual(['ghidra', 'hopper', 'ida', 'kuna']);
  expect(candidates.every((candidate) => candidate.availability.code === 'not_implemented')).toBe(true);
});

test('KERN-011: an expected catalog digest must be bare lowercase hex', () => {
  let thrown: unknown;
  try {
    binarySession(new ReaSession(runtime), { expected_catalog_digest: `sha256:${'0'.repeat(64)}` });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ReaError);
  expect((thrown as ReaError).payload.code).toBe('invalid_request');
});

test('KERN-011: a mismatched expectation reports the exact mismatch', () => {
  let thrown: unknown;
  try {
    binarySession(new ReaSession(runtime), { expected_catalog_digest: '0'.repeat(64) });
  } catch (error) {
    thrown = error;
  }
  const details = (thrown as ReaError).payload.details as { mismatches: { field: string }[] };
  expect(details.mismatches[0]?.field).toBe('expected_catalog_digest');
  expect(() => binarySession(new ReaSession(runtime), { expected_catalog_digest: catalogDigest() })).not.toThrow();
});

test('KERN-012: open_binary returns the reference identity for the same Mach-O bytes', async () => {
  const session = new ReaSession(runtime);
  const identity = payloadOf(await openBinary(session, { path: fixturePath('targets/minimal-macho.bin') }));
  expect(identity['format']).toBe('mach-o');
  expect(identity['kind']).toBe('executable');
  expect(identity['architecture']).toBe('arm64');
  expect(identity['sha256']).toBe('712cd980281c2c1f109e90f710ad537745a64a4e6cd413c6fa60d072a50d0d86');
  expect(identity['path']).toContain('minimal-macho.bin');
  expect(session.open).toBe(true);
  expect(session.target?.identity).toStrictEqual(identity);
});

test('KERN-012: open_binary returns the reference identity for the same ELF bytes', async () => {
  const identity = payloadOf(await openBinary(new ReaSession(runtime), { path: fixturePath('targets/minimal-elf.bin') }));
  expect(identity).toMatchObject({
    format: 'elf',
    kind: 'executable',
    architecture: 'x86_64',
    sha256: '2bdfef8afade4eb81137a0dc23bcbca5f72d1cd4d5dafbbe1ebe95d9fe69d662',
  });
});

test('KERN-012: open_binary returns the reference identity for the same zip bytes', async () => {
  const identity = payloadOf(await openBinary(new ReaSession(runtime), { path: fixturePath('targets/fixture.zip') }));
  expect(identity).toMatchObject({
    format: 'zip',
    kind: 'archive',
    architecture: null,
    sha256: 'f70f0a427115616e2e85303698bc8e1fa3fdcb5e405b186c585128d33464455e',
  });
});

test('KERN-012: a directory is refused with the reference constraint', async () => {
  let thrown: unknown;
  try {
    await openBinary(new ReaSession(runtime), { path: fixturePath('targets') });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('target_unavailable');
  expect(payload.category).toBe('unavailable');
  expect(payload.details).toMatchObject({ constraint: 'directory_requires_file' });
});

test('KERN-012: unsupported content and missing paths fail closed as target_unavailable', async () => {
  for (const path of [fixturePath('targets/note.txt'), fixturePath('targets/absent.bin')]) {
    let thrown: unknown;
    try {
      await openBinary(new ReaSession(runtime), { path });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ReaError).payload.code).toBe('target_unavailable');
  }
});

test('KERN-012: a provider or snapshot request this port cannot serve fails closed', async () => {
  const session = new ReaSession(runtime);
  await expect(openBinary(session, { path: fixturePath('targets/minimal-elf.bin'), provider_id: 'ghidra' })).rejects.toThrowError(/provider bridge/);
  await expect(openBinary(session, { path: fixturePath('targets/minimal-elf.bin'), snapshot_path: '/tmp/snapshot.json' })).rejects.toThrowError(/snapshots/);
  await expect(openBinary(session, { path: fixturePath('targets/minimal-elf.bin'), format: 'dos-com' })).rejects.toThrowError(/DOS COM/);
  expect(session.open).toBe(false);
});

test('KERN-012: an opening target allocates a session run identifier', async () => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/minimal-elf.bin') });
  const report = payloadOf(binarySession(session, {}));
  expect(report['analysis_run']).toMatchObject({ process_lineage: { status: 'not_observed' } });
  expect((report['analysis_run'] as { run_id: string }).run_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(report['open']).toBe(true);
});

test('KERN-013: close_binary returns the reference null result and clears the session', async () => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/minimal-elf.bin') });
  recordUnknown(session, {
    question: 'Q?',
    severity: 'low',
    domain: 'd',
    required_authority: null,
    required_confidence: 'observed',
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
  });
  expect(session.evidence.size).toBeGreaterThan(0);
  expect(session.unknowns.size).toBe(1);
  const result = closeBinary(session, {});
  expect(result.structuredContent).toStrictEqual({ result: null });
  expect(session.open).toBe(false);
  expect(session.evidence.size).toBe(0);
  expect(session.unknowns.size).toBe(0);
});

test('KERN-013: close_binary on an empty session stays idempotent', () => {
  const session = new ReaSession(runtime);
  expect(closeBinary(session, {}).structuredContent).toStrictEqual({ result: null });
  expect(closeBinary(session, {}).structuredContent).toStrictEqual({ result: null });
  expect(() => closeBinary(session, { snapshot_path: '/tmp/s.json' })).toThrowError(/snapshots/);
});

test('KERN-013: closing a session with a removed working directory needs no filesystem access', async ({ onTestFinished }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-cwd-'));
  const session = new ReaSession({ ...runtime, cwd: dir });
  await rm(dir, { recursive: true, force: true });
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  expect(closeBinary(session, {}).structuredContent).toStrictEqual({ result: null });
});

test('KERN-025: an available tool reports the reference reason and annotation vocabulary', () => {
  const report = payloadOf(binarySession(new ReaSession(runtime), {}));
  const availability = report['tool_availability'] as Record<string, unknown>[];
  for (const entry of availability) {
    if (entry['available'] === true) {
      expect(entry['reason'], String(entry['name'])).toBe('available');
      expect(entry['remediation']).toBeNull();
      expect(Object.keys(entry['annotations'] as object).toSorted()).toStrictEqual(['destructive', 'idempotent', 'open_world', 'read_only']);
    }
  }
});

test('KERN-028: a universal Mach-O reports the slice this host runs', async ({ onTestFinished }) => {
  const header = Buffer.alloc(4096);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(0x01000007, 8);
  header.writeUInt32BE(3, 12);
  header.writeUInt32BE(0, 16);
  header.writeUInt32BE(16, 12 + 8);
  header.writeUInt32BE(0x0100000c, 28);
  header.writeUInt32BE(3, 32);
  header.writeUInt32BE(32, 36);
  header.writeUInt32BE(16, 40);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-fat-'));
  const path = join(dir, 'fat.bin');
  await writeFile(path, header);
  onTestFinishedEarly(dir, onTestFinished);
  const identity = payloadOf(await openBinary(new ReaSession(runtime), { path }));
  expect(identity['format']).toBe('mach-o');
  expect(identity['architecture']).toBe(process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : null);
});

test('KERN-028: mach-O variants and PE headers are identified from their headers', async ({ onTestFinished }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-headers-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));

  const thin64 = Buffer.alloc(32);
  thin64.writeUInt32LE(0xfeedfacf, 0);
  thin64.writeUInt32LE(0x01000007, 4);
  const thinPath = join(dir, 'thin-x64.bin');
  await writeFile(thinPath, thin64);
  await expect(openBinary(new ReaSession(runtime), { path: thinPath })).resolves.toBeDefined();
  expect(payloadOf(await openBinary(new ReaSession(runtime), { path: thinPath }))['architecture']).toBe('x86_64');

  const pe = Buffer.alloc(64);
  pe.write('MZ', 0, 'latin1');
  const pePath = join(dir, 'pe.bin');
  await writeFile(pePath, pe);
  const peIdentity = payloadOf(await openBinary(new ReaSession(runtime), { path: pePath }));
  expect(peIdentity).toMatchObject({ format: 'pe', kind: 'executable', architecture: null });

  const unknown = Buffer.alloc(64);
  unknown.write('\u007fNOTELF', 0, 'latin1');
  const unknownPath = join(dir, 'unknown.bin');
  await writeFile(unknownPath, unknown);
  await expect(openBinary(new ReaSession(runtime), { path: unknownPath })).rejects.toThrowError(/unsupported binary format/);
});

test('KERN-012: open_binary refuses a non-regular file instead of blocking', async ({ onTestFinished }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-fifo-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const fifo = join(dir, 'pipe');
  execFileSync('mkfifo', [fifo]);
  let thrown: unknown;
  try {
    await openBinary(new ReaSession(runtime), { path: fifo });
  } catch (error) {
    thrown = error;
  }
  expect((thrown as ReaError).payload.code).toBe('target_unavailable');
  expect((thrown as ReaError).payload.details).toMatchObject({ reason: 'not a regular file' });
});

test('KERN-030: an unusable budget is rejected before the session changes', async () => {
  const session = new ReaSession(runtime);
  const previous = process.env['REA_MCP_MAX_RESPONSE_BYTES'];
  process.env['REA_MCP_MAX_RESPONSE_BYTES'] = '1';
  try {
    await expect(openBinary(session, { path: fixturePath('targets/minimal-elf.bin') })).rejects.toThrowError(/REA_MCP_MAX_RESPONSE_BYTES/);
  } finally {
    if (previous === undefined) delete process.env['REA_MCP_MAX_RESPONSE_BYTES'];
    else process.env['REA_MCP_MAX_RESPONSE_BYTES'] = previous;
  }
  expect(session.open).toBe(false);
});

test('KERN-028: a Java class file is not mistaken for a universal Mach-O', async ({ onTestFinished }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-java-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const java = Buffer.alloc(64);
  java.writeUInt32BE(0xcafebabe, 0);
  java.writeUInt16BE(0, 4);
  java.writeUInt16BE(61, 6);
  const path = join(dir, 'Thing.class');
  await writeFile(path, java);
  let thrown: unknown;
  try {
    await openBinary(new ReaSession(runtime), { path });
  } catch (error) {
    thrown = error;
  }
  expect((thrown as ReaError).payload.code).toBe('target_unavailable');
});
