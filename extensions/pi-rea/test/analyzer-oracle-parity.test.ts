import { deflateSync } from 'node:zlib';

import { expect, test } from 'vitest';
import { inspectMachoSignatureBytes } from '../src/analysis/macho-signature.ts';
import { inspectRustBinaryFromPath } from '../src/analysis/rust-binary.ts';
import type { ReaError, ReaErrorPayload } from '../src/contract/errors.ts';
import { tempTargets } from './support/temp-targets.ts';

const align = (value: number, to: number): number => Math.ceil(value / to) * to;

const elfWithDependencyJson = (json: string): Buffer => {
  const payload = deflateSync(Buffer.from(json, 'utf8'));
  const names = Buffer.from('\0.dep-v0\0\0', 'latin1');
  const payloadOffset = 64;
  const namesOffset = payloadOffset + payload.length;
  const shoff = align(namesOffset + names.length, 8);
  const bytes = Buffer.alloc(shoff + 3 * 64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(62, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(BigInt(shoff), 40);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(3, 60);
  bytes.writeUInt16LE(2, 62);
  payload.copy(bytes, payloadOffset);
  names.copy(bytes, namesOffset);
  const section = (index: number): number => shoff + index * 64;
  bytes.writeUInt32LE(1, section(1));
  bytes.writeUInt32LE(1, section(1) + 4);
  bytes.writeBigUInt64LE(BigInt(payloadOffset), section(1) + 24);
  bytes.writeBigUInt64LE(BigInt(payload.length), section(1) + 32);
  bytes.writeBigUInt64LE(BigInt(namesOffset), section(2) + 24);
  bytes.writeBigUInt64LE(BigInt(names.length), section(2) + 32);
  bytes.writeUInt32LE(3, section(2) + 4);
  return bytes;
};

const rustRejection = async (json: string): Promise<{ path: string; message: string }> => {
  const targets = await tempTargets();
  const path = await targets.write('dependency.elf', elfWithDependencyJson(json));
  try {
    await inspectRustBinaryFromPath(path);
  } catch (error) {
    const issues = ((error as ReaError).payload as ReaErrorPayload).details as { issues: { message: string }[] };
    return { path, message: issues.issues[0]?.message ?? '' };
  }
  throw new Error('expected inspectRustBinaryFromPath to reject the dependency document');
};

const rustMetadata = async (json: string): Promise<Record<string, unknown>> => {
  const targets = await tempTargets();
  const path = await targets.write('dependency.elf', elfWithDependencyJson(json));
  const { record } = await inspectRustBinaryFromPath(path);
  return record.auditable_metadata as unknown as Record<string, unknown>;
};

const thinMachoWithSignatureLink = (options: { readonly dataoff?: number; readonly datasize?: number; readonly trailer?: Buffer; readonly withCommand?: boolean } = {}): Buffer => {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(0, 8);
  header.writeUInt32LE(2, 12);
  if (options.withCommand === false) return header;
  header.writeUInt32LE(1, 16);
  header.writeUInt32LE(16, 20);
  const command = Buffer.alloc(16);
  command.writeUInt32LE(0x1d, 0);
  command.writeUInt32LE(16, 4);
  command.writeUInt32LE(options.dataoff ?? 48, 8);
  command.writeUInt32LE(options.datasize ?? 0, 12);
  return Buffer.concat([header, command, options.trailer ?? Buffer.alloc(0)]);
};

const codeDirectory = (): Buffer => {
  const identifier = Buffer.from('com.example.parity', 'utf8');
  const bytes = Buffer.alloc(44 + identifier.length + 1);
  bytes.writeUInt32BE(0xfade0c02, 0);
  bytes.writeUInt32BE(bytes.length, 4);
  bytes.writeUInt32BE(0x20400, 8);
  bytes.writeUInt32BE(0, 12);
  bytes.writeUInt32BE(44, 20);
  bytes.writeUInt32BE(1, 28);
  bytes.writeUInt32BE(4096, 32);
  bytes[36] = 32;
  bytes[37] = 2;
  identifier.copy(bytes, 44);
  return bytes;
};

const signedMacho = (): Buffer => {
  const directory = codeDirectory();
  const superBlob = Buffer.alloc(20);
  superBlob.writeUInt32BE(0xfade0cc0, 0);
  superBlob.writeUInt32BE(20 + directory.length, 4);
  superBlob.writeUInt32BE(1, 8);
  superBlob.writeUInt32BE(0, 12);
  superBlob.writeUInt32BE(20, 16);
  const signature = Buffer.concat([superBlob, directory]);
  return thinMachoWithSignatureLink({ datasize: signature.length, trailer: signature });
};

const NOT_SIGNED: readonly string[] = ['Artifact is not signed.', 'Inspected a digest-verified Mach-O byte snapshot; filesystem-bound signing context and trust validation are not examined.'];

test('inspect_rust_binary accepts a zero-package document as REA does', async () => {
  const metadata = await rustMetadata('{"packages": []}');

  expect(metadata).toMatchObject({ format_version: null, packages: [], root_package_index: null, dependency_edges: [], cyclic_dependency_indices: [] });
});

test('inspect_rust_binary reads format_version from a numeric format key', async () => {
  const metadata = await rustMetadata('{"format": 7, "packages": []}');

  expect(metadata).toMatchObject({ format_version: 7, packages: [] });
});

test('inspect_rust_binary reads format_version 0 as zero rather than absence', async () => {
  const metadata = await rustMetadata('{"format": 0, "packages": []}');

  expect(metadata['format_version']).toBe(0);
});

test('inspect_rust_binary picks the single root package as REA does', async () => {
  const metadata = await rustMetadata(
    '{"packages": [{"name": "app", "version": "0.1.0", "source": "local", "kind": "runtime", "dependencies": [1], "features": [], "root": false}, {"name": "dep", "version": "1.0.0", "source": "crates.io", "root": true}]}',
  );

  expect(metadata).toStrictEqual({
    section_name: '.dep-v0',
    file_offset: 64,
    section_bytes: expect.any(Number),
    compressed_bytes: expect.any(Number),
    uncompressed_bytes: expect.any(Number),
    format_version: null,
    packages: [
      { name: 'app', version: '0.1.0', source: 'local', kind: 'runtime', dependencies: [1], features: [], root: false },
      { name: 'dep', version: '1.0.0', source: 'crates.io', kind: null, dependencies: [], features: null, root: true },
    ],
    root_package_index: 1,
    dependency_edges: [{ from_index: 0, to_index: 1 }],
    cyclic_dependency_indices: [],
  });
});

test('inspect_rust_binary reports no root index when no package is marked root', async () => {
  const metadata = await rustMetadata('{"packages": [{"name": "a", "version": "0.1.0", "source": "local"}]}');

  expect(metadata['packages']).toStrictEqual([{ name: 'a', version: '0.1.0', source: 'local', kind: null, dependencies: [], features: null, root: false }]);
  expect(metadata['root_package_index']).toBeNull();
});

test.for([
  { name: 'an array document', json: '[]' },
  { name: 'a string document', json: '"packages"' },
  { name: 'a string format', json: '{"packages": [], "format": "1"}' },
  { name: 'a null format', json: '{"packages": [], "format": null}' },
  { name: 'a fractional format', json: '{"packages": [], "format": 1.5}' },
  { name: 'a negative format', json: '{"packages": [], "format": -1}' },
  { name: 'a format above u32', json: '{"packages": [], "format": 4294967296}' },
])('inspect_rust_binary rejects $name with the REA format-schema issue', async ({ json }) => {
  const { path, message } = await rustRejection(json);

  expect(message).toBe(`Selected artifact ${path}: Dependency JSON does not match the format schema`);
});

test.for([
  { name: 'a missing packages key', json: '{"format": 1}' },
  { name: 'a non-array packages value', json: '{"packages": {}}' },
  { name: 'a document version key', json: '{"packages": [], "version": 1}' },
  { name: 'a document root key', json: '{"packages": [], "root": 0}' },
  { name: 'an unknown document key', json: '{"packages": [], "notes": true}' },
  { name: 'an unsafe dependency integer', json: '{"packages": [{"name": "a", "version": "1", "source": "s", "dependencies": [9007199254740992]}]}' },
])('inspect_rust_binary rejects $name with the REA document-schema issue', async ({ json }) => {
  const { path, message } = await rustRejection(json);

  expect(message).toBe(`Selected artifact ${path}: Dependency JSON does not match the package schema`);
});

test.for([
  { name: 'an empty package', json: '{"packages": [{}]}' },
  { name: 'a package without source', json: '{"packages": [{"name": "a", "version": "1"}]}' },
  { name: 'an empty name', json: '{"packages": [{"name": "", "version": "1", "source": "s"}]}' },
  { name: 'an unknown kind', json: '{"packages": [{"name": "a", "version": "1", "source": "s", "kind": "dev"}]}' },
  { name: 'a null kind', json: '{"packages": [{"name": "a", "version": "1", "source": "s", "kind": null}]}' },
  { name: 'a string dependency', json: '{"packages": [{"name": "a", "version": "1", "source": "s", "dependencies": ["0"]}]}' },
  { name: 'a negative dependency', json: '{"packages": [{"name": "a", "version": "1", "source": "s", "dependencies": [-1]}]}' },
  { name: 'a null features list', json: '{"packages": [{"name": "a", "version": "1", "source": "s", "features": null}]}' },
  { name: 'an empty feature name', json: '{"packages": [{"name": "a", "version": "1", "source": "s", "features": [""]}]}' },
  { name: 'a string root flag', json: '{"packages": [{"name": "a", "version": "1", "source": "s", "root": "true"}]}' },
  { name: 'an unknown package key', json: '{"packages": [{"name": "a", "version": "1", "source": "s", "license": "MIT"}]}' },
])('inspect_rust_binary rejects $name with the REA package-schema issue', async ({ json }) => {
  const { path, message } = await rustRejection(json);

  expect(message).toBe(`Selected artifact ${path}: Dependency package 0 does not match the package schema`);
});

test('inspect_rust_binary names the offending package index', async () => {
  const { path, message } = await rustRejection('{"packages": [{"name": "a", "version": "1", "source": "s"}, {"name": "b"}]}');

  expect(message).toBe(`Selected artifact ${path}: Dependency package 1 does not match the package schema`);
});

test('inspect_rust_binary rejects a document that declares more than one root package', async () => {
  const { path, message } = await rustRejection('{"packages": [{"name": "a", "version": "1", "source": "s", "root": true}, {"name": "b", "version": "1", "source": "s", "root": true}]}');

  expect(message).toBe(`Selected artifact ${path}: Dependency JSON declares more than one root package`);
});

test('inspect_rust_binary rejects a dependency index outside the package list', async () => {
  const { path, message } = await rustRejection('{"packages": [{"name": "a", "version": "1", "source": "s", "dependencies": [1]}]}');

  expect(message).toBe(`Selected artifact ${path}: Dependency index 1 from package 0 is outside the package list`);
});

test('inspectMachoSignatureBytes reports the not-signed shape REA observes for a zero-length LC_CODE_SIGNATURE', () => {
  const inspection = inspectMachoSignatureBytes(thinMachoWithSignatureLink({ datasize: 0 }));

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
    limitations: [...NOT_SIGNED],
  });
});

