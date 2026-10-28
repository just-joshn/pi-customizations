import type * as childProcess from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect, onTestFinished, test, vi } from 'vitest';
import { inspectAssetCatalogInBundle } from '../src/analysis/asset-catalog.ts';
import { digestOf } from '../src/analysis/canonical.mjs';
import { inspectDesktopApplicationFromPath } from '../src/analysis/desktop-application.ts';
import { decodeInterfaceBuilderInBundle } from '../src/analysis/interface-builder.ts';
import { inspectKeyedArchiveFromPath, projectKeyedArchive } from '../src/analysis/keyed-archive.ts';
import { inspectMachoSignatureBytes } from '../src/analysis/macho-signature.ts';
import type { PlistValue } from '../src/analysis/plist.ts';
import { projectAppleApplicationGraph } from '../src/analysis/project-apple-application-graph.ts';
import { demangleSwiftSymbols, mapDemangleOutputs } from '../src/analysis/swift-demangle.ts';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { createEvidence } from '../src/session/evidence.ts';
import { projectAppleApplicationGraphTool } from '../src/tools/apple-graph-tools.ts';
import { inspectAssetCatalog, inspectKeyedArchive, openBundleResources } from '../src/tools/bundle-resource-tools.ts';
import { demangleSwift } from '../src/tools/demangle-tools.ts';
import { inspectDesktopApplication } from '../src/tools/desktop-application-tools.ts';
import { decodeInterfaceBuilder } from '../src/tools/interface-builder-tools.ts';
import { openBinary } from '../src/tools/session-tools.ts';
import { inspectSignature } from '../src/tools/signature-tools.ts';
import { fixturePath } from './support/fixtures.ts';
import { tempTargets } from './support/temp-targets.ts';

const spawnControl = vi.hoisted(() => ({ impl: undefined as (() => unknown) | undefined }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: unknown) => (spawnControl.impl === undefined ? actual.spawn(command, args as string[], options as never) : spawnControl.impl()),
  };
});

const payloadOf = async (run: () => unknown): Promise<ReaError['payload']> => {
  try {
    await run();
  } catch (error) {
    return (error as ReaError).payload;
  }
  throw new Error('the call returned instead of throwing');
};

const plistValue = (value: PlistValue): string => {
  if (typeof value === 'string') return `<string>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</string>`;
  if (typeof value === 'number') return `<integer>${value}</integer>`;
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
  if (Array.isArray(value)) return `<array>${value.map((entry) => plistValue(entry)).join('')}</array>`;
  const members = Object.entries(value as Record<string, PlistValue>)
    .map(([key, entry]) => `<key>${key}</key>${plistValue(entry)}`)
    .join('');
  return `<dict>${members}</dict>`;
};

const xmlPlist = (value: PlistValue): string => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">${plistValue(value)}</plist>`;

const sha256Hex = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const inventoryRecord = (normalized: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  evidence_id: 'ev_inventory',
  subject: { name: 'Fixture.app.zip', digest: { sha256: 'a'.repeat(64) }, format: 'zip', local_path: '/tmp/Fixture.app.zip' },
  normalized_result: normalized,
  ...overrides,
});

const occurrence = (logicalPath: string, sha256?: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  logical_path: logicalPath,
  ...(sha256 === undefined ? {} : { calculated_sha256: sha256 }),
  ...extra,
});

test.for([
  { name: 'missing', params: {} },
  { name: 'empty', params: { inventory_evidence: [] } },
])('project_apple_application_graph rejects a $name inventory', async ({ params }) => {
  const payload = await payloadOf(() => projectAppleApplicationGraph(params as { inventory_evidence: readonly unknown[] }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'project_apple_application_graph requires at least one inventory_evidence entry.',
    retryable: true,
    remediation: { action: 'project_apple_application_graph requires at least one inventory_evidence entry.' },
    details: {
      operation: 'project_apple_application_graph',
      parameter: 'inventory_evidence',
      issues: [{ path: ['inventory_evidence'], reason: 'out_of_range', minimum: 1 }],
    },
  });
});

test.for([
  { name: 'a string entry', entry: 'inventory', message: 'project_apple_application_graph inventory_evidence[0] must be an Evidence object.' },
  { name: 'an evidence_id without the prefix', entry: { evidence_id: 'inventory' }, message: 'project_apple_application_graph inventory_evidence[0] must carry an evidence_id.' },
])('project_apple_application_graph rejects $name', async ({ entry, message }) => {
  const payload = await payloadOf(() => projectAppleApplicationGraph({ inventory_evidence: [entry] }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message,
    details: { operation: 'project_apple_application_graph', parameter: 'inventory_evidence' },
  });
});

test('project_apple_application_graph projects zip bundle roles', () => {
  const inspection = projectAppleApplicationGraph({
    inventory_evidence: [
      inventoryRecord({
        root_artifact_sha256: 'a'.repeat(64),
        root_format: 'zip',
        collections: {
          occurrences: [
            occurrence('Fixture.app/', undefined, { is_directory: true }),
            occurrence('Fixture.app/Contents/Info.plist', 'b'.repeat(64), { artifact_id: 'art_info' }),
            occurrence('Fixture.app/Contents/MacOS/Fixture', 'c'.repeat(64)),
            occurrence('Fixture.app/Contents/_CodeSignature/CodeResources', 'd'.repeat(64)),
            occurrence('Fixture.app/Contents/Frameworks/Lib.framework', undefined, { is_directory: true }),
            occurrence('Fixture.app/Contents/Frameworks/Lib.framework/Versions/A/Lib', 'e'.repeat(64)),
            occurrence('Fixture.app/Contents/PlugIns/Ext.appex', undefined, { is_directory: true }),
            occurrence('Fixture.app/Contents/PlugIns/Ext.appex/Info.plist', '1'.repeat(64)),
            occurrence('Fixture.app/Contents/XPCServices/Helper.xpc', undefined, { is_directory: true }),
            occurrence('Fixture.app/Contents/XPCServices/Helper.xpc/Contents/Library'),
            occurrence('Fixture.app/Contents/Resources/Thing.bundle', undefined, { is_directory: true }),
            occurrence('Fixture.app/Contents/Resources/Thing.bundle/Info.plist', '2'.repeat(64)),
            occurrence('Fixture.app/Contents/Resources/Empty.bundle', undefined, { is_directory: true }),
            occurrence('Fixture.app/Contents/Resources/Empty.bundle/Info.plist'),
            occurrence('Fixture.app/Contents/Library/LaunchDaemons/com.acme.agent.plist'),
          ],
        },
      }),
    ],
  });

  expect(inspection.projection_id).toMatch(/^aap_[a-f0-9]{64}$/);
  expect(inspection).toMatchObject({
    root_sha256: 'a'.repeat(64),
    root_format: 'zip',
    platforms: ['macos'],
    source_evidence_ids: ['ev_inventory'],
    application_roots: ['Fixture.app'],
    coverage: { status: 'complete-within-inventory', inventory_complete: true },
    components: {
      executables: [],
      launchd_plists: ['Fixture.app/Contents/Library/LaunchDaemons/com.acme.agent.plist'],
    },
    unavailable_components: [],
    bridge_candidate_coverage: { status: 'complete', total_candidates: 0, emitted_candidates: 0, omitted_candidates: 0 },
  });
  expect(inspection.bundles).toStrictEqual([
    {
      path: 'Fixture.app',
      parent_path: null,
      layout: 'macos-deep',
      role: 'application',
      role_basis: 'path-convention',
      info_plist_path: 'Fixture.app/Contents/Info.plist',
      executable_candidates: [],
      signing_paths: ['Fixture.app/Contents/_CodeSignature/CodeResources'],
    },
    {
      path: 'Fixture.app/Contents/Frameworks/Lib.framework',
      parent_path: 'Fixture.app',
      layout: 'versioned-framework',
      role: 'framework',
      role_basis: 'path-convention',
      info_plist_path: null,
      executable_candidates: [],
      signing_paths: [],
    },
    {
      path: 'Fixture.app/Contents/PlugIns/Ext.appex',
      parent_path: 'Fixture.app',
      layout: 'shallow',
      role: 'app-extension',
      role_basis: 'path-convention',
      info_plist_path: 'Fixture.app/Contents/PlugIns/Ext.appex/Info.plist',
      executable_candidates: [],
      signing_paths: [],
    },
    {
      path: 'Fixture.app/Contents/Resources/Empty.bundle',
      parent_path: 'Fixture.app',
      layout: 'shallow',
      role: 'resource-bundle',
      role_basis: 'path-convention',
      info_plist_path: 'Fixture.app/Contents/Resources/Empty.bundle/Info.plist',
      executable_candidates: [],
      signing_paths: [],
    },
    {
      path: 'Fixture.app/Contents/Resources/Thing.bundle',
      parent_path: 'Fixture.app',
      layout: 'shallow',
      role: 'resource-bundle',
      role_basis: 'path-convention',
      info_plist_path: 'Fixture.app/Contents/Resources/Thing.bundle/Info.plist',
      executable_candidates: [],
      signing_paths: [],
    },
    {
      path: 'Fixture.app/Contents/XPCServices/Helper.xpc',
      parent_path: 'Fixture.app',
      layout: 'macos-deep',
      role: 'xpc-service',
      role_basis: 'path-convention',
      info_plist_path: null,
      executable_candidates: [],
      signing_paths: [],
    },
  ]);
  expect(inspection.components.bundle_metadata).toStrictEqual([
    { path: 'Fixture.app/Contents/Info.plist', artifact_id: 'art_info', sha256: 'b'.repeat(64), format: 'plist' },
    { path: 'Fixture.app/Contents/PlugIns/Ext.appex/Info.plist', artifact_id: `art_${digestOf(`member:${'1'.repeat(64)}`)}`, sha256: '1'.repeat(64), format: 'plist' },
    { path: 'Fixture.app/Contents/Resources/Empty.bundle/Info.plist', artifact_id: null, sha256: null, format: 'plist' },
    { path: 'Fixture.app/Contents/Resources/Thing.bundle/Info.plist', artifact_id: `art_${digestOf(`member:${'2'.repeat(64)}`)}`, sha256: '2'.repeat(64), format: 'plist' },
  ]);
  expect(inspection.limitations).toHaveLength(7);
});

test('project_apple_application_graph reads extension bundle roles', () => {
  const inspection = projectAppleApplicationGraph({
    inventory_evidence: [
      inventoryRecord({
        root_format: 'directory',
        collections: {
          occurrences: [
            occurrence('Fixture.app'),
            occurrence('Fixture.app/Contents/Library/LoginItems/Login.app'),
            occurrence('Fixture.app/Contents/Library/SystemExtensions/com.acme.sys.systemextension'),
            occurrence('Fixture.app/Contents/Library/DriverExtensions/com.acme.drv.dext'),
            occurrence('Fixture.app/Contents/Helpers/Help.app'),
            occurrence('Fixture.app/Contents/Resources/Nested.app'),
            occurrence('Fixture.app/Contents/PlugIns/Bundle.plugin'),
          ],
        },
      }),
    ],
  });

  expect(inspection.bundles.map((bundle) => [bundle.path, bundle.role])).toStrictEqual([
    ['Fixture.app', 'application'],
    ['Fixture.app/Contents/Helpers/Help.app', 'helper-application'],
    ['Fixture.app/Contents/Library/DriverExtensions/com.acme.drv.dext', 'driver-extension'],
    ['Fixture.app/Contents/Library/LoginItems/Login.app', 'login-item'],
    ['Fixture.app/Contents/Library/SystemExtensions/com.acme.sys.systemextension', 'system-extension'],
    ['Fixture.app/Contents/PlugIns/Bundle.plugin', 'plug-in'],
    ['Fixture.app/Contents/Resources/Nested.app', 'nested-application'],
  ]);
  expect(inspection.platforms).toStrictEqual(['macos']);
  expect(inspection.application_roots).toStrictEqual(['Fixture.app']);
});

