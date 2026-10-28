import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { minimalElf64CoreFixture } from '../src/analysis/recorded-crash.ts';
import { mapDemangleOutputs } from '../src/analysis/swift-demangle.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { extractArtifact, inspectArtifact } from '../src/tools/artifact-tools.ts';
import { openBundleResources } from '../src/tools/bundle-resource-tools.ts';
import { compareArtifacts, compareBundles, compareManagedMembers } from '../src/tools/compare-tools.ts';
import { demangleSwift } from '../src/tools/demangle-tools.ts';
import { decodeInterfaceBuilder } from '../src/tools/interface-builder-tools.ts';
import { inspectManagedMembers } from '../src/tools/managed-tools.ts';
import { inspectRecordedCrash } from '../src/tools/recorded-crash-tools.ts';
import { openBinary } from '../src/tools/session-tools.ts';
import { fixturePath } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const normalized = async (run: () => { structuredContent?: unknown } | Promise<{ structuredContent?: unknown }>): Promise<Record<string, unknown>> => {
  const result = await run();
  return (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;
};

const asError = async (run: () => unknown): Promise<{ code: string; message: string }> => {
  try {
    await run();
    throw new Error('expected failure');
  } catch (error) {
    const payload = (error as { payload?: { code: string; message: string } }).payload;
    if (payload === undefined) throw error;
    return payload;
  }
};

test('mapDemangleOutputs: underscore is invalid without consuming a stdout line', () => {
  expect(mapDemangleOutputs(['_$sSSN', 'not_swift', '_'], 'type metadata for Swift.String\nnot_swift\n')).toStrictEqual([
    { input: '_$sSSN', output: 'type metadata for Swift.String', status: 'demangled' },
    { input: 'not_swift', output: 'not_swift', status: 'unchanged' },
    { input: '_', output: '', status: 'invalid' },
  ]);
});

test('demangle_swift: requires an open target and demangles via swift-demangle', async () => {
  const session = new ReaSession(runtime);
  const closed = await asError(() => demangleSwift(session, { symbols: ['_$sSSN'] }));
  expect(closed.code).toBe('target_unavailable');

  await openBinary(session, { path: fixturePath('targets/fixture-go-macho') });
  const record = await normalized(() => demangleSwift(session, { symbols: ['_$sSSN', 'not_swift', '_'] }));
  expect(record['symbols']).toStrictEqual([
    { input: '_$sSSN', output: 'type metadata for Swift.String', status: 'demangled' },
    { input: 'not_swift', output: 'not_swift', status: 'unchanged' },
    { input: '_', output: '', status: 'invalid' },
  ]);
  expect((record['provenance'] as { tool: string }[])[0]?.tool).toBe('swift-demangle');
});

test('decode_interface_builder: projects keyed-archive nib under open bundle resources', async () => {
  const session = new ReaSession(runtime);
  await openBundleResources(session, { path: fixturePath('targets/bundle/Fixture.app') });
  const record = await normalized(() => decodeInterfaceBuilder(session, { detail: 'complete' }));
  const documents = record['documents'] as {
    relative_path: string;
    document_kind: string;
    object_count: number;
    archive_sha256: string;
  }[];
  expect(documents.some((document) => document.relative_path.endsWith('MainMenu.nib'))).toBe(true);
  const nib = documents.find((document) => document.relative_path.endsWith('MainMenu.nib'));
  expect(nib?.document_kind).toBe('nib');
  expect((nib?.object_count ?? 0) > 0).toBe(true);
  expect(typeof nib?.archive_sha256).toBe('string');
  expect(record['graph']).toMatchObject({
    provider: { id: 'rea-artifact-graph', tool_version: 'rea-interface-builder/1' },
  });
});

test('extract_artifact: materializes ZIP members into a fresh directory', async () => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/fixture.zip') });
  const record = await normalized(() => extractArtifact(session, {}));
  expect(typeof record['output_root']).toBe('string');
  const artifacts = record['artifacts'] as { relative_path: string; sha256: string; created: boolean }[];
  expect(artifacts.map((row) => row.relative_path).sort()).toStrictEqual(['app.js', 'manifest.json']);
  expect(record['containment_verified']).toBe(true);
  const root = record['output_root'] as string;
  const appJs = await readFile(join(root, 'app.js'), 'utf8');
  expect(appJs.length).toBeGreaterThan(0);
  await rm(root, { recursive: true, force: true });
});