test.for([
  { name: 'no LC_CODE_SIGNATURE command', bytes: () => thinMachoWithSignatureLink({ withCommand: false }) },
  { name: 'a zero length with a dataoff past the end', bytes: () => thinMachoWithSignatureLink({ dataoff: 4096, datasize: 0 }) },
  { name: 'a signature region past the end of the file', bytes: () => thinMachoWithSignatureLink({ dataoff: 4096, datasize: 64 }) },
  { name: 'a signature region that is not a SuperBlob', bytes: () => thinMachoWithSignatureLink({ datasize: 32, trailer: Buffer.alloc(32, 0x7f) }) },
])('inspectMachoSignatureBytes reports $name as not signed', ({ bytes }) => {
  const inspection = inspectMachoSignatureBytes(bytes());

  expect(inspection.format).toBeNull();
  expect(inspection.signed).toBe(false);
  expect(inspection.limitations).toStrictEqual([...NOT_SIGNED]);
});

test('inspectMachoSignatureBytes keeps a decoded CodeDirectory signed', () => {
  const inspection = inspectMachoSignatureBytes(signedMacho());

  expect(inspection).toMatchObject({
    signed: true,
    identifier: 'com.example.parity',
    format: 'Mach-O thin (arm64)',
    hash_algorithms: ['sha256'],
    limitations: ['Inspected a digest-verified Mach-O byte snapshot; filesystem-bound signing context and trust validation are not examined.'],
  });
});