test('project_apple_application_graph infers ios from Payload ipa roots', () => {
  const inspection = projectAppleApplicationGraph({
    inventory_evidence: [
      inventoryRecord(
        { root_format: 'ipa', collections: { occurrences: [occurrence('Payload/App.app'), occurrence('Payload/App.app/Info.plist', 'c'.repeat(64))] } },
        { subject: { name: 'App.ipa', digest: { sha256: 'f'.repeat(64) }, format: 'ipa', local_path: '/tmp/App.ipa' } },
      ),
    ],
  });

  expect(inspection.root_format).toBe('ipa');
  expect(inspection.platforms).toStrictEqual(['ios']);
  expect(inspection.bundles).toStrictEqual([
    {
      path: 'Payload/App.app',
      parent_path: null,
      layout: 'shallow',
      role: 'application',
      role_basis: 'path-convention',
      info_plist_path: 'Payload/App.app/Info.plist',
      executable_candidates: [],
      signing_paths: [],
    },
  ]);
});

test('project_apple_application_graph maps dmg roots, unknown formats', () => {
  const dmg = projectAppleApplicationGraph({
    inventory_evidence: [inventoryRecord({ root_format: 'dmg', collections: { occurrences: [occurrence('Tool.dmg')] } })],
  });
  const other = projectAppleApplicationGraph({
    inventory_evidence: [inventoryRecord({ collections: { occurrences: [occurrence('Tool.elf')] } }, { subject: undefined })],
  });

  expect(dmg.root_format).toBe('dmg');
  expect(dmg.platforms).toStrictEqual([]);
  expect(other.root_format).toBe('directory');
  expect(other.bundles).toStrictEqual([]);
  expect(other.application_roots).toStrictEqual([]);
});

test('project_apple_application_graph reads legacy row shapes', () => {
  const fromEntries = projectAppleApplicationGraph({
    inventory_evidence: [
      inventoryRecord({
        manifest: { root_sha256: '9'.repeat(64), root_format: 'directory' },
        entries: [occurrence('.'), { path: 'Tool.app', entry_kind: 'directory', artifact_id: 'art_app' }, { path: 'Tool.app/Contents/Info.plist', sha256: '7'.repeat(64) }],
      }),
    ],
  });
  const fromMembers = projectAppleApplicationGraph({
    inventory_evidence: [
      inventoryRecord({
        members: [{ relative_path: 'Tool.app', artifact_id: 'art_app' }],
        nodes: [{ artifact_id: 'art_app', sha256: '6'.repeat(64) }],
      }),
    ],
  });
  const fromResources = projectAppleApplicationGraph({
    inventory_evidence: [
      inventoryRecord(
        { resources: [{ relative_path: 'Tool.app' }, { path: 'Tool.app/Info.plist', is_directory: false }] },
        { subject: { name: 'Tool.app', digest: { sha256: '5'.repeat(64) }, format: 'app-bundle', local_path: '/tmp/Tool.app' } },
      ),
    ],
  });

  expect(fromEntries.root_sha256).toBe('9'.repeat(64));
  expect(fromEntries.root_format).toBe('directory');
  expect(fromEntries.bundles.map((bundle) => [bundle.path, bundle.layout, bundle.info_plist_path])).toStrictEqual([['Tool.app', 'macos-deep', 'Tool.app/Contents/Info.plist']]);
  expect(fromMembers.root_sha256).toBe('a'.repeat(64));
  expect(fromMembers.bundles.map((bundle) => bundle.path)).toStrictEqual(['Tool.app']);
  expect(fromResources.root_sha256).toBe('5'.repeat(64));
  expect(fromResources.bundles.map((bundle) => [bundle.path, bundle.layout, bundle.info_plist_path])).toStrictEqual([['Tool.app', 'shallow', 'Tool.app/Info.plist']]);
});

test('project_apple_application_graph reads nested inventory substeps', () => {
  const inspection = projectAppleApplicationGraph({
    inventory_evidence: [
      inventoryRecord({
        substeps: [
          {
            operation: 'inventory_artifact',
            evidence: {
              subject: { digest: { sha256: '3'.repeat(64) }, format: 'directory' },
              normalized_result: { occurrences: [occurrence('Tool.app'), occurrence('Tool.app/Contents/Info.plist', '4'.repeat(64))] },
            },
          },
        ],
      }),
    ],
  });

  expect(inspection.root_sha256).toBe('a'.repeat(64));
  expect(inspection.root_format).toBe('zip');
  expect(inspection.bundles.map((bundle) => [bundle.path, bundle.layout])).toStrictEqual([['Tool.app', 'macos-deep']]);
});

test('project_apple_application_graph hashes an empty inventory path list', () => {
  const inspection = projectAppleApplicationGraph({ inventory_evidence: [inventoryRecord(null, { subject: undefined })] });

  expect(inspection.root_sha256).toBe(digestOf('[]'));
  expect(inspection.projection_id).toBe(`aap_${digestOf(`${digestOf('[]')}:ev_inventory`)}`);
  expect(inspection).toMatchObject({ root_format: 'directory', platforms: [], application_roots: [] });
});

const machoBe32 = (value: number, target: Buffer, offset: number): void => {
  target.writeUInt32BE(value >>> 0, offset);
};

const superBlob = (entries: readonly { readonly type: number; readonly body: Buffer }[]): Buffer => {
  const headerLength = 12 + entries.length * 8;
  let cursor = headerLength;
  const offsets: number[] = [];
  for (const entry of entries) {
    offsets.push(cursor);
    cursor += entry.body.length;
  }
  const bytes = Buffer.alloc(cursor);
  machoBe32(0xfade0cc0, bytes, 0);
  machoBe32(cursor, bytes, 4);
  machoBe32(entries.length, bytes, 8);
  entries.forEach((entry, index) => {
    machoBe32(entry.type, bytes, 12 + index * 8);
    machoBe32(offsets[index] ?? 0, bytes, 16 + index * 8);
  });
  entries.forEach((entry, index) => {
    entry.body.copy(bytes, offsets[index] ?? 0);
  });
  return bytes;
};

const codeDirectory = (options: { readonly hashType?: number; readonly version?: number; readonly flags?: number; readonly identifier?: string | null; readonly team?: string | null } = {}): Buffer => {
  const version = options.version ?? 0x20200;
  const identifier = options.identifier === undefined ? 'com.example.app' : options.identifier;
  const team = options.team ?? null;
  const identifierBytes = identifier === null ? Buffer.alloc(0) : Buffer.from(`${identifier}\0`, 'utf8');
  const teamBytes = team === null ? Buffer.alloc(0) : Buffer.from(`${team}\0`, 'utf8');
  const headerSize = version >= 0x20200 ? 52 : 44;
  const length = headerSize + identifierBytes.length + teamBytes.length;
  const bytes = Buffer.alloc(length);
  machoBe32(0xfade0c02, bytes, 0);
  machoBe32(length, bytes, 4);
  machoBe32(version, bytes, 8);
  machoBe32(options.flags ?? 0, bytes, 12);
  machoBe32(0, bytes, 16);
  machoBe32(identifierBytes.length === 0 ? 0 : headerSize, bytes, 20);
  machoBe32(0, bytes, 24);
  machoBe32(1, bytes, 28);
  machoBe32(4096, bytes, 32);
  bytes[36] = 32;
  bytes[37] = options.hashType ?? 2;
  bytes[38] = 0;
  bytes[39] = 12;
  machoBe32(0, bytes, 40);
  if (headerSize === 52) machoBe32(teamBytes.length === 0 ? 0 : headerSize + identifierBytes.length, bytes, 48);
  identifierBytes.copy(bytes, headerSize);
  teamBytes.copy(bytes, headerSize + identifierBytes.length);
  return bytes;
};

const entitlementsBlob = (payload: Buffer): Buffer => {
  const bytes = Buffer.alloc(8 + payload.length);
  machoBe32(0xfade7171, bytes, 0);
  machoBe32(bytes.length, bytes, 4);
  payload.copy(bytes, 8);
  return bytes;
};

const thinMacho = (signature: Buffer | null, options: { readonly bits?: 32 | 64; readonly little?: boolean; readonly cpuType?: number; readonly cpuSubtype?: number } = {}): Buffer => {
  const bits = options.bits ?? 64;
  const little = options.little ?? true;
  const headerSize = bits === 64 ? 32 : 28;
  const commandSize = 16;
  const dataoff = headerSize + commandSize;
  const header = Buffer.alloc(headerSize);
  const writeHeader = (value: number, offset: number): void => {
    if (little) header.writeUInt32LE(value >>> 0, offset);
    else header.writeUInt32BE(value >>> 0, offset);
  };
  writeHeader(bits === 64 ? 0xfeedfacf : 0xfeedface, 0);
  writeHeader(options.cpuType ?? 0x0100000c, 4);
  writeHeader(options.cpuSubtype ?? 0, 8);
  writeHeader(2, 12);
  writeHeader(signature === null ? 0 : 1, 16);
  writeHeader(signature === null ? 0 : commandSize, 20);
  if (signature === null) return header;
  const command = Buffer.alloc(commandSize);
  const writeCommand = (value: number, offset: number): void => {
    if (little) command.writeUInt32LE(value >>> 0, offset);
    else command.writeUInt32BE(value >>> 0, offset);
  };
  writeCommand(0x1d, 0);
  writeCommand(commandSize, 4);
  writeCommand(dataoff, 8);
  writeCommand(signature.length, 12);
  return Buffer.concat([header, command, signature]);
};

const fatMacho = (slice: Buffer, options: { readonly little?: boolean; readonly cpuType?: number; readonly cpuSubtype?: number; readonly declaredSize?: number } = {}): Buffer => {
  const little = options.little ?? false;
  const header = Buffer.alloc(32);
  const writeHeader = (value: number, offset: number): void => {
    if (little) header.writeUInt32LE(value >>> 0, offset);
    else header.writeUInt32BE(value >>> 0, offset);
  };
  writeHeader(0xcafebabe, 0);
  writeHeader(1, 4);
  writeHeader(options.cpuType ?? 0x0100000c, 8);
  writeHeader(options.cpuSubtype ?? 0, 12);
  writeHeader(32, 16);
  writeHeader(options.declaredSize ?? slice.length, 20);
  writeHeader(0, 24);
  return Buffer.concat([header, slice]);
};

const cdhashOf = (bytes: Buffer, algorithm: 'sha1' | 'sha256' | 'sha384'): string => createHash(algorithm).update(bytes).digest('hex').slice(0, 40);

test('inspectMachoSignatureBytes reports an image with no signature', () => {
  const inspection = inspectMachoSignatureBytes(thinMacho(null));

  expect(inspection).toStrictEqual({
    signed: false,
    identifier: null,
    team_identifier: null,
    format: null,
    cdhashes: [],
    hash_algorithms: [],
    authorities: [],
    designated_requirement: null,
    entitlements: null,
    timestamp: null,
    hardened_runtime: null,
    provenance: [],
    limitations: ['Inspected a digest-verified Mach-O byte snapshot; filesystem-bound signing context and trust validation are not examined.', 'No LC_CODE_SIGNATURE load command was present on the inspected image.'],
  });
});