test('compare_artifacts: unchanged when both inventories match', async () => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/fixture.zip') });
  const left = await inspectArtifact(session, {});
  const right = await inspectArtifact(session, {});
  const record = await normalized(() =>
    compareArtifacts(session, {
      left: left.structuredContent,
      right: right.structuredContent,
    }),
  );
  expect(record['status']).toBe('unchanged');
  expect((record['summary'] as { unchanged: number }).unchanged).toBe(3);
  expect(record['changes']).toStrictEqual([]);
});

test('compare_bundles: absolute empty bundles are unchanged; relative paths fail closed', async () => {
  const session = new ReaSession(runtime);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-bundles-'));
  const empty = JSON.stringify({
    artifacts: [],
    captures: [],
    environments: [],
    providers: [],
    records: [],
    scenarios: [],
    unknowns: [],
  });
  const left = join(dir, 'left.json');
  const right = join(dir, 'right.json');
  await writeFile(left, empty);
  await writeFile(right, empty);
  const record = await normalized(() => compareBundles(session, { left_bundle_path: left, right_bundle_path: right }));
  expect(record['status']).toBe('unchanged');
  expect((record['summary'] as { records_unchanged: number }).records_unchanged).toBe(0);

  const relative = await asError(() => compareBundles(session, { left_bundle_path: 'rel.json', right_bundle_path: right }));
  expect(relative.code).toBe('invalid_request');
  expect(relative.message).toContain('absolute');
});

test('compare_managed_members: distinct not-managed inventories compare without inventing members', async () => {
  const session = new ReaSession(runtime);
  const left = await inspectManagedMembers(session, { path: fixturePath('targets/pe/fixture-go-pe.exe') });
  const peBytes = await readFile(fixturePath('targets/pe/fixture-go-pe.exe'));
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-mm-'));
  const alt = join(dir, 'alt.exe');
  await writeFile(alt, Buffer.concat([peBytes, Buffer.from([0])]));
  const right = await inspectManagedMembers(session, { path: alt });
  const same = await asError(() =>
    compareManagedMembers(session, {
      left: left.structuredContent,
      right: left.structuredContent,
    }),
  );
  expect(same.code).toBe('invalid_request');
  expect(same.message).toContain('distinct');

  const record = await normalized(() =>
    compareManagedMembers(session, {
      left: left.structuredContent,
      right: right.structuredContent,
    }),
  );
  expect((record['methods'] as unknown[]).length).toBe(0);
  expect((record['left'] as { metadata_status: string }).metadata_status).toBe('absent');
  expect((record['limitations'] as string[]).some((line) => line.includes('CIL'))).toBe(true);
});

test('inspect_recorded_crash: matches REA pwntools Linux-x64 host gate', async () => {
  const session = new ReaSession(runtime);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-core-'));
  const path = join(dir, 'core');
  await writeFile(path, minimalElf64CoreFixture());
  if (process.platform === 'linux' && process.arch === 'x64') {
    const record = await normalized(() => inspectRecordedCrash(session, { path }));
    expect(record['format']).toBe('elf64-core');
    expect(record['machine_name']).toBe('x86_64');
    expect(Array.isArray(record['segments'])).toBe(true);
    expect((record['limitations'] as string[]).some((line) => line.includes('does not launch'))).toBe(true);
    return;
  }
  let thrown: unknown;
  try {
    await inspectRecordedCrash(session, { path });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as { payload: { code: string; details?: { provider_id?: string } } }).payload;
  expect(payload.code).toBe('capability_unavailable');
  expect(payload.details?.provider_id).toBe('pwntools-elf');
});
