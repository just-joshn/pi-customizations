import { expect, test } from 'vitest';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectDesktopApplication } from '../src/tools/desktop-application-tools.ts';
import { inspectErlangBeam } from '../src/tools/erlang-beam-tools.ts';
import { inspectGpuCodeObjects } from '../src/tools/gpu-code-object-tools.ts';
import { inspectIl2CppMetadata } from '../src/tools/il2cpp-tools.ts';
import { inspectKernelModule } from '../src/tools/kernel-module-tools.ts';
import { inspectModelArtifact } from '../src/tools/model-artifact-tools.ts';
import { inspectPythonPyc } from '../src/tools/python-pyc-tools.ts';
import { inspectSqliteDatabase } from '../src/tools/sqlite-tools.ts';
import { fixturePath } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const normalized = async (run: () => Promise<{ structuredContent?: unknown }>): Promise<Record<string, unknown>> => {
  const result = await run();
  return (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;
};

test('inspect_model_artifact: reads GGUF metadata and tensor declarations', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectModelArtifact(session, { path: fixturePath('targets/models/tiny.gguf') }));
  expect(record['format']).toBe('gguf');
  expect(record['version']).toBe(3);
  const metadata = record['metadata'] as { key: string; value: unknown }[];
  expect(metadata.some((entry) => entry.key === 'general.architecture' && entry.value === 'demo')).toBe(true);
  const tensors = record['tensors'] as { name: string; shape: string[] }[];
  expect(tensors).toHaveLength(1);
  expect(tensors[0]).toMatchObject({ name: 'weight', shape: ['2', '2'], type: 'F32' });
  expect((record['artifact'] as { sha256: string | null; header_length: number }).sha256).toBeNull();
  expect((record['artifact'] as { header_length: number }).header_length).toBe(150);
  expect(session.evidence.size).toBe(1);
});

test('inspect_model_artifact: reads safetensors declarations', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectModelArtifact(session, { path: fixturePath('targets/models/tiny.safetensors'), hash: 'full' }));
  expect(record['format']).toBe('safetensors');
  expect((record['tensors'] as { name: string }[])[0]?.name).toBe('weight');
  expect((record['artifact'] as { sha256: string }).sha256).toMatch(/^[a-f0-9]{64}$/);
});

test('inspect_sqlite_database: inventories ordinary tables from the fixture db', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectSqliteDatabase(session, { path: fixturePath('targets/fixture.db') }));
  expect(record['engine']).toMatchObject({ name: 'SQLite' });
  expect((record['schema'] as { scope: string }).scope).toBe('inventory');
  const tables = (record['schema'] as { tables: { name: string }[] }).tables.map((table) => table.name).toSorted();
  expect(tables).toContain('users');
  expect(tables).toContain('audit_log');
  expect(record['rows']).toBeNull();
});

test('inspect_sqlite_database: samples selected table rows as typed cells', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() =>
    inspectSqliteDatabase(session, {
      path: fixturePath('targets/fixture.db'),
      table: 'users',
      columns: ['id', 'name'],
      row_limit: 3,
      schema_scope: 'selected_table',
    }),
  );
  expect((record['schema'] as { scope: string }).scope).toBe('selected_table');
  const rows = record['rows'] as { table: string; columns: string[]; values: { type: string; value?: string }[][]; examined_rows: number };
  expect(rows.table).toBe('users');
  expect(rows.columns).toStrictEqual(['id', 'name']);
  expect(rows.examined_rows).toBe(3);
  expect(rows.values[0]?.[0]).toMatchObject({ type: 'integer', value: '1' });
  expect(rows.values[0]?.[1]).toMatchObject({ type: 'text', value: 'user1' });
});

test('inspect_erlang_beam: decodes atoms exports and imports', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectErlangBeam(session, { path: fixturePath('targets/beam/demo.beam') }));
  expect(record['module']).toBe('module');
  expect((record['atoms'] as { name: string }[]).map((atom) => atom.name)).toContain('foo');
  expect((record['exports'] as { function: string; arity: number }[])[0]).toMatchObject({ function: 'foo', arity: 1 });
  expect((record['imports'] as { module: string; function: string }[])[0]).toMatchObject({ module: 'erlang', function: 'length' });
  expect((record['chunks'] as unknown[]).length).toBeGreaterThanOrEqual(4);
});