test('inspectMachoSignatureBytes rejects bytes shorter than a fat header', () => {
  const inspection = inspectMachoSignatureBytes(Buffer.alloc(16, 0xff));

  expect(inspection.format).toBeNull();
  expect(inspection.limitations[1]).toBe('No LC_CODE_SIGNATURE load command was present on the inspected image.');
});

test('inspectMachoSignatureBytes decodes a hardened signature', () => {
  const directory = codeDirectory({ hashType: 2, flags: 0x10000, identifier: 'com.example.app', team: 'TEAMID' });
  const entitlements = entitlementsBlob(Buffer.from(xmlPlist({ 'application-identifier': 'A.B' }), 'utf8'));
  const inspection = inspectMachoSignatureBytes(
    thinMacho(
      superBlob([
        { type: 0, body: directory },
        { type: 5, body: entitlements },
      ]),
    ),
  );

  expect(inspection).toStrictEqual({
    signed: true,
    identifier: 'com.example.app',
    team_identifier: 'TEAMID',
    format: 'Mach-O thin (arm64)',
    cdhashes: [cdhashOf(directory, 'sha256')],
    hash_algorithms: ['sha256'],
    authorities: [],
    designated_requirement: `cdhash H"${cdhashOf(directory, 'sha256')}"`,
    entitlements: { 'application-identifier': 'A.B' },
    timestamp: null,
    hardened_runtime: true,
    provenance: [],
    limitations: ['Inspected a digest-verified Mach-O byte snapshot; filesystem-bound signing context and trust validation are not examined.'],
  });
});

test.for([
  { name: 'sha1', hashType: 1, algorithm: 'sha1' as const, name_: 'sha1' },
  { name: 'sha384', hashType: 4, algorithm: 'sha384' as const, name_: 'sha384' },
])('inspectMachoSignatureBytes names the $name code directory digest', ({ hashType, algorithm, name_ }) => {
  const directory = codeDirectory({ hashType, version: 0x20001, identifier: 'tool', team: null });
  const inspection = inspectMachoSignatureBytes(thinMacho(superBlob([{ type: 0, body: directory }])));

  expect(inspection.cdhashes).toStrictEqual([cdhashOf(directory, algorithm)]);
  expect(inspection.hash_algorithms).toStrictEqual([name_]);
  expect(inspection.hardened_runtime).toBe(false);
  expect(inspection.team_identifier).toBeNull();
});

test('inspectMachoSignatureBytes prefers sha256 code directories', () => {
  const sha1 = codeDirectory({ hashType: 1, version: 0x20001, identifier: 'com.example.app' });
  const sha256 = codeDirectory({ hashType: 3 });
  const ranked = inspectMachoSignatureBytes(
    thinMacho(
      superBlob([
        { type: 0, body: sha1 },
        { type: 0, body: sha256 },
      ]),
    ),
  );
  const unknown = inspectMachoSignatureBytes(thinMacho(superBlob([{ type: 0, body: codeDirectory({ hashType: 5 }) }])));
  const absent = inspectMachoSignatureBytes(thinMacho(superBlob([{ type: 0, body: codeDirectory({ hashType: 0 }) }])));

  expect(ranked.cdhashes).toStrictEqual([cdhashOf(sha256, 'sha256')]);
  expect(ranked.hash_algorithms).toStrictEqual(['sha256']);
  expect(unknown.hash_algorithms).toStrictEqual(['hash-type-5']);
  expect(absent.hash_algorithms).toStrictEqual([]);
});

test('inspectMachoSignatureBytes reports an empty signature region', () => {
  const inspection = inspectMachoSignatureBytes(thinMacho(Buffer.alloc(0)));

  expect(inspection.signed).toBe(false);
  expect(inspection.format).toBeNull();
  expect(inspection.limitations[1]).toBe('No LC_CODE_SIGNATURE load command was present on the inspected image.');
});

test('inspectMachoSignatureBytes reports a signature offset past the file end', () => {
  const image = thinMacho(superBlob([{ type: 0, body: codeDirectory() }]));

  const inspection = inspectMachoSignatureBytes(image.subarray(0, image.length - 32));

  expect(inspection.format).toBe('Mach-O thin (arm64)');
  expect(inspection.limitations[1]).toBe('LC_CODE_SIGNATURE points past the end of the file.');
});

test.for([
  {
    name: 'a foreign magic',
    signature: Buffer.alloc(16, 0),
    reason: 'The code-signature region is not an embedded SuperBlob.',
  },
  {
    name: 'a declared length beyond the region',
    signature: Buffer.concat([Buffer.from([0xfa, 0xde, 0x0c, 0xc0, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00])]),
    reason: 'The code-signature region is not an embedded SuperBlob.',
  },
  {
    name: 'more than 256 blob entries',
    signature: Buffer.concat([Buffer.from([0xfa, 0xde, 0x0c, 0xc0, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x01, 0x2c])]),
    reason: 'The code-signature region is not an embedded SuperBlob.',
  },
  {
    name: 'no parseable code directory',
    signature: superBlob([{ type: 0, body: Buffer.from('not a code directory') }]),
    reason: 'The SuperBlob contains no parseable CodeDirectory.',
  },
])('inspectMachoSignatureBytes rejects a SuperBlob with $name', ({ signature, reason }) => {
  const inspection = inspectMachoSignatureBytes(thinMacho(signature));

  expect(inspection.signed).toBe(false);
  expect(inspection.limitations[1]).toBe(reason);
});

test('inspectMachoSignatureBytes skips blob entries outside the region', () => {
  const directory = codeDirectory();
  const blob = superBlob([{ type: 0, body: directory }]);
  machoBe32(64, blob, 16);

  const inspection = inspectMachoSignatureBytes(thinMacho(blob));

  expect(inspection.signed).toBe(false);
  expect(inspection.limitations[1]).toBe('The SuperBlob contains no parseable CodeDirectory.');
});

test('inspectMachoSignatureBytes ignores an unparseable entitlements blob', () => {
  const directory = codeDirectory();
  const truncated = Buffer.alloc(6);
  machoBe32(0xfade7171, truncated, 0);
  truncated.writeUInt16BE(2, 4);
  const inspection = inspectMachoSignatureBytes(
    thinMacho(
      superBlob([
        { type: 5, body: truncated },
        { type: 0, body: directory },
      ]),
    ),
  );
  const unreadable = inspectMachoSignatureBytes(
    thinMacho(
      superBlob([
        { type: 5, body: entitlementsBlob(Buffer.from('not a plist')) },
        { type: 0, body: directory },
      ]),
    ),
  );

  expect(inspection.entitlements).toBeNull();
  expect(inspection.signed).toBe(true);
  expect(unreadable.entitlements).toBeNull();
});

test('inspectMachoSignatureBytes keeps a directory without identity', () => {
  const directory = codeDirectory({ identifier: null, team: null });
  const inspection = inspectMachoSignatureBytes(thinMacho(superBlob([{ type: 0, body: directory }])));

  expect(inspection.identifier).toBeNull();
  expect(inspection.team_identifier).toBeNull();
  expect(inspection.signed).toBe(true);
});

test('inspectMachoSignatureBytes reports a thin format for a big-endian image', () => {
  const directory = codeDirectory();
  const inspection = inspectMachoSignatureBytes(thinMacho(superBlob([{ type: 0, body: directory }]), { little: false, cpuType: 0x01000007 }));

  expect(inspection.format).toBe('Mach-O thin (x86_64)');
  expect(inspection.signed).toBe(true);
});

test('inspectMachoSignatureBytes reports a 32-bit thin format', () => {
  const inspection = inspectMachoSignatureBytes(thinMacho(superBlob([{ type: 0, body: codeDirectory() }]), { bits: 32, cpuType: 7 }));

  expect(inspection.format).toBe('Mach-O thin (x86)');
});

test('inspectMachoSignatureBytes resolves a slice inside a universal image', () => {
  const directory = codeDirectory();
  const slice = thinMacho(superBlob([{ type: 0, body: directory }]));
  const inspection = inspectMachoSignatureBytes(fatMacho(slice));

  expect(inspection.format).toBe('Mach-O universal (arm64)');
  expect(inspection.signed).toBe(true);
  expect(inspection.cdhashes).toStrictEqual([cdhashOf(directory, 'sha256')]);
});

test('inspectMachoSignatureBytes reads a little-endian universal header', () => {
  const slice = thinMacho(superBlob([{ type: 0, body: codeDirectory() }]));
  const inspection = inspectMachoSignatureBytes(fatMacho(slice, { little: true, cpuType: 0x01000007 }));

  expect(inspection.format).toBe('Mach-O universal (x86_64)');
  expect(inspection.signed).toBe(true);
});

test('inspectMachoSignatureBytes ignores a universal slice past the file end', () => {
  const slice = thinMacho(superBlob([{ type: 0, body: codeDirectory() }]));
  const inspection = inspectMachoSignatureBytes(fatMacho(slice, { declaredSize: slice.length + 64 }));

  expect(inspection.signed).toBe(false);
  expect(inspection.limitations[1]).toBe('No LC_CODE_SIGNATURE load command was present on the inspected image.');
});

const keyedValue = (objects: readonly PlistValue[], top?: PlistValue): PlistValue => ({
  $archiver: 'NSKeyedArchiver',
  $version: 100_000,
  $objects: [...objects],
  ...(top === undefined ? {} : { $top: top }),
});

const projectArchive = (value: PlistValue, selection: { readonly root?: string; readonly offset?: number; readonly limit?: number } = {}): ReturnType<typeof projectKeyedArchive> =>
  projectKeyedArchive({ format: 'xml', value }, '/tmp/archive.plist', 'f'.repeat(64), {
    ...(selection.root === undefined ? {} : { root: selection.root }),
    offset: selection.offset ?? 0,
    limit: selection.limit ?? 20_000,
  });

test('inspectKeyedArchiveFromPath projects the NSKeyedArchiver fixture', async () => {
  const path = fixturePath('targets/bundle/Fixture.app/Contents/Resources/archive.plist');
  const bytes = readFileSync(path);
  const { record, resolvedPath } = await inspectKeyedArchiveFromPath(path);

  expect(resolvedPath).toBe(realpathSync(path));
  expect(record).toStrictEqual({
    target_sha256: null,
    archive_path: realpathSync(path),
    archive_sha256: sha256Hex(bytes),
    archive_format: 'xml-plist',
    roots: { root: { CF$UID: 1 } },
    objects: [
      { id: 0, kind: 'nil', class_id: null, class_name: null, status: 'nil', value: '$null' },
      {
        id: 1,
        kind: 'archived-object',
        class_id: 2,
        class_name: 'NSObject',
        status: 'unknown-class',
        value: { $class: { CF$UID: 2 }, name: 'demo' },
      },
      {
        id: 2,
        kind: 'class-descriptor',
        class_id: null,
        class_name: null,
        status: 'observed',
        value: { $classname: 'NSObject', $classes: ['NSObject'] },
      },
    ],
    references: [
      { source: null, path: ['root'], target: 1, status: 'resolved', raw: { CF$UID: 1 } },
      { source: 1, path: ['$class'], target: 2, status: 'resolved', raw: { CF$UID: 2 } },
    ],
    total_objects: 3,
    total_references: 2,
    offset: 0,
    next_offset: null,
    truncated: false,
    limitations: [
      'Archive classes are never instantiated. Class names and serialized fields are observed; class-specific semantics are unknown.',
      'Conditional references serialized as UID 0 cannot be distinguished from ordinary nil references. Missing fields remain absent in the raw serialized value.',
      'Root selection selects the named $top entry; object pagination retains original indices and does not recursively expand references.',
    ],
  });
});

