import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { ELECTRON_FUSE_STATE_BYTES, thinMachoFuseFixture } from '../src/analysis/electron-fuses.ts';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectApkSignature } from '../src/tools/apk-signature-tools.ts';
import { inspectAssetCatalog, inspectKeyedArchive, openBundleResources } from '../src/tools/bundle-resource-tools.ts';
import { inspectElectronFuses } from '../src/tools/electron-fuse-tools.ts';
import { identifyFlutterBuild, inspectDartAot } from '../src/tools/flutter-tools.ts';
import { inspectManagedArtifact, inspectManagedMembers } from '../src/tools/managed-tools.ts';
import { openBinary } from '../src/tools/session-tools.ts';
import { inspectSignature } from '../src/tools/signature-tools.ts';
import { fixturePath } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const normalized = async (run: () => Promise<{ structuredContent?: unknown }>): Promise<Record<string, unknown>> => {
  const result = await run();
  return (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;
};

test('inspect_electron_fuses: decodes sentinel wire from a thin Mach-O fixture', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-fuse-'));
  const path = join(dir, 'Electron');
  await writeFile(
    path,
    thinMachoFuseFixture([
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.enabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.disabled,
      ELECTRON_FUSE_STATE_BYTES.enabled,
    ]),
  );
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectElectronFuses(session, { path }));
  expect(record['artifact']).toMatchObject({ format: 'mach-o' });
  const slices = record['slices'] as { sentinel_count: number; sentinels: { fuses: { name: string | null; state: string }[] }[] }[];
  expect(slices[0]?.sentinel_count).toBe(1);
  expect(slices[0]?.sentinels[0]?.fuses[0]).toMatchObject({ name: 'RunAsNode', state: 'disabled' });
  expect(slices[0]?.sentinels[0]?.fuses[1]).toMatchObject({ name: 'EnableCookieEncryption', state: 'enabled' });
  expect(session.evidence.size).toBe(1);
});

test('inspect_apk_signature: reports v1 META-INF signers on the fixture apk', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectApkSignature(session, { path: fixturePath('targets/apk/v1-only.apk') }));
  expect((record['schemes'] as { v1: { present: boolean; has_manifest: boolean } }).v1.present).toBe(true);
  expect((record['schemes'] as { v1: { has_manifest: boolean } }).v1.has_manifest).toBe(true);
  expect((record['posture'] as { strongest_scheme: string; v1_only: boolean }).v1_only).toBe(true);
  expect(record['runtime_execution']).toBe('not-performed');
});

test('inspect_signature: reads SuperBlob facts from a signed Mach-O session', async () => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/fixture-go-macho') });
  const record = await normalized(() => inspectSignature(session, {}));
  expect(record['signed']).toBe(true);
  expect(record['identifier']).toBe('a.out');
  expect(record['format']).toBe('Mach-O thin (arm64)');
  expect(record['cdhashes']).toStrictEqual(['d8864aa4c955875d2575294cd891f196f9fa7abd']);
  expect(record['hash_algorithms']).toStrictEqual(['sha256']);
  expect(record['designated_requirement']).toBe('cdhash H"d8864aa4c955875d2575294cd891f196f9fa7abd"');
  expect(record['limitations']).toStrictEqual(['Inspected a digest-verified Mach-O byte snapshot; filesystem-bound signing context and trust validation are not examined.']);
});

test('open_bundle_resources + inspect_keyed_archive: projects NSKeyedArchiver object table', async () => {
  const session = new ReaSession(runtime);
  const bundle = fixturePath('targets/bundle/Fixture.app');
  const opened = await openBundleResources(session, { path: bundle });
  expect((opened.structuredContent as { result: { layout: string } }).result.layout).toBe('contents');
  const record = await normalized(() => inspectKeyedArchive(session, { path: 'Contents/Resources/archive.plist' }));
  expect(record['archive_format']).toBe('xml-plist');
  expect((record['objects'] as unknown[]).length).toBeGreaterThanOrEqual(3);
  expect((record['objects'] as { kind: string }[]).some((object) => object.kind === 'class-descriptor')).toBe(true);
});

test('inspect_asset_catalog: fixture Assets.car refuses with unreadable_output like REA assetutil', async () => {
  const session = new ReaSession(runtime);
  await openBundleResources(session, { path: fixturePath('targets/bundle/Fixture.app') });
  let thrown: unknown;
  try {
    await inspectAssetCatalog(session, {});
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('unreadable_output');
  expect(payload.details).toMatchObject({
    operation: 'inspect_asset_catalog',
    reason: expect.stringContaining('assetutil did not produce usable catalog metadata'),
  });
});

test('inspect_managed_artifact: classifies a non-CLI PE as not-managed', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectManagedArtifact(session, { path: fixturePath('targets/pe/fixture-go-pe.exe') }));
  expect((record['classification'] as { status: string }).status).toBe('not-managed');
  expect((record['pe'] as { cli: null }).cli).toBeNull();
});

test('inspect_managed_members: retains not-managed coverage without inventing members', async () => {
  const session = new ReaSession(runtime);
  const record = await normalized(() => inspectManagedMembers(session, { path: fixturePath('targets/pe/fixture-go-pe.exe') }));
  expect(record['types']).toStrictEqual([]);
  expect(record['methods']).toStrictEqual([]);
  expect(record['coverage']).toStrictEqual({ state: 'unavailable', issues: [] });
  expect(record['limitations']).toStrictEqual(['The PE has no admitted CLI metadata; managed member inspection is unavailable.']);
});

test('identify_flutter_build + inspect_dart_aot: identify succeeds; dart AOT refuses unsupported ELF class', async () => {
  const session = new ReaSession(runtime);
  const build = await normalized(() => identifyFlutterBuild(session, { path: fixturePath('targets/flutter/demo.apk') }));
  expect(build['flutter_detected']).toBe(true);
  expect((build['abis'] as { abi: string }[])[0]?.abi).toBe('arm64-v8a');
  let thrown: unknown;
  try {
    await inspectDartAot(session, { path: fixturePath('targets/flutter/demo.apk'), abi: 'arm64-v8a' });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as ReaError).payload;
  expect(payload.code).toBe('unsupported_target');
  expect(payload.message).toContain('unsupported ELF class');
});

test('inspect_keyed_archive: refuses a missing bundle session', async () => {
  const session = new ReaSession(runtime);
  let thrown: unknown;
  try {
    await inspectKeyedArchive(session, { path: 'archive.plist' });
  } catch (error) {
    thrown = error;
  }
  expect((thrown as ReaError).payload.code).toBe('target_unavailable');
});