test('inspect_desktop_application: marks Electron candidate from resources/app.asar', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectDesktopApplication(session, { path: fixturePath('targets/desktop/electron-app') }));
  const candidates = record['candidates'] as { family: string; confidence: string }[];
  expect(candidates.some((candidate) => candidate.family === 'electron' && candidate.confidence === 'inferred')).toBe(true);
  expect((record['files'] as unknown[]).length).toBeGreaterThan(0);
  expect((record['components'] as unknown[]).length).toBe(0);
  const probes = (record['next_probes'] as { operation: string }[]).map((probe) => probe.operation);
  expect(probes).toContain('open_binary');
  expect(probes).toContain('analyze_javascript_application');
});

test('inspect_gpu_code_objects: inventories PTX as a standalone file object', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectGpuCodeObjects(session, { path: fixturePath('targets/gpu/sample.ptx') }));
  expect(record['format']).toBe('ptx');
  expect(record['ptx_artifacts']).toStrictEqual([]);
  const objects = record['objects'] as { id: string; kind: string; target: string | null; inspection: string }[];
  expect(objects).toHaveLength(1);
  expect(objects[0]?.id).toBe('file@0');
  expect(objects[0]?.kind).toBe('ptx');
  expect(objects[0]?.target).toBe('sm_70');
  expect(objects[0]?.inspection).toBe('inventory');
});

test('inspect_il2cpp_metadata: rejects unexpected-header-size fixture like REA 6.8.0', async () => {
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    await inspectIl2CppMetadata(session, { path: fixturePath('targets/il2cpp/global-metadata.dat') });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('invalid_request');
  expect(payload.retryable).toBe(false);
  expect(JSON.stringify(payload.details)).toContain('unexpected-header-size');
  expect(payload.details).toMatchObject({ operation: 'inspect_il2cpp_metadata' });
});

test('inspect_python_pyc: returns header and nested code objects', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectPythonPyc(session, { path: fixturePath('targets/pyc/sample.pyc') }));
  expect((record['header'] as { python_version: string }).python_version).toBe('3.13');
  const codes = record['code_objects'] as { name: string; bytecode: { bytes: number } }[];
  expect(codes.some((code) => code.name === '<module>')).toBe(true);
  expect(codes.some((code) => code.name === 'greet')).toBe(true);
  expect(codes.every((code) => code.bytecode.bytes > 0)).toBe(true);
});

test('inspect_kernel_module: reads .modinfo and section presence from ET_REL', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectKernelModule(session, { path: fixturePath('targets/kernel/demo.ko') }));
  expect(record['applicability']).toBe('applicable');
  expect(record['type_name']).toBe('relocatable');
  const modinfo = record['modinfo'] as { status: string; entries: { key: string; value: string }[] };
  expect(modinfo.status).toBe('present');
  expect(modinfo.entries.some((entry) => entry.key === 'name' && entry.value === 'demo')).toBe(true);
  expect((record['init_text'] as { status: string }).status).toBe('present');
  expect((record['versions'] as { entries: { name: string; crc_hex: string }[] }).entries[0]?.name).toBe('tk');
  expect((record['versions'] as { entries: { crc_hex: string }[] }).entries[0]?.crc_hex).toBe('6e69727011223344');
  expect((record['coverage'] as { examined_entries: number }).examined_entries).toBe(6);
});

test('inspect_kernel_module: refuses a non-relocatable ELF', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectKernelModule(session, { path: fixturePath('targets/elf/notes-and-dep.so') }));
  expect(record['applicability']).toBe('not_applicable');
  expect(session.evidence.size).toBe(1);
});

test('inspect_model_artifact: refuses an unrelated file', async () => {
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    await inspectModelArtifact(session, { path: fixturePath('targets/note.txt') });
  } catch (error) {
    thrown = error;
  }
  expect((thrown as ReaError).payload.code).toBe('invalid_request');
  expect(session.evidence.size).toBe(0);
});