test('inspectKeyedArchiveFromPath pages objects by offset, limit', async () => {
  const path = fixturePath('targets/bundle/Fixture.app/Contents/Resources/archive.plist');
  const first = await inspectKeyedArchiveFromPath(path, { offset: 0, limit: 1 });
  const second = await inspectKeyedArchiveFromPath(path, { offset: 1, limit: 1 });

  expect(first.record.objects.map((object) => object.id)).toStrictEqual([0]);
  expect(first.record.next_offset).toBe(1);
  expect(first.record.truncated).toBe(true);
  expect(second.record.objects.map((object) => object.id)).toStrictEqual([1]);
  expect(second.record.next_offset).toBe(2);
  expect(second.record.total_references).toBe(2);
});

test('inspectKeyedArchiveFromPath selects a named root or every root', async () => {
  const path = fixturePath('targets/bundle/Fixture.app/Contents/Resources/archive.plist');
  const named = await inspectKeyedArchiveFromPath(path, { root: 'root' });
  const missing = await inspectKeyedArchiveFromPath(path, { root: 'absent' });

  expect(named.record.roots).toStrictEqual({ root: { CF$UID: 1 } });
  expect(named.record.total_references).toBe(2);
  expect(missing.record.roots).toStrictEqual({});
  expect(missing.record.total_references).toBe(1);
  expect(missing.record.total_objects).toBe(3);
});

test('inspectKeyedArchiveFromPath resolves a relative path against its cwd', async () => {
  const targets = await tempTargets();
  await targets.write('archive.plist', readFileSync(fixturePath('targets/bundle/Fixture.app/Contents/Resources/archive.plist')));

  const { record, resolvedPath } = await inspectKeyedArchiveFromPath('archive.plist', { cwd: targets.dir });

  expect(resolvedPath).toBe(realpathSync(join(targets.dir, 'archive.plist')));
  expect(record.archive_format).toBe('xml-plist');
});

test.for([
  { name: 'an unreadable path', name_: 'it could not be read' },
  { name: 'non-plist bytes', name_: 'it is not a property list' },
])('inspectKeyedArchiveFromPath reports $name', async ({ name_ }) => {
  const targets = await tempTargets();
  const path = name_ === 'it could not be read' ? join(targets.dir, 'absent.plist') : await targets.write('bad.plist', 'not a property list');

  const payload = await payloadOf(() => inspectKeyedArchiveFromPath(path));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'The inspection input is not usable. Check the argument and retry.',
    details: {
      operation: 'inspect_keyed_archive',
      issues: [{ path: ['path'], reason: 'invalid_value', message: expect.stringContaining(name_) }],
    },
  });
});

