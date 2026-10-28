import { expect, test } from 'vitest';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectAppleIps } from '../src/tools/apple-ips-tools.ts';
import { inspectElfNotes } from '../src/tools/elf-tools.ts';
import { inspectByteEntropy } from '../src/tools/entropy-tools.ts';
import { inspectPeCertificates, inspectPeImports, inspectPeLoadConfig } from '../src/tools/pe-tools.ts';
import { inspectRustBinary } from '../src/tools/rust-tools.ts';
import { fixturePath } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const normalized = async (run: () => Promise<{ structuredContent?: unknown }>): Promise<Record<string, unknown>> => {
  const result = await run();
  return (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;
};

test('inspect_pe_imports: inventories DLLs from the Go PE fixture', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectPeImports(session, { path: fixturePath('targets/pe/fixture-go-pe.exe') }));
  expect(record['format']).toBe('pe32-plus');
  expect(record['import_directory']).toMatchObject({ rva: expect.any(Number), size: expect.any(Number) });
  const imports = record['imports'] as { name: string; functions: unknown[] }[];
  expect(imports.length).toBeGreaterThan(0);
  expect(imports.some((entry) => typeof entry.name === 'string' && entry.name.toLowerCase().endsWith('.dll'))).toBe(true);
  expect(imports.some((entry) => entry.functions.length > 0)).toBe(true);
  expect(record['imphash']).toMatchObject({ algorithm: 'pefile', md5: expect.stringMatching(/^[a-f0-9]{32}$/) });
  expect(session.evidence.size).toBe(1);
});

test('inspect_pe_imports: refuses a non-PE path', async () => {
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    await inspectPeImports(session, { path: fixturePath('targets/minimal-elf.bin') });
  } catch (error) {
    thrown = error;
  }
  expect((thrown as ReaError).payload.code).toBe('invalid_request');
  expect(session.evidence.size).toBe(0);
});

test('inspect_pe_certificates: decodes Authenticode PKCS#7 basics from the signed fixture', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectPeCertificates(session, { path: fixturePath('targets/pe/fixture-pe-certificate.exe') }));
  expect(record['table']).not.toBeNull();
  const entries = record['entries'] as { certificate_type_name: string; pkcs7: { certificates: unknown[]; content_type_oid: string } | null }[];
  expect(entries).toHaveLength(1);
  expect(entries[0]?.certificate_type_name).toBe('pkcs7');
  expect(entries[0]?.pkcs7?.content_type_oid).toBe('1.2.840.113549.1.7.2');
  expect(entries[0]?.pkcs7?.certificates.length).toBeGreaterThan(0);
});

test('inspect_pe_certificates: reports observed absence on an unsigned PE', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectPeCertificates(session, { path: fixturePath('targets/pe/fixture-go-pe.exe') }));
  expect(record['table']).toBeNull();
  expect(record['entries']).toStrictEqual([]);
  expect(record['coverage']).toMatchObject({ status: 'complete', examined_entries: 0 });
});

test('inspect_pe_load_config: reports null TLS and load_config when directories are absent', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectPeLoadConfig(session, { path: fixturePath('targets/pe/fixture-go-pe.exe') }));
  expect(record['tls']).toBeNull();
  expect(record['load_config']).toBeNull();
  expect(record['examined_callbacks']).toBe(0);
  expect(record['format']).toBe('pe32-plus');
});

test('inspect_elf_notes: returns GNU build-id from the crafted ELF', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectElfNotes(session, { path: fixturePath('targets/elf/notes-and-dep.so') }));
  expect(record['format']).toBe('elf64');
  expect((record['tables'] as unknown[]).length).toBeGreaterThan(0);
  const entries = record['entries'] as { type_name: string; gnu: { build_id_hex: string | null } | null }[];
  const buildId = entries.find((entry) => entry.type_name === 'gnu_build_id');
  expect(buildId?.gnu?.build_id_hex).toBe('0102030405060708090a0b0c0d0e0f10');
});

test('inspect_rust_binary: rejects fixture .dep-v0 that fails REA package schema', async () => {
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    await inspectRustBinary(session, { path: fixturePath('targets/rust/auditable.elf') });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('invalid_request');
  expect(payload.retryable).toBe(false);
  expect(payload.recovery).toStrictEqual({ kind: 'inspect_input_contract', operation: 'inspect_rust_binary' });
  expect(JSON.stringify(payload.details)).toContain('Dependency JSON does not match the package schema');
});

test('inspect_apple_ips: projects crash body fields for bug_type 309', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectAppleIps(session, { path: fixturePath('targets/ips/sample-crash.ips') }));
  expect((record['metadata'] as { bug_type: string }).bug_type).toBe('309');
  expect((record['process'] as { name: string }).name).toBe('Example');
  expect((record['threads'] as unknown[]).length).toBe(1);
  expect((record['images'] as unknown[]).length).toBe(1);
  expect((record['exception'] as { signal: string }).signal).toBe('SIGSEGV');
});

test('inspect_byte_entropy: reports file entropy, blocks and high/low runs', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectByteEntropy(session, { path: fixturePath('targets/entropy/mixed.bin'), block_size: 4096 }));
  expect(record['block_size']).toBe(4096);
  expect((record['blocks'] as unknown[]).length).toBe(2);
  expect(record['file_entropy']).toBeGreaterThan(0);
  const runs = record['runs'] as { classification: string; length: number }[];
  expect(runs.some((run) => run.classification === 'low')).toBe(true);
  expect(runs.some((run) => run.classification === 'high')).toBe(true);
});