test.for([
  { name: 'an array root', value: ['x'] as PlistValue, detail: 'its root is not a dictionary' },
  { name: 'a foreign archiver', value: { $archiver: 'NSKeyedUnarchiver' } as PlistValue, detail: 'its $archiver is "NSKeyedUnarchiver"' },
  { name: 'no archiver key', value: { $objects: [] } as PlistValue, detail: 'it is not an NSKeyedArchiver plist' },
  { name: 'no object table', value: { $archiver: 'NSKeyedArchiver' } as PlistValue, detail: 'it has no $objects array' },
])('projectKeyedArchive rejects a plist with $name', async ({ value, detail }) => {
  const payload = await payloadOf(() => projectKeyedArchive({ format: 'xml', value }, '/tmp/archive.plist', 'f'.repeat(64), { offset: 0, limit: 20_000 }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    details: {
      operation: 'inspect_keyed_archive',
      issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect /tmp/archive.plist: ${detail}` }],
    },
  });
});

const classDescriptor: PlistValue = { $classname: 'Thing', $classes: ['Thing', 'NSObject'] };

test.for([
  { name: 'a null string', value: null as PlistValue, expected: { kind: 'nil', status: 'nil', class_id: null, class_name: null, value: '$null' } },
  { name: 'the null placeholder', value: 'null' as PlistValue, expected: { kind: 'nil', status: 'nil', class_id: null, class_name: null, value: '$null' } },
  { name: 'an array', value: [1, 'x'] as PlistValue, expected: { kind: 'array', status: 'observed', class_id: null, class_name: null, value: [1, 'x'] } },
  { name: 'a scalar', value: 7 as PlistValue, expected: { kind: 'scalar', status: 'observed', class_id: null, class_name: null, value: 7 } },
  { name: 'a class name descriptor', value: { $classname: 'Thing' } as PlistValue, expected: { kind: 'class-descriptor', status: 'observed', class_id: null, class_name: null, value: { $classname: 'Thing' } } },
  { name: 'a class chain descriptor', value: { $classes: ['Thing'] } as PlistValue, expected: { kind: 'class-descriptor', status: 'observed', class_id: null, class_name: null, value: { $classes: ['Thing'] } } },
  {
    name: 'an archived object',
    value: { $class: { CF$UID: 0 } } as PlistValue,
    expected: { kind: 'archived-object', status: 'unknown-class', class_id: 0, class_name: 'Thing', value: { $class: { CF$UID: 0 } } },
  },
  {
    name: 'a UID archived object',
    value: { $class: { UID: 0 } } as PlistValue,
    expected: { kind: 'archived-object', status: 'unknown-class', class_id: 0, class_name: 'Thing', value: { $class: { UID: 0 } } },
  },
  {
    name: 'an unresolved class',
    value: { $class: { CF$UID: 40 } } as PlistValue,
    expected: { kind: 'archived-object', status: 'unresolved-class', class_id: 40, class_name: null, value: { $class: { CF$UID: 40 } } },
  },
  { name: 'a plain dictionary', value: { name: 'x' } as PlistValue, expected: { kind: 'dictionary', status: 'observed', class_id: null, class_name: null, value: { name: 'x' } } },
])('projectKeyedArchive classifies $name object', async ({ value, expected }) => {
  const record = projectArchive(keyedValue([classDescriptor, value]));

  expect(record.objects[1]).toStrictEqual({ id: 1, ...expected });
});

test('projectKeyedArchive records nil, unresolved references', () => {
  const record = projectArchive(keyedValue(['$null', { list: [{ CF$UID: 0 }, { CF$UID: 9 }] }], { first: { CF$UID: 1 }, second: { CF$UID: 0 } }));

  expect(record.references).toStrictEqual([
    { source: null, path: ['first'], target: 1, status: 'resolved', raw: { CF$UID: 1 } },
    { source: null, path: ['second'], target: 0, status: 'nil', raw: { CF$UID: 0 } },
    { source: 1, path: ['list', 0], target: 0, status: 'nil', raw: { CF$UID: 0 } },
    { source: 1, path: ['list', 1], target: null, status: 'unresolved', raw: { CF$UID: 9 } },
  ]);
  expect(record.total_references).toBe(4);
});

test('projectKeyedArchive reports a binary plist archive format', () => {
  const record = projectKeyedArchive({ format: 'binary', value: keyedValue(['$null']) }, '/tmp/archive.plist', 'f'.repeat(64), { offset: 0, limit: 20_000 });

  expect(record.archive_format).toBe('binary-plist');
  expect(record.roots).toStrictEqual({});
  expect(record.total_objects).toBe(1);
});

test('projectKeyedArchive keeps index ids for a paged object table', () => {
  const record = projectArchive(keyedValue(['$null', 'first', 'second', 'third']), { offset: 1, limit: 2 });

  expect(record.objects.map((object) => object.id)).toStrictEqual([1, 2]);
  expect(record.next_offset).toBe(3);
  expect(record.truncated).toBe(true);
  expect(record.total_objects).toBe(4);
});

test('inspectAssetCatalogInBundle digests the fixture Assets.car', async () => {
  const root = fixturePath('targets/bundle/Fixture.app');
  const catalogPath = join(root, 'Contents/Resources/Assets.car');
  const bytes = readFileSync(catalogPath);

  const inspection = await inspectAssetCatalogInBundle(root);

  expect(inspection).toStrictEqual({
    resource_root: { caller_path: root, canonical_path: realpathSync(root) },
    catalogs: [{ path: catalogPath, bytes: 64, sha256: sha256Hex(bytes), header_magic: 'boms', header_version: 1 }],
    renditions: [],
    offset: 0,
    next_offset: null,
    truncated: false,
    limitations: [
      'Assets.car files are located and digested; rendition metadata is not decoded because pi-rea does not run assetutil or an equivalent CAR decoder.',
      'An empty renditions array means coverage is incomplete, not that the catalog has no assets.',
    ],
  });
});

test('inspectAssetCatalogInBundle reports a bundle without catalogs', async () => {
  const targets = await tempTargets();

  const inspection = await inspectAssetCatalogInBundle(targets.dir);

  expect(inspection.catalogs).toStrictEqual([]);
  expect(inspection.resource_root).toStrictEqual({ caller_path: targets.dir, canonical_path: realpathSync(targets.dir) });
  expect(inspection.limitations).toStrictEqual([
    'Assets.car files are located and digested; rendition metadata is not decoded because pi-rea does not run assetutil or an equivalent CAR decoder.',
    'An empty renditions array means coverage is incomplete, not that the catalog has no assets.',
    'No Assets.car file was found under the open bundle root.',
  ]);
  expect(inspection.truncated).toBe(false);
});

test('inspectAssetCatalogInBundle pages multiple catalogs', async () => {
  const targets = await tempTargets();
  mkdirSync(join(targets.dir, 'a'));
  mkdirSync(join(targets.dir, 'b'));
  await targets.write(join('a', 'Assets.car'), Buffer.from('boms\x01\x00\x00\x00', 'latin1'));
  await targets.write(join('b', 'Assets.car'), Buffer.from('boms\x02\x00\x00\x00', 'latin1'));

  const all = await inspectAssetCatalogInBundle(targets.dir);
  const page = await inspectAssetCatalogInBundle(targets.dir, { offset: 0, limit: 1 });
  const tail = await inspectAssetCatalogInBundle(targets.dir, { offset: 1, limit: 1 });

  const canonicalRoot = realpathSync(targets.dir);
  expect(all.catalogs.map((catalog) => catalog.path).sort()).toStrictEqual([join(canonicalRoot, 'a', 'Assets.car'), join(canonicalRoot, 'b', 'Assets.car')]);
  expect(all.next_offset).toBeNull();
  expect(page.catalogs).toHaveLength(1);
  expect(page.next_offset).toBe(1);
  expect(page.truncated).toBe(true);
  expect(tail.catalogs).toHaveLength(1);
  expect(tail.next_offset).toBeNull();
  expect(tail.truncated).toBe(false);
  expect(all.catalogs.map((catalog) => catalog.header_version).sort()).toStrictEqual([1, 2]);
});

test.for([
  { name: 'a two byte catalog', bytes: Buffer.from('bo', 'latin1'), magic: null, version: null },
  { name: 'a six byte catalog', bytes: Buffer.from('boms\x01\x00', 'latin1'), magic: 'boms', version: null },
])('inspectAssetCatalogInBundle reads $name header tolerantly', async ({ bytes, magic, version }) => {
  const targets = await tempTargets();
  mkdirSync(join(targets.dir, 'res'));
  await targets.write(join('res', 'Assets.car'), bytes);

  const inspection = await inspectAssetCatalogInBundle(targets.dir);

  expect(inspection.catalogs[0]).toMatchObject({ bytes: bytes.length, header_magic: magic, header_version: version });
});

test.for([
  { name: 'a missing root', message: 'Cannot inspect bundle root:' },
  { name: 'a file root', message: 'The open bundle resource root is not a directory.' },
])('inspectAssetCatalogInBundle rejects $name', async ({ name, message }) => {
  const targets = await tempTargets();
  const root = name === 'a missing root' ? join(targets.dir, 'absent') : await targets.write('plain.txt', 'x');

  const payload = await payloadOf(() => inspectAssetCatalogInBundle(root));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'The inspection input is not usable. Check the argument and retry.',
    details: { operation: 'inspect_asset_catalog', issues: [{ path: [], reason: 'invalid_value', message: expect.stringContaining(message) }] },
  });
});

const writeTree = async (files: Readonly<Record<string, string | Buffer>>): Promise<string> => {
  const targets = await tempTargets();
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(targets.dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return targets.dir;
};

const nibArchive = (objectCount: number): Buffer => {
  const bytes = Buffer.alloc(18);
  bytes.set(Buffer.from('NIBArchive', 'latin1'), 0);
  bytes.writeUInt32LE(objectCount, 14);
  return bytes;
};

const classArchiveObjects: readonly PlistValue[] = [
  '$null',
  { $class: { CF$UID: 16 }, label: 'Title' },
  { $class: { CF$UID: 17 }, title: 'OK' },
  { $class: { CF$UID: 18 }, identifier: 'view-1' },
  { $class: { CF$UID: 19 }, accessibilityLabel: 'a11y' },
  { $class: { CF$UID: 20 } },
  { $class: { CF$UID: 21 } },
  { $class: { CF$UID: 22 } },
  { $class: { CF$UID: 23 } },
  { $class: { CF$UID: 24 } },
  { $class: { CF$UID: 25 } },
  { $class: { CF$UID: 26 } },
  { $class: { CF$UID: 27 } },
  { $class: { CF$UID: 28 } },
  { $class: { CF$UID: 29 } },
  { $class: { CF$UID: 40 } },
  { $classname: 'UIViewController', $classes: ['UIViewController', 'UIResponder'] },
  { $classname: 'UIControl', $classes: ['UIControl', 'UIView'] },
  { $classname: 'UIView', $classes: ['UIView'] },
  { $classname: 'NSLayoutConstraint', $classes: ['NSLayoutConstraint'] },
  { $classname: 'UILayoutGuide', $classes: ['UILayoutGuide'] },
  { $classname: 'UIPlaceholder', $classes: ['UIPlaceholder'] },
  { $classname: 'UIExternalObject', $classes: ['UIExternalObject'] },
  { $classname: 'MyWindowController', $classes: ['MyWindowController'] },
  { $classname: 'UISlider', $classes: ['UISlider'] },
  { $classname: 'UITableViewCell', $classes: ['UITableViewCell'] },
  { $classname: 'UIImage', $classes: ['UIImage'] },
  { $classname: 'MysteryThing', $classes: ['MysteryThing'] },
  { $classname: 'NSMenuConnector', $classes: ['NSMenuConnector'] },
  { $classes: ['NSNibConnector', 5] },
];

const classArchive = (): PlistValue => keyedValue(classArchiveObjects, { UINibTopLevelObjectsKey: [{ CF$UID: 1 }, { CF$UID: 99 }, { CF$UID: 0 }, 'text'] });

test('decodeInterfaceBuilderInBundle projects the fixture nib graph', async () => {
  const root = fixturePath('targets/bundle/Fixture.app');
  const nibPath = 'Contents/Resources/Base.lproj/MainMenu.nib';
  const nibSha = sha256Hex(readFileSync(join(root, nibPath)));

  const inspection = await decodeInterfaceBuilderInBundle(root);

  expect(inspection.resource_root).toStrictEqual({
    caller_path: root,
    canonical_path: realpathSync(root),
    info_plist_path: null,
    layout: 'contents',
    executable_sha256: null,
  });
  expect(inspection.target_sha256).toBeNull();
  expect(inspection.documents).toStrictEqual([{ relative_path: nibPath, archive_sha256: nibSha, document_kind: 'nib', object_count: 1, connection_count: 0, hierarchy_complete: true }]);
  expect(inspection.graph.provider).toStrictEqual({ id: 'rea-artifact-graph', version: '1', tool_version: 'rea-interface-builder/1' });
  expect(inspection.graph.nodes.map((node) => [node.kind, node.name])).toStrictEqual([
    ['scene', nibPath],
    ['unknown', 'NSObject'],
  ]);
  const objectNodeId = inspection.graph.nodes[1]?.id;
  expect(inspection.graph.edges.map((edge) => [edge.from === inspection.graph.nodes[0]?.id, edge.to, edge.relation, edge.resolution, edge.limitations])).toStrictEqual([[true, objectNodeId, 'contains', 'observed', []]]);
  expect(inspection.graph.coverage).toStrictEqual([
    { facet: `objects:${nibPath}`, status: 'complete', reason: null, examined: 1, omitted: 0 },
    { facet: `connections:${nibPath}`, status: 'complete', reason: null, examined: 0, omitted: 0 },
    { facet: `hierarchy:${nibPath}`, status: 'complete', reason: null, examined: 1, omitted: 0 },
    { facet: `classes:${nibPath}`, status: 'complete', reason: null, examined: 1, omitted: 0 },
    { facet: 'archive_decode', status: 'complete', reason: null, examined: 1, omitted: 0 },
  ]);
  expect(inspection.graph.truncated).toBe(false);
  expect(inspection.graph.target_sha256).toBeNull();
  expect(inspection.limitations).toHaveLength(3);
});

test('decodeInterfaceBuilderInBundle classifies archived object kinds', async () => {
  const root = await writeTree({ 'Contents/Resources/Main.nib': xmlPlist(classArchive()) });

  const inspection = await decodeInterfaceBuilderInBundle(root);
  const nodes = inspection.graph.nodes.filter((node) => node.kind !== 'scene');

  expect(nodes.map((node) => [node.attributes['interface_builder_object_id'], node.kind, node.name])).toStrictEqual([
    ['1', 'view_controller', 'Title'],
    ['2', 'control', 'OK'],
    ['3', 'view', 'view-1'],
    ['4', 'constraint', 'a11y'],
    ['5', 'layout_guide', 'UILayoutGuide'],
    ['6', 'placeholder', 'UIPlaceholder'],
    ['7', 'external_object', 'UIExternalObject'],
    ['8', 'view_controller', 'MyWindowController'],
    ['9', 'control', 'UISlider'],
    ['10', 'view', 'UITableViewCell'],
    ['11', 'resource', 'UIImage'],
    ['12', 'unknown', 'MysteryThing'],
    ['13', 'unknown', 'NSMenuConnector'],
    ['14', 'unknown', 'object 14'],
    ['15', 'unknown', 'object 15'],
  ]);
  expect(inspection.documents[0]).toMatchObject({ object_count: 15, hierarchy_complete: true });
  expect(inspection.graph.coverage.filter((facet) => facet.facet.startsWith('classes:'))[0]).toStrictEqual({
    facet: 'classes:Contents/Resources/Main.nib',
    status: 'complete',
    reason: null,
    examined: 14,
    omitted: 0,
  });
  expect(inspection.graph.edges).toHaveLength(1);
});

test('decodeInterfaceBuilderInBundle reports an undecoded archive hierarchy', async () => {
  const root = await writeTree({
    'Contents/Resources/Topless.nib': xmlPlist(keyedValue(['$null', { $class: { CF$UID: 2 } }, { $classname: 'UIView', $classes: ['UIView'] }])),
    'Contents/Resources/OddTop.nib': xmlPlist(keyedValue(['$null'], '$null')),
  });

  const inspection = await decodeInterfaceBuilderInBundle(root);
  const facets = inspection.graph.coverage.filter((facet) => facet.facet.startsWith('hierarchy:'));

  expect(inspection.documents.map((document) => [document.relative_path, document.hierarchy_complete])).toStrictEqual([
    ['Contents/Resources/OddTop.nib', false],
    ['Contents/Resources/Topless.nib', false],
  ]);
  expect(facets.map((facet) => [facet.status, facet.reason])).toStrictEqual([
    ['unsupported', 'archive_hierarchy_not_decoded'],
    ['unsupported', 'archive_hierarchy_not_decoded'],
  ]);
  expect(inspection.graph.edges).toStrictEqual([]);
});

test('decodeInterfaceBuilderInBundle summarizes a raw NIBArchive body', async () => {
  const root = await writeTree({ 'Contents/Resources/Main.nib': nibArchive(7) });

  const inspection = await decodeInterfaceBuilderInBundle(root);

  expect(inspection.documents).toStrictEqual([{ relative_path: 'Contents/Resources/Main.nib', archive_sha256: sha256Hex(nibArchive(7)), document_kind: 'nib', object_count: 7, connection_count: 0, hierarchy_complete: false }]);
  expect(inspection.graph.nodes.map((node) => [node.kind, node.attributes])).toStrictEqual([['scene', { document_kind: 'nib' }]]);
  expect(inspection.graph.coverage).toStrictEqual([
    { facet: 'objects:Contents/Resources/Main.nib', status: 'partial', reason: 'nibarchive_body_not_decoded', examined: 0, omitted: 7 },
    { facet: 'connections:Contents/Resources/Main.nib', status: 'unsupported', reason: 'nibarchive_body_not_decoded', examined: 0, omitted: 0 },
    { facet: 'hierarchy:Contents/Resources/Main.nib', status: 'unsupported', reason: 'nibarchive_body_not_decoded', examined: 0, omitted: 0 },
    { facet: 'classes:Contents/Resources/Main.nib', status: 'unsupported', reason: 'nibarchive_body_not_decoded', examined: 0, omitted: 0 },
    { facet: 'archive_decode', status: 'complete', reason: null, examined: 1, omitted: 0 },
  ]);
});

test('decodeInterfaceBuilderInBundle reports storyboard scenes', async () => {
  const root = await writeTree({
    'Contents/Resources/Main.storyboardc/raw.nib': nibArchive(2),
    'Contents/Resources/Main.storyboardc/Scene.nib': xmlPlist(keyedValue(['$null'], { root: { CF$UID: 0 } })),
  });

  const inspection = await decodeInterfaceBuilderInBundle(root);

  expect(inspection.documents.map((document) => [document.relative_path, document.document_kind])).toStrictEqual([
    ['Contents/Resources/Main.storyboardc/Scene.nib', 'storyboard_scene'],
    ['Contents/Resources/Main.storyboardc/raw.nib', 'storyboard_scene'],
  ]);
  expect(inspection.graph.nodes.filter((node) => node.kind !== 'storyboard')).toStrictEqual([]);
  expect(inspection.graph.nodes.map((node) => node.attributes['document_kind'])).toStrictEqual(['storyboard_scene', 'storyboard_scene']);
});

test('decodeInterfaceBuilderInBundle skips undecodable documents', async () => {
  const root = await writeTree({
    'Contents/Resources/Broken.nib': 'not an archive',
    'Contents/Resources/Legacy.storyboard': '<plist version="1.0"><dict/></plist>',
  });

  const inspection = await decodeInterfaceBuilderInBundle(root);

  expect(inspection.documents).toStrictEqual([]);
  expect(inspection.graph.nodes).toStrictEqual([]);
  expect(inspection.graph.coverage).toStrictEqual([{ facet: 'archive_decode', status: 'complete', reason: null, examined: 1, omitted: 0 }]);
  expect(inspection.graph.truncated).toBe(false);
});

test('decodeInterfaceBuilderInBundle truncates by option', async () => {
  const root = await writeTree({
    'Contents/Resources/A.nib': xmlPlist(classArchive()),
    'Contents/Resources/B.nib': nibArchive(1),
  });

  const limitedDocuments = await decodeInterfaceBuilderInBundle(root, { maxDocuments: 1 });
  const limitedObjects = await decodeInterfaceBuilderInBundle(root, { maxObjects: 3 });

  expect(limitedDocuments.documents.map((document) => document.relative_path)).toStrictEqual(['Contents/Resources/A.nib']);
  expect(limitedDocuments.graph.truncated).toBe(true);
  expect(limitedDocuments.graph.coverage.at(-1)).toStrictEqual({ facet: 'archive_decode', status: 'complete', reason: null, examined: 1, omitted: 1 });
  expect(limitedObjects.documents[0]).toMatchObject({ relative_path: 'Contents/Resources/A.nib', object_count: 15 });
  expect(limitedObjects.graph.coverage[0]).toStrictEqual({
    facet: 'objects:Contents/Resources/A.nib',
    status: 'complete',
    reason: null,
    examined: 3,
    omitted: 12,
  });
});

test('decodeInterfaceBuilderInBundle echoes a supplied resource root', async () => {
  const root = await writeTree({ 'Contents/Resources/Main.nib': nibArchive(1) });
  const resourceRoot = {
    caller_path: '/caller/Fixture.app',
    canonical_path: '/caller/Fixture.app',
    info_plist_path: '/caller/Fixture.app/Contents/Info.plist',
    layout: 'contents' as const,
    executable_sha256: null,
  };

  const inspection = await decodeInterfaceBuilderInBundle(root, { resourceRoot, maxConnections: 5 });

  expect(inspection.resource_root).toStrictEqual(resourceRoot);
  expect(inspection.documents).toHaveLength(1);
});

test('decodeInterfaceBuilderInBundle rejects an empty bundle path', async () => {
  const payload = await payloadOf(() => decodeInterfaceBuilderInBundle(''));

  expect(payload).toStrictEqual({
    code: 'target_unavailable',
    category: 'unavailable',
    message: 'No app is open. Ask the user which app to investigate, then call open_binary with its local path.',
    retryable: false,
    remediation: { action: 'No app is open. Ask the user which app to investigate, then call open_binary with its local path.' },
  });
});

test.for([
  { name: 'a missing directory', message: 'Cannot decode interface builder documents:' },
  { name: 'a plain file', message: 'decode_interface_builder requires an open app bundle directory.' },
])('decodeInterfaceBuilderInBundle rejects $name', async ({ name, message }) => {
  const targets = await tempTargets();
  const root = name === 'a missing directory' ? join(targets.dir, 'absent') : await targets.write('plain.txt', 'x');

  const payload = await payloadOf(() => decodeInterfaceBuilderInBundle(root));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: expect.stringContaining(message),
    details: { parameter: 'path' },
  });
});

test('inspectDesktopApplicationFromPath inventories the fixture Electron app', async () => {
  const root = fixturePath('targets/desktop/electron-app');
  const { record, path, resolvedPath } = await inspectDesktopApplicationFromPath(root);
  const sizes = new Map(['main.js', 'package.json', 'resources/app.asar'].map((relative) => [relative, statSync(join(root, relative)).size]));

  expect(path).toBe(root);
  expect(resolvedPath).toBe(root);
  expect(record.root).toStrictEqual({
    path: root,
    canonical_path: realpathSync(root),
    namespace_id: expect.stringMatching(/^dsr_[a-f0-9]{64}$/),
    identity: { device: expect.stringMatching(/^\d+$/), inode: expect.stringMatching(/^\d+$/) },
    snapshot_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    identity_scope: 'examined-metadata-and-read-ranges',
  });
  expect(record.files.map((file) => [file.path, file.kind, file.bytes, file.read_status])).toStrictEqual([
    ['main.js', 'file', sizes.get('main.js'), 'not-selected'],
    ['package.json', 'file', sizes.get('package.json'), 'not-selected'],
    ['resources', 'directory', null, 'not-selected'],
    ['resources/app.asar', 'file', sizes.get('resources/app.asar'), 'not-selected'],
  ]);
  const asar = record.files[3];
  expect(asar?.facts).toStrictEqual([{ kind: 'electron-asar-convention', offset: null, value: 'resources/app.asar' }]);
  expect(asar?.local_path).toBe(join(root, 'resources/app.asar'));
  expect(asar?.file_id).toMatch(/^dsf_[a-f0-9]{64}$/);
  expect(record.omissions).toStrictEqual([]);
  expect(record.candidates).toStrictEqual([
    {
      candidate_id: `dsc_${sha256Hex(`electron:${asar?.file_id ?? ''}`)}`,
      family: 'electron',
      confidence: 'inferred',
      basis_file_ids: [asar?.file_id],
      rationale: 'An app.asar in a resources directory suggests an Electron application; archive validity and execution are unverified.',
    },
  ]);
  expect(record.next_probes.map((probe) => [probe.operation, probe.path, probe.file_id, probe.confidence])).toStrictEqual([
    ['open_binary', join(root, 'resources/app.asar'), asar?.file_id, 'inferred'],
    ['analyze_javascript_application', join(root, 'resources/app.asar'), asar?.file_id, 'inferred'],
  ]);
  expect(record.components).toStrictEqual([]);
  expect(record.coverage).toStrictEqual({
    status: 'complete-within-scan',
    entries_examined: 4,
    files_probed: 0,
    bytes_read: 0,
    symlinks_not_followed: 0,
    special_entries_omitted: 0,
    limits: { max_entries: 20_000, max_probe_bytes: 8_388_608 },
  });
  expect(record.limitations).toHaveLength(6);
});

test('inspectDesktopApplicationFromPath marks Unity, IL2CPP markers', async () => {
  const root = await writeTree({
    'Assets/Foo.unity3d': 'a',
    'GameAssembly.dll': 'b',
    'global-metadata.dat': 'c',
    'libil2cpp.so': 'd',
  });

  const { record } = await inspectDesktopApplicationFromPath(root);

  expect(record.files.map((file) => [file.path, file.facts.map((fact) => fact.kind)])).toStrictEqual([
    ['Assets', []],
    ['Assets/Foo.unity3d', ['unity-marker']],
    ['GameAssembly.dll', ['il2cpp-binary-name']],
    ['global-metadata.dat', ['unity-marker']],
    ['libil2cpp.so', ['il2cpp-binary-name']],
  ]);
  expect(record.candidates.map((candidate) => [candidate.family, candidate.confidence, candidate.basis_file_ids])).toStrictEqual([
    ['unity-il2cpp', 'inferred', record.files.filter((file) => file.facts.length > 0).map((file) => file.file_id)],
  ]);
  expect(record.next_probes.map((probe) => [probe.operation, probe.rationale, probe.confidence, probe.path])).toStrictEqual([['inspect_il2cpp_metadata', 'IL2CPP global-metadata.dat present', 'observed', join(root, 'global-metadata.dat')]]);
});

test('inspectDesktopApplicationFromPath skips the IL2CPP probe', async () => {
  const root = await writeTree({ 'GameAssembly.dylib': 'a' });

  const { record } = await inspectDesktopApplicationFromPath(root);

  expect(record.candidates.map((candidate) => candidate.family)).toStrictEqual(['unity-il2cpp']);
  expect(record.next_probes).toStrictEqual([]);
});

test('inspectDesktopApplicationFromPath reports no candidates', async () => {
  const root = await writeTree({ 'readme.md': 'nothing to see' });

  const { record } = await inspectDesktopApplicationFromPath(root);

  expect(record.files.map((file) => file.facts)).toStrictEqual([[]]);
  expect(record.candidates).toStrictEqual([]);
  expect(record.next_probes).toStrictEqual([]);
});

test('inspectDesktopApplicationFromPath omits symlinks without following them', async () => {
  const root = await writeTree({ 'real.txt': 'x' });
  symlinkSync(join(root, 'real.txt'), join(root, 'link.txt'));

  const { record } = await inspectDesktopApplicationFromPath(root);

  expect(record.files.map((file) => file.path)).toStrictEqual(['real.txt']);
  expect(record.omissions).toStrictEqual([{ omission_id: expect.stringMatching(/^dso_[a-f0-9]{64}$/), path: 'link.txt', kind: 'symlink_not_followed' }]);
  expect(record.coverage.symlinks_not_followed).toBe(1);
});

test.skipIf(!existsSync('/usr/bin/mkfifo'))('inspectDesktopApplicationFromPath omits special entries', async () => {
  const root = await writeTree({ 'plain.txt': 'x' });
  execFileSync('/usr/bin/mkfifo', [join(root, 'pipe')]);

  const { record } = await inspectDesktopApplicationFromPath(root);

  expect(record.files.map((file) => file.path)).toStrictEqual(['plain.txt']);
  expect(record.omissions).toStrictEqual([{ omission_id: expect.stringMatching(/^dso_[a-f0-9]{64}$/), path: 'pipe', kind: 'special_entry' }]);
  expect(record.coverage.special_entries_omitted).toBe(1);
  expect(record.coverage.entries_examined).toBe(2);
});

test('inspectDesktopApplicationFromPath stops at the entry budget', async () => {
  const root = await writeTree({ 'a.txt': '1', 'b.txt': '2', 'c.txt': '3' });

  const { record } = await inspectDesktopApplicationFromPath(root, { maxEntries: 2, maxProbeBytes: 32 });

  expect(record.files.map((file) => file.path)).toStrictEqual(['a.txt', 'b.txt']);
  expect(record.coverage).toMatchObject({ status: 'budget_exhausted', entries_examined: 3, limits: { max_entries: 2, max_probe_bytes: 32 } });
});

test.for([
  { name: 'max_entries', options: { maxEntries: 0 }, detail: 'max_entries must be a positive integer.' },
  { name: 'max_probe_bytes', options: { maxProbeBytes: 15 }, detail: 'max_probe_bytes must be an integer >= 16.' },
])('inspectDesktopApplicationFromPath rejects an invalid $name', async ({ options, detail }) => {
  const root = await writeTree({ 'plain.txt': 'x' });

  const payload = await payloadOf(() => inspectDesktopApplicationFromPath(root, options));

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The inspection input is not usable. Check the argument and retry.',
    retryable: true,
    remediation: { action: 'The inspection input is not usable. Check the argument and retry.' },
    details: { operation: 'inspect_desktop_application', issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${root}: ${detail}` }] },
  });
});

test.for([
  { name: 'a missing root', reason: 'invalid_value', detail: 'no path exists there' },
  { name: 'a file root', reason: 'invalid_format', detail: 'desktop application inspection requires a directory root.' },
])('inspectDesktopApplicationFromPath rejects $name', async ({ name, reason, detail }) => {
  const root = name === 'a missing root' ? '/tmp/pi-rea-absent-desktop-root' : fixturePath('targets/note.txt');

  const payload = await payloadOf(() => inspectDesktopApplicationFromPath(root));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    details: { operation: 'inspect_desktop_application', issues: [{ path: ['path'], reason, message: `Cannot inspect ${root}: ${detail}` }] },
  });
});

test('inspectDesktopApplicationFromPath resolves a relative root against cwd', async () => {
  const targets = await tempTargets();
  mkdirSync(join(targets.dir, 'app'));
  writeFileSync(join(targets.dir, 'app', 'main.js'), 'x');

  const { record, resolvedPath } = await inspectDesktopApplicationFromPath('app', { cwd: targets.dir });

  expect(resolvedPath).toBe(join(targets.dir, 'app'));
  expect(record.root.path).toBe('app');
  expect(record.files.map((file) => file.path)).toStrictEqual(['main.js']);
});

test('mapDemangleOutputs marks every symbol invalid without tool output', () => {
  expect(mapDemangleOutputs(['_$sSSN', 'plain'], '')).toStrictEqual([
    { input: '_$sSSN', output: '', status: 'invalid' },
    { input: 'plain', output: '', status: 'invalid' },
  ]);
});

test('mapDemangleOutputs ignores the underscore placeholder line', () => {
  expect(mapDemangleOutputs(['_$sSSN', 'plain', '_'], 'type metadata for Swift.String\n')).toStrictEqual([
    { input: '_$sSSN', output: 'type metadata for Swift.String', status: 'demangled' },
    { input: 'plain', output: '', status: 'invalid' },
    { input: '_', output: '', status: 'invalid' },
  ]);
});

test('mapDemangleOutputs trims one trailing newline', () => {
  expect(mapDemangleOutputs(['_$sSSN', 'not_swift'], 'type metadata for Swift.String\nnot_swift\n')).toStrictEqual([
    { input: '_$sSSN', output: 'type metadata for Swift.String', status: 'demangled' },
    { input: 'not_swift', output: 'not_swift', status: 'unchanged' },
  ]);
});

test('demangleSwiftSymbols requires an open target by default', async () => {
  const payload = await payloadOf(() => demangleSwiftSymbols(['_$sSSN']));

  expect(payload).toMatchObject({
    code: 'target_unavailable',
    message: 'No app is open. Ask the user which app to investigate, then call open_binary with its local path.',
    retryable: false,
  });
});

test.for([
  { name: 'an empty symbol list', symbols: [] as unknown[], message: 'demangle_swift requires a non-empty symbols array of non-empty strings.', issues: undefined },
  { name: 'an empty symbol', symbols: [''], message: 'symbols.0: Too small: expected string to have >=1 characters', issues: true },
  { name: 'a non-string symbol', symbols: [7], message: 'symbols.0: Too small: expected string to have >=1 characters', issues: true },
])('demangleSwiftSymbols rejects $name', async ({ symbols, message, issues }) => {
  const payload = await payloadOf(() => demangleSwiftSymbols(symbols, { requireOpenTarget: false }));

  expect(payload).toMatchObject({ code: 'invalid_request', message, details: { operation: 'demangle_swift' } });
  if (issues === undefined) expect(payload.details).toStrictEqual({ operation: 'demangle_swift', parameter: 'symbols' });
  else {
    expect(payload.details).toStrictEqual({
      operation: 'demangle_swift',
      issues: [{ path: ['symbols', 0], reason: 'invalid_value', message }],
    });
  }
});

test.for([
  { name: 'zero', timeoutMs: 0 },
  { name: 'a fraction', timeoutMs: 1.5 },
  { name: 'an out-of-range value', timeoutMs: 2_147_483_648 },
])('demangleSwiftSymbols rejects a $name timeout', async ({ timeoutMs }) => {
  const payload = await payloadOf(() => demangleSwiftSymbols(['_$sSSN'], { requireOpenTarget: false, timeoutMs }));

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'native_command_timeout_ms must be an integer from 1 to 2147483647.',
    retryable: true,
    remediation: { action: 'native_command_timeout_ms must be an integer from 1 to 2147483647.' },
    details: { operation: 'demangle_swift', parameter: 'native_command_timeout_ms' },
  });
});

test('demangleSwiftSymbols demangles with the host tool', async () => {
  const inspection = await demangleSwiftSymbols(['_$sSSN', 'not_swift'], { hasOpenTarget: true });

  expect(inspection.symbols).toStrictEqual([
    { input: '_$sSSN', output: 'type metadata for Swift.String', status: 'demangled' },
    { input: 'not_swift', output: 'not_swift', status: 'unchanged' },
  ]);
  expect(inspection.limitations).toStrictEqual([]);
  const provenance = inspection.provenance[0];
  expect(provenance).toMatchObject({
    tool: 'swift-demangle',
    tool_version: null,
    version_reason: 'Tool exposes no uniform stable version flag; executable SHA-256 is a prelaunch file sample and does not prove atomic OS image binding.',
    executable_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    exit: { code: 0, signal: null },
    stdout_bytes: expect.any(Number),
    stderr_bytes: 0,
  });
  expect(provenance?.command.slice(1)).toStrictEqual(['--compact', '--', '_$sSSN', 'not_swift']);
  expect(provenance?.command[0]?.endsWith('/swift-demangle')).toBe(true);
});

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const normalizedOf = (result: { readonly structuredContent?: unknown }): Record<string, unknown> => (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;

const inventoryEvidence = (): ReturnType<typeof createEvidence> =>
  createEvidence({
    subject: { name: 'Inventory.app', digest: { sha256: 'e'.repeat(64) }, format: 'directory', architecture: null, local_path: '/tmp/Inventory.app' },
    provider: { id: 'pi-rea-test', name: 'pi-rea test', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_artifact',
    parameters: {},
    raw_result: null,
    normalized_result: {
      root_artifact_sha256: 'e'.repeat(64),
      root_format: 'directory',
      collections: {
        occurrences: [
          { logical_path: 'Inventory.app', is_directory: true },
          { logical_path: 'Inventory.app/Contents/Info.plist', calculated_sha256: 'f'.repeat(64) },
        ],
      },
    },
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [],
    locations: [],
    evidence_links: [],
  });

test('project_apple_application_graph tool resolves a retained evidence id', () => {
  const session = new ReaSession(runtime);
  const inventory = inventoryEvidence();
  session.evidence.record(inventory);

  const record = normalizedOf(projectAppleApplicationGraphTool(session, { inventory_evidence: [{ evidence_id: inventory.evidence_id }] }));

  expect(record['source_evidence_ids']).toStrictEqual([inventory.evidence_id]);
  expect(record['root_format']).toBe('directory');
  expect(record['application_roots']).toStrictEqual(['Inventory.app']);
  const created = session.evidence.list().at(-1);
  expect(created?.operation).toBe('project_apple_application_graph');
  expect(created?.subject).toStrictEqual({ name: 'Inventory.app', digest: { sha256: 'e'.repeat(64) }, local_path: '/tmp/Inventory.app', format: 'directory', architecture: null });
  expect(created?.evidence_links).toStrictEqual([inventory.evidence_id]);
  expect(session.evidence.size).toBe(2);
});

test('project_apple_application_graph tool accepts inline evidence', () => {
  const session = new ReaSession(runtime);

  const record = normalizedOf(
    projectAppleApplicationGraphTool(session, {
      inventory_evidence: [{ evidence_id: 'ev_inline', normalized_result: { root_artifact_sha256: 'c'.repeat(64), collections: { occurrences: [{ logical_path: 'Inline.app' }] } } }],
    }),
  );

  expect(record['source_evidence_ids']).toStrictEqual(['ev_inline']);
  expect(record['root_sha256']).toBe('c'.repeat(64));
  expect(record['bundles']).toHaveLength(1);
});

test.for([
  { name: 'a non-array inventory', params: {}, message: 'project_apple_application_graph requires inventory_evidence array.', details: { parameter: 'inventory_evidence' } },
  { name: 'a non-Evidence entry', params: { inventory_evidence: ['inventory'] }, message: 'project_apple_application_graph inventory_evidence[0] must be Evidence.', details: { parameter: 'inventory_evidence' } },
  {
    name: 'an unretained evidence id',
    params: { inventory_evidence: [{ evidence_id: 'ev_absent' }] },
    message: 'project_apple_application_graph inventory_evidence[0] evidence_id is not retained.',
    details: { parameter: 'inventory_evidence', evidence_id: 'ev_absent' },
  },
])('project_apple_application_graph tool rejects $name', async ({ params, message, details }) => {
  const session = new ReaSession(runtime);

  const payload = await payloadOf(() => projectAppleApplicationGraphTool(session, params as { inventory_evidence: readonly unknown[] }));

  expect(payload).toMatchObject({ code: 'invalid_request', message, details });
  expect(session.evidence.size).toBe(0);
});

test('inspect_signature records the signed Mach-O target', async () => {
  const session = new ReaSession(runtime);
  const path = fixturePath('targets/fixture-go-macho');
  await openBinary(session, { path });

  const result = await inspectSignature(session, { native_command_timeout_ms: 5_000 });
  const record = normalizedOf(result);

  expect(record['signed']).toBe(true);
  expect(record['identifier']).toBe('a.out');
  expect(record['format']).toBe('Mach-O thin (arm64)');
  expect(record['cdhashes']).toStrictEqual(['d8864aa4c955875d2575294cd891f196f9fa7abd']);
  expect((record['provenance'] as { tool: string }[])[0]?.tool).toBe('pi-rea/macho-signature-parser');
  expect(session.evidence.list()[0]?.parameters).toStrictEqual({ input_path: path, native_command_timeout_ms: 5_000 });
  expect(session.evidence.size).toBe(1);
});

test('inspect_signature requires an open binary target', async () => {
  const session = new ReaSession(runtime);

  const payload = await payloadOf(() => inspectSignature(session, {}));

  expect(payload).toMatchObject({
    code: 'target_unavailable',
    message: 'No target is open. Call open_binary with a local Mach-O path before inspecting a code signature.',
  });
});

test('inspect_signature rejects a non Mach-O open target', async () => {
  const session = new ReaSession(runtime);
  const path = fixturePath('targets/rust/auditable.elf');
  await openBinary(session, { path });

  const payload = await payloadOf(() => inspectSignature(session, {}));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'The inspection input is not usable. Check the argument and retry.',
    details: { operation: 'inspect_signature', issues: [{ path: [], reason: 'invalid_value', message: `Cannot inspect ${path}: the open target is elf, not a Mach-O image.` }] },
  });
});

test('inspect_signature reports a target that disappeared after opening', async () => {
  const targets = await tempTargets();
  const copy = join(targets.dir, 'copy-macho');
  copyFileSync(fixturePath('targets/minimal-macho.bin'), copy);
  const session = new ReaSession(runtime);
  await openBinary(session, { path: copy });
  unlinkSync(copy);

  const payload = await payloadOf(() => inspectSignature(session, {}));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: expect.stringContaining('The open target can no longer be read:'),
    details: { operation: 'inspect_signature', path: join(realpathSync(targets.dir), 'copy-macho') },
  });
});

test('decode_interface_builder records the open bundle documents', async () => {
  const session = new ReaSession(runtime);
  const bundle = fixturePath('targets/bundle/Fixture.app');
  await openBundleResources(session, { path: bundle });

  const result = await decodeInterfaceBuilder(session, { max_documents: 2 });
  const record = normalizedOf(result);

  const documents = record['documents'] as { relative_path: string; document_kind: string }[];
  expect(documents[0]).toMatchObject({ relative_path: 'Contents/Resources/Base.lproj/MainMenu.nib', document_kind: 'nib' });
  expect(record['resource_root']).toMatchObject({ caller_path: bundle, layout: 'contents' });
  expect(record['limitations']).toHaveLength(4);
  const evidence = session.evidence.list()[0];
  expect(evidence?.parameters).toStrictEqual({ max_documents: 2, max_objects: 20_000, max_connections: 40_000, input_path: bundle });
  expect(evidence?.limitations).toHaveLength(5);
  expect(session.evidence.size).toBe(1);
});

test('decode_interface_builder requires an open bundle resource root', async () => {
  const session = new ReaSession(runtime);

  const payload = await payloadOf(() => decodeInterfaceBuilder(session, {}));

  expect(payload).toMatchObject({ code: 'target_unavailable', retryable: false });
  expect(payload.message).toBe('No app is open. Ask the user which app to investigate, then call open_binary with its local path.');
});

test.for([
  { name: 'an empty path', path: '', message: 'Invalid arguments for tool open_bundle_resources: path: Invalid input: expected string, received undefined' },
  { name: 'a relative path', path: 'Fixture.app', message: 'open_bundle_resources rejects relative paths; supply an absolute filesystem path.' },
  { name: 'a missing path', path: '/tmp/pi-rea-absent-bundle', message: 'Cannot open bundle resources:' },
  { name: 'a file path', path: fixturePath('targets/note.txt'), message: 'open_bundle_resources requires a directory app bundle root.' },
])('open_bundle_resources rejects $name', async ({ path, message }) => {
  const session = new ReaSession(runtime);

  const payload = await payloadOf(() => openBundleResources(session, { path }));

  expect(payload).toMatchObject({ code: 'invalid_request', message: expect.stringContaining(message), details: { parameter: 'path' } });
  expect(session.open).toBe(false);
});

test('open_bundle_resources detects a root layout Info.plist', async () => {
  const session = new ReaSession(runtime);
  const root = await writeTree({ 'Info.plist': '<plist version="1.0"><dict/></plist>' });

  const result = await openBundleResources(session, { path: root });
  const payload = (result.structuredContent as { result: Record<string, unknown> }).result;

  expect(payload).toMatchObject({
    caller_path: root,
    canonical_path: realpathSync(root),
    info_plist_path: join(realpathSync(root), 'Info.plist'),
    layout: 'root',
    executable_sha256: null,
  });
  expect(payload['run_id']).toEqual(expect.any(String));
  expect(session.bundleResources?.layout).toBe('root');
});

test('open_bundle_resources reports a bundle without an Info.plist', async () => {
  const session = new ReaSession(runtime);
  const root = await writeTree({ 'tool.txt': 'x' });

  const result = await openBundleResources(session, { path: root });
  const payload = (result.structuredContent as { result: Record<string, unknown> }).result;

  expect(payload).toMatchObject({ info_plist_path: null, layout: 'root' });
});

test('inspect_keyed_archive projects a bundle-relative archive path', async () => {
  const session = new ReaSession(runtime);
  const bundle = fixturePath('targets/bundle/Fixture.app');
  await openBundleResources(session, { path: bundle });

  const record = normalizedOf(await inspectKeyedArchive(session, { path: 'Contents/Resources/archive.plist', root: 'root' }));

  expect(record['archive_path']).toBe('Contents/Resources/archive.plist');
  expect(record['archive_format']).toBe('xml-plist');
  expect(record['total_objects']).toBe(3);
  expect(record['resource_root']).toMatchObject({ caller_path: bundle, layout: 'contents' });
  const evidence = session.evidence.list()[0];
  expect(evidence?.parameters).toStrictEqual({
    path: 'Contents/Resources/archive.plist',
    offset: 0,
    limit: 20_000,
    input_path: bundle,
    root: 'root',
  });
  expect(evidence?.limitations).toStrictEqual([
    'Artifact identity is unavailable for this observation.',
    'Archive classes are never instantiated. Class names and serialized fields are observed; class-specific semantics are unknown.',
    'Conditional references serialized as UID 0 cannot be distinguished from ordinary nil references. Missing fields remain absent in the raw serialized value.',
    'Root selection selects the named $top entry; object pagination retains original indices and does not recursively expand references.',
  ]);
});

test('inspect_keyed_archive trims an absolute path inside the bundle', async () => {
  const session = new ReaSession(runtime);
  const bundle = fixturePath('targets/bundle/Fixture.app');
  await openBundleResources(session, { path: bundle });

  const targets = await tempTargets();
  const external = await targets.write('external.plist', readFileSync(fixturePath('targets/bundle/Fixture.app/Contents/Resources/archive.plist')));

  const inside = normalizedOf(await inspectKeyedArchive(session, { path: join(realpathSync(bundle), 'Contents/Resources/archive.plist') }));
  const outside = normalizedOf(await inspectKeyedArchive(session, { path: external }));

  expect(inside['archive_path']).toBe('Contents/Resources/archive.plist');
  expect(outside['archive_path']).toBe(external);
  expect(session.evidence.size).toBe(2);
});

test('inspect_keyed_archive requires an open bundle resource root', async () => {
  const session = new ReaSession(runtime);

  const payload = await payloadOf(() => inspectKeyedArchive(session, { path: 'archive.plist' }));

  expect(payload).toMatchObject({ code: 'target_unavailable', message: 'No bundle-resource session is open. Call open_bundle_resources first.' });
});

test('inspect_asset_catalog records an absent catalog digest', async () => {
  const session = new ReaSession(runtime);
  const root = await writeTree({ 'tool.txt': 'x' });
  await openBundleResources(session, { path: root });

  const record = normalizedOf(await inspectAssetCatalog(session, { offset: 0, limit: 5 }));

  expect(record['catalogs']).toStrictEqual([]);
  expect(record['offset']).toBe(0);
  expect(record['next_offset']).toBeNull();
  const evidence = session.evidence.list()[0];
  expect(evidence?.subject).toStrictEqual({
    name: 'Assets.car',
    digest: { sha256: sha256Hex(`asset-catalog-absent:${realpathSync(root)}`) },
    format: 'asset-catalog',
    architecture: null,
    local_path: realpathSync(root),
  });
  expect(evidence?.parameters).toStrictEqual({ offset: 0, limit: 5 });
  expect(session.evidence.size).toBe(1);
});

test('inspect_desktop_application resolves a relative path from context cwd', async () => {
  const session = new ReaSession(runtime);
  const cwd = fixturePath('targets/desktop');

  const result = await inspectDesktopApplication(session, { path: 'electron-app', detail: 'summary' }, { cwd });
  const record = normalizedOf(result);

  expect((record['root'] as { path: string }).path).toBe('electron-app');
  expect((record['root'] as { canonical_path: string }).canonical_path).toBe(realpathSync(join(cwd, 'electron-app')));
  expect((record['candidates'] as { family: string }[]).map((candidate) => candidate.family)).toStrictEqual(['electron']);
  const evidence = session.evidence.list()[0];
  expect(evidence?.parameters).toStrictEqual({ path: 'electron-app', max_entries: 20_000, max_probe_bytes: 8_388_608, detail: 'summary' });
  expect(evidence?.subject).toMatchObject({ name: 'electron-app', format: 'directory', local_path: join(cwd, 'electron-app') });
  expect(evidence?.locations).toStrictEqual([{ kind: 'artifact-path', path: 'electron-app' }]);
  expect(session.evidence.size).toBe(1);
});

test('demangle_swift requires a parameters object', async () => {
  const session = new ReaSession(runtime);

  const payload = await payloadOf(() => demangleSwift(session, null as unknown as { symbols: readonly unknown[] }));

  expect(payload).toStrictEqual({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'demangle_swift requires a parameters object.',
    retryable: true,
    remediation: { action: 'demangle_swift requires a parameters object.' },
    details: { operation: 'demangle_swift' },
  });
});

test('demangle_swift requires an open target', async () => {
  const session = new ReaSession(runtime);

  const payload = await payloadOf(() => demangleSwift(session, { symbols: ['_$sSSN'] }));

  expect(payload).toMatchObject({ code: 'target_unavailable', retryable: false });
  expect(session.evidence.size).toBe(0);
});

test('demangle_swift records demangled symbols for the open target', async () => {
  const session = new ReaSession(runtime);
  const path = fixturePath('targets/minimal-macho.bin');
  await openBinary(session, { path });

  const record = normalizedOf(await demangleSwift(session, { symbols: ['_$sSSN', 'not_swift'], native_command_timeout_ms: 30_000 }));

  expect(record['symbols']).toStrictEqual([
    { input: '_$sSSN', output: 'type metadata for Swift.String', status: 'demangled' },
    { input: 'not_swift', output: 'not_swift', status: 'unchanged' },
  ]);
  expect(session.evidence.list()[0]?.parameters).toStrictEqual({
    symbols: ['_$sSSN', 'not_swift'],
    input_path: path,
    native_command_timeout_ms: 30_000,
  });
  expect(session.evidence.size).toBe(1);
});

type FakeChildMode = 'timeout' | 'error' | 'nonzero-exit';

const fakeChildProcess = (mode: FakeChildMode): childProcess.ChildProcess => {
  const child = new EventEmitter() as unknown as childProcess.ChildProcess & EventEmitter;
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  const stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  stdout.setEncoding = () => undefined;
  stderr.setEncoding = () => undefined;
  (child as unknown as { stdout: unknown }).stdout = stdout;
  (child as unknown as { stderr: unknown }).stderr = stderr;
  (child as unknown as { kill: () => boolean }).kill = () => true;
  if (mode === 'error') {
    queueMicrotask(() => {
      stderr.emit('data', 'spawn failed\n');
      child.emit('error', new Error('spawn failed'));
    });
  }
  if (mode === 'nonzero-exit') {
    queueMicrotask(() => {
      stderr.emit('data', 'bad symbol\n');
      child.emit('close', 9, null);
    });
  }
  return child;
};

test.for([
  { name: 'a timeout', mode: 'timeout' as const },
  { name: 'a spawn failure', mode: 'error' as const },
  { name: 'a non-zero exit', mode: 'nonzero-exit' as const },
])('demangleSwiftSymbols reports $name from the host tool', async ({ mode }) => {
  spawnControl.impl = () => fakeChildProcess(mode);
  onTestFinished(() => {
    spawnControl.impl = undefined;
  });

  const thrown = await demangleSwiftSymbols(['_$sSSN'], { hasOpenTarget: true, timeoutMs: 1 }).then(
    () => undefined,
    (error: unknown) => error,
  );

  const payload = (thrown as ReaError).payload;
  if (mode === 'timeout') {
    expect(payload).toStrictEqual({
      code: 'execution_failure',
      category: 'execution_failure',
      message: 'swift-demangle exceeded native_command_timeout_ms=1.',
      retryable: false,
      remediation: { action: 'swift-demangle exceeded native_command_timeout_ms=1.' },
      details: { operation: 'demangle_swift' },
    });
  }
  if (mode === 'nonzero-exit') {
    expect(payload).toStrictEqual({
      code: 'execution_failure',
      category: 'execution_failure',
      message: 'swift-demangle exited with code 9.',
      retryable: false,
      remediation: { action: 'swift-demangle exited with code 9.' },
      details: { operation: 'demangle_swift', exit_code: 9, stderr_excerpt: 'bad symbol\n' },
    });
  }
  if (mode === 'error') expect((thrown as Error).message).toBe('spawn failed');
});
