import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { inspectApkSignatureFromPath } from '../src/analysis/apk-signature.ts';
import { inspectAppleIpsFromPath } from '../src/analysis/apple-ips.ts';
import { identifyFlutterBuildFromPath, inspectDartAotFromPath } from '../src/analysis/flutter-build.ts';
import { inspectGpuCodeObjectsFromPath } from '../src/analysis/gpu-code-objects.ts';
import { inspectIl2CppMetadataFromPath } from '../src/analysis/il2cpp-metadata.ts';
import { inspectRecordedCrashFromPath, minimalElf64CoreFixture } from '../src/analysis/recorded-crash.ts';
import type { ReaError, ReaErrorPayload } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectApkSignature } from '../src/tools/apk-signature-tools.ts';
import { inspectAppleIps } from '../src/tools/apple-ips-tools.ts';
import { identifyFlutterBuild, inspectDartAot } from '../src/tools/flutter-tools.ts';
import { inspectGpuCodeObjects } from '../src/tools/gpu-code-object-tools.ts';
import { inspectIl2CppMetadata } from '../src/tools/il2cpp-tools.ts';
import { inspectRecordedCrash } from '../src/tools/recorded-crash-tools.ts';
import { fixturePath } from './support/fixtures.ts';
import { tempTargets } from './support/temp-targets.ts';

// The recorded-crash tool refuses on every non-Linux host before it reads bytes. The probe is a host
// capability boundary, so it is the one thing stubbed here; the analyzer itself runs for real.
vi.mock(import('../src/contract/errors.ts'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, pwntoolsHostSupported: () => true };
});

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };
const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const payloadOf = async (run: () => Promise<unknown>): Promise<ReaErrorPayload> => {
  try {
    await run();
  } catch (error) {
    const payload = (error as ReaError).payload;
    if (payload === undefined) throw error;
    return payload;
  }
  throw new Error('the analyzer returned instead of throwing');
};
const thrownOf = async (run: () => Promise<unknown>): Promise<Error> => {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('the analyzer returned instead of throwing');
};
const firstIssueMessage = (payload: ReaErrorPayload): string => {
  const issues = payload.details?.['issues'];
  const first = Array.isArray(issues) ? (issues[0] as { message?: string } | undefined) : undefined;
  return first?.message ?? '';
};
const evidenceOf = async (run: () => Promise<{ structuredContent?: unknown }>): Promise<Record<string, unknown>> => {
  const result = await run();
  return result.structuredContent as Record<string, unknown>;
};

const ZIP_EOCD = 0x06054b50;
const ZIP_EOCD64 = 0x06064b50;
const ZIP_EOCD64_LOCATOR = 0x07064b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

interface ZipEntry {
  readonly name: string;
  readonly data: Buffer | string;
  readonly method?: number;
  readonly localOffset?: number;
}

interface ZipOptions {
  readonly prelude?: Buffer;
  readonly trailer?: Buffer;
  readonly centralDirectoryOffset?: number;
}

const entryBytes = (entry: ZipEntry): { name: Buffer; body: Buffer; method: number } => ({
  name: Buffer.from(entry.name, 'utf8'),
  body: Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8'),
  method: entry.method ?? 0,
});

const localRecord = (entry: ZipEntry): Buffer => {
  const { name, body, method } = entryBytes(entry);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(ZIP_LOCAL, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(body.length, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, body]);
};

const centralRecord = (entry: ZipEntry, method: number, localOffset: number): Buffer => {
  const { name, body } = entryBytes(entry);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(ZIP_CENTRAL, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(method, 10);
  header.writeUInt32LE(body.length, 20);
  header.writeUInt32LE(body.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, name]);
};

const zipOf = (entries: readonly ZipEntry[], options: ZipOptions = {}): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const { method } = entryBytes(entry);
    const local = localRecord(entry);
    locals.push(local);
    centrals.push(centralRecord(entry, method, entry.localOffset ?? offset));
    offset += local.length;
  }
  const prelude = options.prelude ?? Buffer.alloc(0);
  const trailer = options.trailer ?? Buffer.alloc(0);
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(options.centralDirectoryOffset ?? offset + prelude.length, 16);
  return Buffer.concat([...locals, prelude, central, trailer, eocd]);
};

const zip64Of = (entries: readonly ZipEntry[]): Buffer => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const { method } = entryBytes(entry);
    const local = localRecord(entry);
    locals.push(local);
    centrals.push(centralRecord(entry, method, offset));
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const record = Buffer.alloc(56);
  record.writeUInt32LE(ZIP_EOCD64, 0);
  record.writeBigUInt64LE(BigInt(entries.length), 32);
  record.writeBigUInt64LE(BigInt(central.length), 40);
  record.writeBigUInt64LE(BigInt(offset + 56), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(ZIP_EOCD64_LOCATOR, 0);
  locator.writeBigUInt64LE(BigInt(offset), 8);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([...locals, record, central, locator, eocd]);
};

interface ElfHeaderOptions {
  readonly bytes?: number;
  readonly identClass?: number;
  readonly identData?: number;
  readonly identVersion?: number;
  readonly headerSize?: number;
  readonly type?: number;
  readonly shoff?: bigint;
  readonly shentsize?: number;
  readonly shnum?: number;
  readonly phoff?: number;
  readonly phentsize?: number;
  readonly phnum?: number;
}

const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];

const elf64 = (options: ElfHeaderOptions = {}): Buffer => {
  const length = options.bytes ?? 120;
  const buffer = Buffer.alloc(Math.max(length, 120));
  buffer.set(ELF_MAGIC, 0);
  buffer[4] = options.identClass ?? 2;
  buffer[5] = options.identData ?? 1;
  buffer[6] = options.identVersion ?? 1;
  buffer.writeUInt16LE(options.type ?? 3, 16);
  buffer.writeBigUInt64LE(BigInt(options.phoff ?? 64), 32);
  buffer.writeBigUInt64LE(options.shoff ?? 0n, 40);
  buffer.writeUInt16LE(options.headerSize ?? 64, 52);
  buffer.writeUInt16LE(options.phentsize ?? 56, 54);
  buffer.writeUInt16LE(options.phnum ?? 1, 56);
  buffer.writeUInt16LE(options.shentsize ?? 0, 58);
  buffer.writeUInt16LE(options.shnum ?? 0, 60);
  return buffer.subarray(0, length);
};

const elf32 = (options: ElfHeaderOptions = {}): Buffer => {
  const length = options.bytes ?? 84;
  const buffer = Buffer.alloc(Math.max(length, 84));
  buffer.set(ELF_MAGIC, 0);
  buffer[4] = options.identClass ?? 1;
  buffer[5] = options.identData ?? 1;
  buffer[6] = options.identVersion ?? 1;
  buffer.writeUInt16LE(options.type ?? 3, 16);
  buffer.writeUInt32LE(options.phoff ?? 52, 28);
  buffer.writeUInt32LE(Number(options.shoff ?? 0n), 32);
  buffer.writeUInt16LE(options.headerSize ?? 52, 40);
  buffer.writeUInt16LE(options.phentsize ?? 32, 42);
  buffer.writeUInt16LE(options.phnum ?? 1, 44);
  buffer.writeUInt16LE(options.shentsize ?? 0, 46);
  buffer.writeUInt16LE(options.shnum ?? 0, 48);
  return buffer.subarray(0, length);
};

const DART_MAGIC = Buffer.from([0xf5, 0xf5, 0xdc, 0xdc]);

const dartSnapshot = (hash: string): Buffer => Buffer.concat([DART_MAGIC, Buffer.alloc(16), Buffer.from(hash, 'latin1')]);

const flutterApk = (options: { libapp?: Buffer; libflutter?: Buffer; abi?: string }): Buffer => {
  const abi = options.abi ?? 'arm64-v8a';
  const entries: ZipEntry[] = [];
  if (options.libapp !== undefined) entries.push({ name: `lib/${abi}/libapp.so`, data: options.libapp });
  if (options.libflutter !== undefined) entries.push({ name: `lib/${abi}/libflutter.so`, data: options.libflutter });
  return zipOf(entries);
};

const completeLibapp = (): Buffer => Buffer.concat([elf64(), dartSnapshot('a'.repeat(32)), dartSnapshot('a'.repeat(32))]);
const completeLibflutter = (): Buffer => Buffer.concat([elf64(), Buffer.from('GNU\0', 'latin1'), Buffer.from('00112233445566778899aabbccddeeff', 'hex')]);

interface CoreNote {
  readonly owner: string;
  readonly type: number;
  readonly desc: Buffer;
}

const coreNoteBytes = (notes: readonly CoreNote[]): Buffer =>
  Buffer.concat(
    notes.map((note) => {
      const name = Buffer.from(`${note.owner}\u0000`, 'latin1');
      const header = Buffer.alloc(12);
      header.writeUInt32LE(name.length, 0);
      header.writeUInt32LE(note.desc.length, 4);
      header.writeUInt32LE(note.type, 8);
      return Buffer.concat([header, name, Buffer.alloc((4 - (name.length % 4)) % 4), note.desc, Buffer.alloc((4 - (note.desc.length % 4)) % 4)]);
    }),
  );

interface CoreOptions {
  readonly machine?: number;
  readonly type?: number;
  readonly identClass?: number;
  readonly identData?: number;
  readonly notes?: readonly CoreNote[];
  readonly rawNotes?: Buffer;
  readonly loads?: readonly number[];
  readonly phentsize?: number;
  readonly truncateTo?: number;
}

const coreImage = (options: CoreOptions = {}): Buffer => {
  const notes = options.rawNotes ?? coreNoteBytes(options.notes ?? []);
  const loads = options.loads ?? [];
  const phentsize = options.phentsize ?? 56;
  const phnum = loads.length + (notes.length > 0 ? 1 : 0);
  const dataStart = 64 + phnum * phentsize;
  const buffer = Buffer.alloc(Math.max(dataStart + notes.length, 64));
  buffer.write('\u007fELF', 0, 'ascii');
  buffer[4] = options.identClass ?? 2;
  buffer[5] = options.identData ?? 1;
  buffer[6] = 1;
  buffer.writeUInt16LE(options.type ?? 4, 16);
  buffer.writeUInt16LE(options.machine ?? 62, 18);
  buffer.writeUInt32LE(1, 20);
  buffer.writeBigUInt64LE(0n, 24);
  buffer.writeBigUInt64LE(64n, 32);
  buffer.writeBigUInt64LE(0n, 40);
  buffer.writeUInt16LE(64, 52);
  buffer.writeUInt16LE(phentsize, 54);
  buffer.writeUInt16LE(phnum, 56);
  let cursor = 64;
  for (const flags of loads) {
    buffer.writeUInt32LE(1, cursor);
    buffer.writeUInt32LE(flags, cursor + 4);
    buffer.writeBigUInt64LE(64n, cursor + 8);
    buffer.writeBigUInt64LE(0x400000n, cursor + 16);
    buffer.writeBigUInt64LE(0x400000n, cursor + 24);
    buffer.writeBigUInt64LE(0n, cursor + 32);
    buffer.writeBigUInt64LE(16n, cursor + 40);
    buffer.writeBigUInt64LE(8n, cursor + 48);
    cursor += phentsize;
  }
  if (notes.length > 0) {
    buffer.writeUInt32LE(4, cursor);
    buffer.writeUInt32LE(0, cursor + 4);
    buffer.writeBigUInt64LE(BigInt(dataStart), cursor + 8);
    buffer.writeBigUInt64LE(0n, cursor + 16);
    buffer.writeBigUInt64LE(0n, cursor + 24);
    buffer.writeBigUInt64LE(BigInt(notes.length), cursor + 32);
    buffer.writeBigUInt64LE(BigInt(notes.length), cursor + 40);
    buffer.writeBigUInt64LE(4n, cursor + 48);
  }
  notes.copy(buffer, dataStart);
  return options.truncateTo === undefined ? buffer : buffer.subarray(0, options.truncateTo);
};

const prstatus = (options: { signal?: number; pid?: number; ppid?: number; bytes?: number; registers?: boolean }): Buffer => {
  const buffer = Buffer.alloc(options.bytes ?? (options.registers === true ? 336 : 64));
  buffer.writeInt32LE(options.signal ?? 11, 12);
  buffer.writeInt32LE(options.pid ?? 4242, 24);
  buffer.writeInt32LE(options.ppid ?? 1, 28);
  if (options.registers === true) {
    for (let index = 0; index < 21; index += 1) buffer.writeBigUInt64LE(BigInt(index + 1), 112 + index * 8);
  }
  return buffer;
};

const siginfo = (options: { signo?: number; errno?: number; code?: number; bytes?: number }): Buffer => {
  const buffer = Buffer.alloc(options.bytes ?? 16);
  if (buffer.length >= 12) {
    buffer.writeInt32LE(options.signo ?? 11, 0);
    buffer.writeInt32LE(options.errno ?? 0, 4);
    buffer.writeInt32LE(options.code ?? 1, 8);
  }
  return buffer;
};

interface GpuSectionSpec {
  readonly name: string;
  readonly data?: Buffer;
  readonly size?: number;
  readonly strtab?: boolean;
}

interface GpuElfOptions {
  readonly sections: readonly GpuSectionSpec[];
  readonly bits?: 32 | 64;
  readonly little?: boolean;
  readonly shstrndx?: number;
  readonly truncateTo?: number;
}

const gpuElf = (options: GpuElfOptions): Buffer => {
  const bits = options.bits ?? 64;
  const little = options.little ?? true;
  const write16 = (buffer: Buffer, value: number, offset: number) => void (little ? buffer.writeUInt16LE(value, offset) : buffer.writeUInt16BE(value, offset));
  const write32 = (buffer: Buffer, value: number, offset: number) => void (little ? buffer.writeUInt32LE(value, offset) : buffer.writeUInt32BE(value, offset));
  const write64 = (buffer: Buffer, value: number, offset: number) => void (little ? buffer.writeBigUInt64LE(BigInt(value), offset) : buffer.writeBigUInt64BE(BigInt(value), offset));

  let strtab = '\u0000';
  const nameOffsets: number[] = [];
  options.sections.forEach((section, index) => {
    nameOffsets.push(strtab.length);
    strtab += section.name;
    if (index < options.sections.length - 1) strtab += '\u0000';
  });
  const strtabBytes = Buffer.from(strtab, 'latin1');
  const payloadStart = 64 + strtabBytes.length;
  const payloadOffsets: number[] = [];
  let payloadBytes = 0;
  for (const section of options.sections) {
    payloadOffsets.push(payloadStart + payloadBytes);
    payloadBytes += section.data?.length ?? 0;
  }
  const sectionOffset = (section: GpuSectionSpec, index: number): number => (section.strtab === true ? 64 : (payloadOffsets[index] ?? 0));
  const sectionSize = (section: GpuSectionSpec): number => (section.strtab === true ? strtabBytes.length : (section.size ?? section.data?.length ?? 0));
  const shoff = payloadStart + payloadBytes;
  const shentsize = bits === 64 ? 64 : 40;
  const total = shoff + options.sections.length * shentsize;
  const buffer = Buffer.alloc(total);
  buffer.set(ELF_MAGIC, 0);
  buffer[4] = bits === 64 ? 2 : 1;
  buffer[5] = little ? 1 : 2;
  buffer[6] = 1;
  write16(buffer, 1, 16);
  write16(buffer, 62, 18);
  write32(buffer, 1, 20);
  if (bits === 64) {
    write64(buffer, 0, 32);
    write64(buffer, shoff, 40);
    write64(buffer, 64, 52);
    write16(buffer, 0, 54);
    write16(buffer, 0, 56);
    write16(buffer, shentsize, 58);
    write16(buffer, options.sections.length, 60);
    write16(buffer, options.shstrndx ?? options.sections.length - 1, 62);
  } else {
    write32(buffer, 0, 28);
    write32(buffer, shoff, 32);
    write32(buffer, 52, 40);
    write16(buffer, 0, 42);
    write16(buffer, 0, 44);
    write16(buffer, shentsize, 46);
    write16(buffer, options.sections.length, 48);
    write16(buffer, options.shstrndx ?? options.sections.length - 1, 50);
  }
  strtabBytes.copy(buffer, 64);
  let payloadAt = payloadStart;
  options.sections.forEach((section, index) => {
    if (section.data !== undefined) {
      section.data.copy(buffer, payloadAt);
      payloadAt += section.data.length;
    }
    const base = shoff + index * shentsize;
    write32(buffer, nameOffsets[index] ?? 0, base);
    if (bits === 64) {
      write64(buffer, sectionOffset(section, index), base + 24);
      write64(buffer, sectionSize(section), base + 32);
    } else {
      write32(buffer, sectionOffset(section, index), base + 16);
      write32(buffer, sectionSize(section), base + 20);
    }
  });
  return options.truncateTo === undefined ? buffer : buffer.subarray(0, options.truncateTo);
};

const CERT_DER = Buffer.from(
  'MIIC9TCCAd2gAwIBAgIDAL7vMA0GCSqGSIb3DQEBCwUAMCMxFDASBgNVBAMMC3BpLXJlYSB0ZXN0MQswCQYDVQQGEwJVUzAeFw0yNjEwMjgyMDQyMzdaFw0zNjEwMjUyMDQyMzdaMCMxFDASBgNVBAMMC3BpLXJlYSB0ZXN0MQswCQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAJ+HswobhdN97VkB4D84IBuaL3WUshlofkG3WVYIgbwm2lixci4OohoZirRGvKq5X/tisKLCxNCvE0ZTs7aZGKFYS0ttW50sEd4BQlYG8pfWQP6kbJaK3uvEz1cyfkOa2G/3njSdRYkVWbhCYNIXNRG6NguDJzuzIDFwDedV8H2Hjs8ytCvDPUo4BynFmS9j7zLkNFbmWfpE/tRJNRGTlNcgo8k48ypQzP+lSXGa2P9Vj/DncFwxfjUEHEFLcBN7i8xx6G+voAGcXhrk/EKBPq4ATJbPZ9gKPSw70JESpk/joCKtAQKX2fL2Umr7UjeGPRigClI41iseB9XZ24mrFy0CAwEAAaMyMDAwHQYDVR0OBBYEFIkDfOVkmozGr5+Zy5c+YCpHKzSNMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBABFf0/MLA3YZ5tb6nk2vnRlD9KwXsMYxljSUSuhic9KhhZn+RDUcI0vVYtheDxH9N1w70m7O2Iz6v6Y3lJeeHcphkSgycot/iBSVjFV0UUcNuV6bamqDq8XcNWhAyK6TWosjtrmshL44jSaHgGVv7RS9XNefiDITRrBAf6y+ikdtx4bqu/rmEXsPHHJ6IB4wy9OvapiGx1ZTmGRuqWvw5WEkkkBC53Yq9WjbmUmIPXPCP3bvw3BomuV0og8iYN9p1fMlT9fNkFV6ouWSkp7WhfTsX3ZZcQ6XQmhyXm2f/2HjKwgBVuuL46rr69jGfPCqmjOL+BB4tPU9tXaAJY6L6qQ=',
  'base64',
);

const APK_SIG_MAGIC_TEXT = 'APK Sig Block 42';
const APK_SIG_V2 = 0x7109871a;
const APK_SIG_V3 = 0xf05368c0;
const APK_SIG_V31 = 0x1b93ad61;
const APK_SIG_SOURCE_STAMP = 0x6dff800d;

const lengthPrefixed = (body: Buffer): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
};

const idValuePair = (id: number, value: Buffer): Buffer => {
  const header = Buffer.alloc(12);
  header.writeBigUInt64LE(BigInt(value.length + 4), 0);
  header.writeUInt32LE(id, 8);
  return Buffer.concat([header, value]);
};

const signingBlock = (pairs: readonly Buffer[], declared?: number, stored?: number): Buffer => {
  const body = Buffer.concat(pairs);
  const size = body.length + 24;
  const head = Buffer.alloc(8);
  head.writeBigUInt64LE(BigInt(declared ?? size), 0);
  const tail = Buffer.alloc(24);
  tail.writeBigUInt64LE(BigInt(stored ?? declared ?? size), 0);
  tail.write(APK_SIG_MAGIC_TEXT, 8, 'latin1');
  return Buffer.concat([head, body, tail]);
};

const blockSigner = (options: { certificates?: readonly Buffer[]; digests?: readonly Buffer[]; minSdk?: number; maxSdk?: number }): Buffer => {
  const digests = Buffer.concat((options.digests ?? []).map((digest) => lengthPrefixed(digest)));
  const certificates = Buffer.concat((options.certificates ?? []).map((certificate) => lengthPrefixed(certificate)));
  const sdk = options.minSdk === undefined ? Buffer.alloc(0) : Buffer.alloc(8);
  if (options.minSdk !== undefined) sdk.writeUInt32LE(options.minSdk, 0);
  if (options.maxSdk !== undefined) sdk.writeUInt32LE(options.maxSdk, 4);
  const signed = Buffer.concat([lengthPrefixed(digests), lengthPrefixed(certificates), sdk]);
  return Buffer.concat([lengthPrefixed(signed), lengthPrefixed(Buffer.alloc(0)), lengthPrefixed(Buffer.alloc(0))]);
};

const schemeValue = (signers: readonly Buffer[]): Buffer => lengthPrefixed(Buffer.concat(signers.map((signer) => lengthPrefixed(signer))));

const rawSigner = (options: { digests?: Buffer; certificates?: Buffer }): Buffer => {
  const signed = Buffer.concat([lengthPrefixed(options.digests ?? Buffer.alloc(0)), lengthPrefixed(options.certificates ?? Buffer.alloc(0))]);
  return Buffer.concat([lengthPrefixed(signed), lengthPrefixed(Buffer.alloc(0)), lengthPrefixed(Buffer.alloc(0))]);
};

const ipsReport = (metadata: Record<string, unknown>, body: Record<string, unknown>): string => `${JSON.stringify(metadata)}\n${JSON.stringify(body)}`;

const crashBody = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  procName: 'Example',
  pid: 4242,
  parentProc: 'launchd',
  parentPid: 1,
  cpuType: 'ARM-64',
  translated: false,
  faultingThread: 0,
  threads: [{ id: 1, triggered: true, frames: [{ imageIndex: 0, imageOffset: 8 }] }],
  usedImages: [{ source: 'P', base: 4096, size: 64, uuid: 'U', name: 'Example' }],
  ...patch,
});

test('identifies a complete Flutter APK from a synthetic archive', async () => {
  const targets = await tempTargets();
  const libapp = completeLibapp();
  const libflutter = completeLibflutter();
  const apk = flutterApk({ libapp, libflutter });
  const path = await targets.write('app.apk', apk);
  const identified = await identifyFlutterBuildFromPath(path);

  expect(identified.path).toBe(path);
  expect(identified.resolvedPath).toBe(realpathSync(path));
  expect(identified.record.target).toStrictEqual({ path: realpathSync(path), bytes: apk.length, sha256: sha256Of(apk) });
  expect(identified.record.coverage).toBe('complete');
  expect(identified.record.abis).toStrictEqual([
    {
      abi: 'arm64-v8a',
      libapp: {
        present: true,
        bytes: libapp.length,
        sha256: sha256Of(libapp),
        elf_header_valid: true,
        snapshot_hash_sources: 2,
        snapshot_hash_candidates: ['a'.repeat(32)],
        snapshot_hash: 'a'.repeat(32),
      },
      libflutter: {
        present: true,
        bytes: libflutter.length,
        sha256: sha256Of(libflutter),
        build_id: '00112233445566778899aabbccddeeff',
        build_id_candidates: ['00112233445566778899aabbccddeeff'],
        dart_version: null,
        toolchain_lines: [],
        dart_version_capped: false,
        toolchain_capped: false,
      },
    },
  ]);
  expect(identified.limitations).toHaveLength(6);
});

test('identifies the Flutter fixture as a partial observation', async () => {
  const identified = await identifyFlutterBuildFromPath(fixturePath('targets/flutter/demo.apk'));
  const record = identified.record;

  expect(record.flutter_detected).toBe(true);
  expect(record.coverage).toBe('partial');
  expect(record.abis[0]?.libapp.snapshot_hash_sources).toBe(0);
  expect(record.abis[0]?.libapp.elf_header_valid).toBe(false);
  expect(record.abis[0]?.libflutter.dart_version).toBe('Dart VM version: 3.2.0');
  expect(record.abis[0]?.libflutter.build_id).toBeNull();
  expect(identified.limitations).toContain('lib/arm64-v8a/libflutter.so: unsupported ELF class');
  expect(identified.limitations).toContain(
    'lib/arm64-v8a/libapp.so carries 0 observed snapshot header(s); complete coverage of the supported legacy split VM/isolate profile requires two independent sources. Unified and other layouts remain unverified',
  );
});

test('reports an archive with no Flutter payload as not detected', async () => {
  const targets = await tempTargets();
  const path = await targets.write('plain.apk', zipOf([{ name: 'classes.dex', data: 'dex\n' }]));
  const identified = await identifyFlutterBuildFromPath(path);

  expect(identified.record.flutter_detected).toBe(false);
  expect(identified.record.abis).toStrictEqual([]);
  expect(identified.record.coverage).toBe('complete');
  expect(identified.limitations).toHaveLength(7);
  expect(identified.limitations.at(-1)).toBe('No lib/*/libapp.so was found; the target does not carry a Flutter AOT payload');
});

test('marks an ABI with only libapp.so as partial coverage', async () => {
  const targets = await tempTargets();
  const path = await targets.write('half.apk', flutterApk({ libapp: completeLibapp() }));
  const identified = await identifyFlutterBuildFromPath(path);

  expect(identified.record.coverage).toBe('partial');
  expect(identified.record.abis[0]?.libflutter.present).toBe(false);
  expect(identified.record.abis[0]?.libapp.snapshot_hash).toBe('a'.repeat(32));
});

test('records declared sizes for a member that cannot be decompressed', async () => {
  const targets = await tempTargets();
  const libapp = completeLibapp();
  const apk = zipOf([
    { name: 'lib/x86/libapp.so', data: libapp, method: 99 },
    { name: 'lib/x86/libflutter.so', data: completeLibflutter() },
  ]);
  const path = await targets.write('odd.apk', apk);
  const identified = await identifyFlutterBuildFromPath(path);

  expect(identified.record.abis[0]?.libapp).toStrictEqual({
    present: true,
    bytes: libapp.length,
    sha256: null,
    elf_header_valid: null,
    snapshot_hash_sources: 0,
    snapshot_hash_candidates: [],
    snapshot_hash: null,
  });
  expect(identified.record.abis[0]?.libflutter.sha256).toBe(sha256Of(completeLibflutter()));
});

test('selects the preferred ABI when several carry libapp.so', async () => {
  const targets = await tempTargets();
  const apk = zipOf([
    { name: 'lib/x86_64/libapp.so', data: completeLibapp() },
    { name: 'lib/x86_64/libflutter.so', data: completeLibflutter() },
    { name: 'lib/arm64-v8a/libapp.so', data: completeLibapp() },
    { name: 'lib/arm64-v8a/libflutter.so', data: completeLibflutter() },
  ]);
  const path = await targets.write('multi.apk', apk);
  const aot = await inspectDartAotFromPath(path);

  expect(aot.record.abi).toBe('arm64-v8a');
  expect(aot.record.coverage.state).toBe('partial');
});

test('falls back to the only ABI outside the preferred order', async () => {
  const targets = await tempTargets();
  const path = await targets.write('v7a.apk', flutterApk({ libapp: completeLibapp(), libflutter: completeLibflutter(), abi: 'armeabi-v7a' }));
  const aot = await inspectDartAotFromPath(path);

  expect(aot.record.abi).toBe('armeabi-v7a');
  expect(aot.record.library.path).toBe('lib/armeabi-v7a/libapp.so');
});

test('rejects an archive that is not a ZIP', async () => {
  const targets = await tempTargets();
  const path = await targets.write('note.txt', 'not a zip archive');
  const payload = await payloadOf(() => identifyFlutterBuildFromPath(path));

  expect(payload).toMatchObject({ code: 'invalid_request', details: { operation: 'identify_flutter_build' } });
  expect(firstIssueMessage(payload)).toContain('it is not a ZIP/APK');
});

test('rejects a Flutter path that cannot be read', async () => {
  const payload = await payloadOf(() => identifyFlutterBuildFromPath('/nonexistent/demo.apk'));
  expect(payload).toMatchObject({ code: 'invalid_request', details: { operation: 'identify_flutter_build' } });
  expect(firstIssueMessage(payload)).toContain('it could not be read');
});

test('resolves a relative Flutter path against the supplied cwd', async () => {
  const targets = await tempTargets();
  await targets.write('rel.apk', flutterApk({ libapp: completeLibapp(), libflutter: completeLibflutter() }));
  const identified = await identifyFlutterBuildFromPath('rel.apk', { cwd: targets.dir });

  expect(identified.path).toBe('rel.apk');
  expect(identified.resolvedPath).toBe(realpathSync(join(targets.dir, 'rel.apk')));
  expect(identified.record.flutter_detected).toBe(true);
});

const invalidElfHeaders = [
  { name: 'foreign bytes', bytes: Buffer.from('not an elf image'), reason: 'not an ELF image' },
  { name: 'short ident', bytes: elf64({ bytes: 10 }), reason: 'ELF identification is truncated' },
  { name: 'unknown class', bytes: elf64({ identClass: 3 }), reason: 'unsupported ELF class' },
  { name: 'unknown endianness', bytes: elf64({ identData: 3 }), reason: 'unsupported ELF endianness' },
  { name: 'ident version', bytes: elf64({ identVersion: 2 }), reason: 'unsupported ELF identification version' },
  { name: 'big endian', bytes: elf64({ identData: 2 }), reason: 'unsupported ELF byte order' },
  { name: 'short elf64', bytes: elf64({ bytes: 40 }), reason: 'truncated ELF header: an ELF64 header needs 64 bytes; the file has 40' },
  { name: 'short elf32', bytes: elf32({ bytes: 48 }), reason: 'truncated ELF header: an ELF32 header needs 52 bytes; the file has 48' },
  { name: 'header below minimum', bytes: elf64({ headerSize: 32 }), reason: 'unsupported ELF header size' },
  { name: 'header beyond file', bytes: elf64({ headerSize: 200 }), reason: 'unsupported ELF header size' },
  { name: 'header not canonical', bytes: elf64({ headerSize: 72 }), reason: 'unsupported ELF header size' },
  { name: 'unknown type', bytes: elf64({ type: 4 }), reason: 'unsupported ELF type' },
  { name: 'section offset inside header', bytes: elf64({ type: 2, shentsize: 64, shnum: 1 }), reason: 'ELF section header table is missing or out of bounds' },
  { name: 'section width', bytes: elf64({ type: 2, shoff: 64n, shentsize: 32, shnum: 1 }), reason: 'ELF section header table is missing or out of bounds' },
  { name: 'section count', bytes: elf64({ type: 2, shoff: 64n, shentsize: 64 }), reason: 'ELF section header table is missing or out of bounds' },
  { name: 'section past file', bytes: elf64({ type: 2, shoff: 64n, shentsize: 64, shnum: 2 }), reason: 'ELF section header table is missing or out of bounds' },
  { name: 'section offset overflow', bytes: elf64({ shoff: 0x0020_0000_0000_0000n }), reason: 'ELF section header table is missing or out of bounds' },
  { name: 'program count zero', bytes: elf64({ phnum: 0 }), reason: 'ELF program header table is missing or out of bounds' },
  { name: 'program count sentinel', bytes: elf64({ phnum: 0xffff }), reason: 'ELF program header table is missing or out of bounds' },
  { name: 'program width', bytes: elf64({ phentsize: 32 }), reason: 'ELF program header table is missing or out of bounds' },
  { name: 'program offset', bytes: elf64({ phoff: 200 }), reason: 'ELF program header table is missing or out of bounds' },
];

test.for(invalidElfHeaders)('reports $name in libflutter.so as a build-id failure', async ({ bytes, reason }) => {
  const targets = await tempTargets();
  const apk = zipOf([
    { name: 'lib/arm64-v8a/libapp.so', data: completeLibapp() },
    { name: 'lib/arm64-v8a/libflutter.so', data: bytes },
  ]);
  const path = await targets.write('bad.apk', apk);
  const identified = await identifyFlutterBuildFromPath(path);
  const flutter = identified.record.abis[0]?.libflutter;

  expect(flutter?.build_id).toBeNull();
  expect(flutter?.build_id_candidates).toStrictEqual([]);
  expect(identified.limitations).toContain(`lib/arm64-v8a/libflutter.so: ${reason}`);
});

test('accepts a 32-bit little-endian ELF header for libapp.so', async () => {
  const targets = await tempTargets();
  const path = await targets.write('elf32.apk', flutterApk({ libapp: elf32(), libflutter: completeLibflutter() }));
  const identified = await identifyFlutterBuildFromPath(path);

  expect(identified.record.abis[0]?.libapp.elf_header_valid).toBe(true);
});

test('caps Dart version labels past the projection limit', async () => {
  const targets = await tempTargets();
  const toolchains = ['Android (1) clang version 1', 'Android (2) clang version 2', 'Android (3) clang version 3', 'Android (4) clang version 4', 'based on LLVM 14.0.6'];
  const labels = ['Dart VM version: 3.2.0', 'Dart VM version: 3.3.0', ...toolchains];
  const libflutter = Buffer.concat([elf64(), Buffer.from(labels.join('\u0000'), 'latin1')]);
  const path = await targets.write('labels.apk', flutterApk({ libapp: completeLibapp(), libflutter }));

  const identified = await identifyFlutterBuildFromPath(path);
  const flutter = identified.record.abis[0]?.libflutter;

  expect(flutter?.dart_version).toBe('Dart VM version: 3.2.0');
  expect(flutter?.dart_version_capped).toBe(true);
  expect(flutter?.toolchain_lines).toStrictEqual(toolchains.slice(0, 4));
  expect(flutter?.toolchain_capped).toBe(true);
  expect(identified.record.coverage).toBe('partial');
  expect(identified.limitations).toContain('lib/arm64-v8a/libflutter.so has toolchain labels omitted by the complete-label grammar or the 4-line projection');
});

test('rejects labels that miss the complete-label grammar', async () => {
  const targets = await tempTargets();
  const labels = [`Dart VM version: ${'9'.repeat(201)}`, 'Android (1) clang version', 'based on LLVM x'];
  const libflutter = Buffer.concat([elf64(), Buffer.from(labels.join('\u0000'), 'latin1')]);
  const path = await targets.write('bad-labels.apk', flutterApk({ libapp: completeLibapp(), libflutter }));

  const identified = await identifyFlutterBuildFromPath(path);
  const flutter = identified.record.abis[0]?.libflutter;

  expect(flutter?.dart_version).toBeNull();
  expect(flutter?.dart_version_capped).toBe(true);
  expect(flutter?.toolchain_lines).toStrictEqual([]);
  expect(flutter?.toolchain_capped).toBe(true);
});

test('stops scanning a snapshot magic that is cut short', async () => {
  const targets = await tempTargets();
  const libapp = Buffer.concat([elf64(), DART_MAGIC, Buffer.alloc(10)]);
  const path = await targets.write('cut-hash.apk', flutterApk({ libapp, libflutter: completeLibflutter() }));
  const identified = await identifyFlutterBuildFromPath(path);

  expect(identified.record.abis[0]?.libapp.snapshot_hash_sources).toBe(0);
  expect(identified.record.abis[0]?.libapp.snapshot_hash_candidates).toStrictEqual([]);
});

test('stops collecting build ids after eight notes', async () => {
  const targets = await tempTargets();
  const notes = Array.from({ length: 9 }, (_unused, index) => Buffer.concat([Buffer.from('GNU\u0000', 'latin1'), Buffer.from(index.toString(16).padStart(2, '0').repeat(8), 'hex')]));
  const libflutter = Buffer.concat([elf64(), ...notes]);
  const path = await targets.write('many-ids.apk', flutterApk({ libapp: completeLibapp(), libflutter }));
  const identified = await identifyFlutterBuildFromPath(path);

  expect(identified.record.abis[0]?.libflutter.build_id_candidates).toHaveLength(8);
  expect(identified.record.abis[0]?.libflutter.build_id).toBeNull();
});

test('ignores a duplicated toolchain label', async () => {
  const targets = await tempTargets();
  const label = 'Android (1) clang version 14.0.6';
  const libflutter = Buffer.concat([elf64(), Buffer.from([label, label].join('\u0000'), 'latin1')]);
  const path = await targets.write('duplicate-label.apk', flutterApk({ libapp: completeLibapp(), libflutter }));
  const identified = await identifyFlutterBuildFromPath(path);

  expect(identified.record.abis[0]?.libflutter.toolchain_lines).toStrictEqual([label]);
  expect(identified.record.abis[0]?.libflutter.toolchain_capped).toBe(false);
});

test('selects an ABI outside the preferred order', async () => {
  const targets = await tempTargets();
  const path = await targets.write('mips.apk', flutterApk({ libapp: completeLibapp(), libflutter: completeLibflutter(), abi: 'mips' }));
  const aot = await inspectDartAotFromPath(path);

  expect(aot.record.abi).toBe('mips');
  expect(aot.record.library.path).toBe('lib/mips/libapp.so');
});

test('truncates a full dart URI pool', async () => {
  const targets = await tempTargets();
  const uris = Array.from({ length: 64 }, (_unused, index) => `dart:core_${String(index)}`);
  const libapp = Buffer.concat([elf64(), Buffer.from(uris.join('\u0000'), 'latin1')]);
  const path = await targets.write('dart-pool.apk', flutterApk({ libapp, libflutter: completeLibflutter() }));
  const aot = await inspectDartAotFromPath(path);

  expect(aot.record.string_pool.dart_uris).toHaveLength(64);
  expect(aot.record.string_pool.truncated).toBe(true);
});

test('keeps two build-id candidates without choosing one', async () => {
  const targets = await tempTargets();
  const libflutter = Buffer.concat([elf64(), Buffer.from('GNU\u0000', 'latin1'), Buffer.from('00112233445566778899aabbccddeeff', 'hex'), Buffer.from('GNU\u0000', 'latin1'), Buffer.from('ffeeddccbbaa99887766554433221100', 'hex')]);
  const path = await targets.write('two-ids.apk', flutterApk({ libapp: completeLibapp(), libflutter }));
  const identified = await identifyFlutterBuildFromPath(path);

  expect(identified.record.abis[0]?.libflutter.build_id).toBeNull();
  expect(identified.record.abis[0]?.libflutter.build_id_candidates).toHaveLength(2);
});

test('caps snapshot hash candidates at sixty-four', async () => {
  const targets = await tempTargets();
  const hashes = Array.from({ length: 65 }, (_unused, index) => index.toString(16).padStart(32, '0'));
  const libapp = Buffer.concat([elf64(), ...hashes.map((hash) => dartSnapshot(hash))]);
  const path = await targets.write('many-hashes.apk', flutterApk({ libapp, libflutter: completeLibflutter() }));
  const identified = await identifyFlutterBuildFromPath(path);

  expect(identified.record.abis[0]?.libapp.snapshot_hash_sources).toBe(65);
  expect(identified.record.abis[0]?.libapp.snapshot_hash_candidates).toHaveLength(64);
  expect(identified.record.abis[0]?.libapp.snapshot_hash).toBeNull();
});

test('projects the Dart AOT payload with its string pool', async () => {
  const targets = await tempTargets();
  const text = '\u0001package:app/main.dart\u0000package:app/model.dart\u0000dart:core\u0000dart:async';
  const libapp = Buffer.concat([elf64(), dartSnapshot('b'.repeat(32)), dartSnapshot('c'.repeat(32)), Buffer.from(text, 'latin1')]);
  const apk = flutterApk({ libapp, libflutter: completeLibflutter() });
  const path = await targets.write('aot.apk', apk);
  const aot = await inspectDartAotFromPath(path);

  expect(aot.path).toBe(path);
  expect(aot.record).toMatchObject({
    abi: 'arm64-v8a',
    library: { path: 'lib/arm64-v8a/libapp.so', bytes: libapp.length, sha256: sha256Of(libapp) },
    snapshot_hash: null,
    string_pool: {
      package_uris: ['package:app/main.dart', 'package:app/model.dart'],
      dart_uris: ['dart:core', 'dart:async'],
      identifiers: [],
      truncated: false,
    },
    coverage: { state: 'partial', issues: ['Legacy split VM/isolate export offsets are not recovered without a full dynamic-symbol walk in this unit.', 'Snapshot hash candidates observed: 2'] },
  });
  expect(aot.record.snapshots.map((snapshot) => snapshot.name)).toStrictEqual(['vm_data', 'vm_instructions', 'isolate_data', 'isolate_instructions']);
  expect(aot.record.limitations.at(-1)).toBe('String-pool entries are byte-pattern observations, not deserialized cluster semantics.');
});

test('truncates a full Dart string pool', async () => {
  const targets = await tempTargets();
  const packages = Array.from({ length: 64 }, (_unused, index) => `package:p${index}/x.dart`);
  const text = `\u0001${packages.join('\u0000')}`;
  const libapp = Buffer.concat([elf64(), dartSnapshot('d'.repeat(32)), Buffer.from(text, 'latin1')]);
  const path = await targets.write('full-pool.apk', flutterApk({ libapp, libflutter: completeLibflutter() }));
  const aot = await inspectDartAotFromPath(path);

  expect(aot.record.snapshot_hash).toBe('d'.repeat(32));
  expect(aot.record.string_pool.package_uris).toHaveLength(64);
  expect(aot.record.string_pool.truncated).toBe(true);
});

test('refuses Dart AOT inspection without any libapp.so', async () => {
  const targets = await tempTargets();
  const path = await targets.write('no-app.apk', zipOf([{ name: 'classes.dex', data: 'dex\n' }]));
  const payload = await payloadOf(() => inspectDartAotFromPath(path));

  expect(payload.code).toBe('invalid_request');
  expect(firstIssueMessage(payload)).toContain('no libapp.so ABI was found');
});

test('refuses Dart AOT inspection for an ABI outside the archive', async () => {
  const targets = await tempTargets();
  const path = await targets.write('one-abi.apk', flutterApk({ libapp: completeLibapp(), libflutter: completeLibflutter() }));
  const payload = await payloadOf(() => inspectDartAotFromPath(path, { abi: 'x86_64' }));

  expect(payload.code).toBe('invalid_request');
  expect(firstIssueMessage(payload)).toContain('ABI "x86_64" has no libapp.so');
});

test('refuses Dart AOT inspection for an ABI that only carries libflutter.so', async () => {
  const targets = await tempTargets();
  const apk = zipOf([
    { name: 'lib/arm64-v8a/libapp.so', data: completeLibapp() },
    { name: 'lib/x86_64/libflutter.so', data: completeLibflutter() },
  ]);
  const path = await targets.write('split.apk', apk);
  const payload = await payloadOf(() => inspectDartAotFromPath(path, { abi: 'x86_64' }));

  expect(payload.code).toBe('invalid_request');
  expect(firstIssueMessage(payload)).toContain('ABI "x86_64" has no libapp.so');
});

test('refuses Dart AOT inspection for an unrecognized libapp.so ELF', async () => {
  const targets = await tempTargets();
  const path = await targets.write('bad-app.apk', flutterApk({ libapp: Buffer.from('not an elf'), libflutter: completeLibflutter() }));
  const payload = await payloadOf(() => inspectDartAotFromPath(path, { abi: 'arm64-v8a' }));

  expect(payload).toMatchObject({ code: 'unsupported_target', category: 'unsupported_target' });
  expect(payload.details?.['reason']).toBe('No recognizable legacy split Dart snapshot symbols were found: not an ELF image');
  expect(payload.details?.['operation']).toBe('inspect_dart_aot');
});

test('records the exact APK signature posture of the v1 fixture', async () => {
  const signature = await inspectApkSignatureFromPath(fixturePath('targets/apk/v1-only.apk'));

  expect(signature.record.schemes.v1.signature_files).toStrictEqual(['META-INF/CERT.SF']);
  expect(signature.record.schemes.v1.block_files).toStrictEqual(['META-INF/CERT.RSA']);
  expect(signature.record.schemes.v1.has_manifest).toBe(true);
  expect(signature.record.schemes.v1.signers).toStrictEqual([
    {
      signature_file: 'META-INF/CERT.SF',
      block_file: 'META-INF/CERT.RSA',
      certificate: null,
      certificates: [],
      signer_infos: [],
      decode_error: 'malformed PKCS#7: contentType has tag 0x2, expected 0x6',
    },
  ]);
  expect(signature.record.posture).toStrictEqual({
    v1_only: true,
    schemes_agree_on_signer: null,
    signer_change_declared_by_rotation: false,
    v1_signers_match_block_signers: null,
    rotation_present: false,
    source_stamp_present: false,
    strongest_scheme: 'v1',
    self_consistent: null,
  });
  expect(signature.record.runtime_execution).toBe('not-performed');
  expect(signature.record.limitations).toHaveLength(5);
});

test('rejects a v2 signers sequence with an oversized length', async () => {
  const targets = await tempTargets();
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { prelude: signingBlock([idValuePair(APK_SIG_V2, Buffer.from([0xff, 0xff, 0xff, 0xff, 1, 2, 3, 4]))]) });
  const path = await targets.write('oversized-scheme.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2).toStrictEqual({ present: true, signers: [], uninterpreted_bytes: 8 });
  expect(record.posture.schemes_agree_on_signer).toBe(true);
});

test('stops at a v2 signer whose length prefix overruns', async () => {
  const targets = await tempTargets();
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { prelude: signingBlock([idValuePair(APK_SIG_V2, lengthPrefixed(Buffer.from([0x10, 0, 0, 0])))]) });
  const path = await targets.write('oversized-signer.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2).toStrictEqual({ present: true, signers: [], uninterpreted_bytes: 4 });
});

test('stops at a certificate whose length prefix overruns', async () => {
  const targets = await tempTargets();
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { prelude: signingBlock([idValuePair(APK_SIG_V2, schemeValue([rawSigner({ certificates: Buffer.from([0x10, 0, 0, 0]) })]))]) });
  const path = await targets.write('oversized-cert.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2.signers[0]).toStrictEqual({ index: 0, certificates: [], digest_algorithms: [], min_sdk: null, max_sdk: null, decode_error: null });
});

test('ignores a digest shorter than its algorithm identifier', async () => {
  const targets = await tempTargets();
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { prelude: signingBlock([idValuePair(APK_SIG_V2, schemeValue([rawSigner({ digests: Buffer.from([2, 0, 0, 0, 0xaa, 0xbb]) })]))]) });
  const path = await targets.write('short-digest.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2.signers[0]?.digest_algorithms).toStrictEqual([]);
});

test.for([
  { name: 'long-form length header', bytes: Buffer.from([0x30, 0x81, 0xff, 0x30, 0x30, 0x30, 0x30]), error: 'malformed PKCS#7: contentType has tag 0x30, expected 0x6' },
  { name: 'five-byte length header', bytes: Buffer.from([0x30, 0x85, 1, 2, 3, 4, 5]), error: 'no X.509 certificates decoded from the PKCS#7 block' },
])('reports a PKCS#7 block with a $name', async ({ bytes, error }) => {
  const targets = await tempTargets();
  const apk = zipOf([
    { name: 'META-INF/CERT.SF', data: 'x' },
    { name: 'META-INF/CERT.RSA', data: bytes },
  ]);
  const path = await targets.write('der-shape.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v1.signers[0]?.decode_error).toBe(error);
  expect(record.schemes.v1.signers[0]?.certificates).toStrictEqual([]);
});

test('decodes a v2 signer certificate from a synthetic signing block', async () => {
  const targets = await tempTargets();
  const signer = blockSigner({ certificates: [CERT_DER], digests: [Buffer.from([0x02, 0x01, 0x02, 0x03])], minSdk: 24, maxSdk: 34 });
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { prelude: signingBlock([idValuePair(APK_SIG_V2, schemeValue([signer]))]) });
  const path = await targets.write('v2.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2).toStrictEqual({
    present: true,
    signers: [
      {
        index: 0,
        certificates: [
          {
            der_sha256: sha256Of(CERT_DER),
            subject: 'CN=pi-rea test\nC=US',
            issuer: 'CN=pi-rea test\nC=US',
            serial_hex: 'beef',
            not_before: '2026-10-28T20:42:37.000Z',
            not_after: '2036-10-25T20:42:37.000Z',
          },
        ],
        digest_algorithms: ['0x3020102'],
        min_sdk: 24,
        max_sdk: 34,
        decode_error: null,
      },
    ],
    uninterpreted_bytes: 0,
  });
  expect(record.posture.schemes_agree_on_signer).toBe(true);
  expect(record.posture.strongest_scheme).toBe('v2');
});

test('separates the v2 signer set from the v3 signer set', async () => {
  const targets = await tempTargets();
  const other = Buffer.from('another certificate body');
  const shared = blockSigner({ certificates: [CERT_DER] });
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], {
    prelude: signingBlock([idValuePair(APK_SIG_V2, schemeValue([shared])), idValuePair(APK_SIG_V3, schemeValue([blockSigner({ certificates: [other] })]))]),
  });
  const path = await targets.write('rotated.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2.present).toBe(true);
  expect(record.schemes.v3.present).toBe(true);
  expect(record.posture.schemes_agree_on_signer).toBe(false);
  expect(record.posture.strongest_scheme).toBe('v3');
});

test('reports unknown signer agreement when a signer carries no certificate', async () => {
  const targets = await tempTargets();
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], {
    prelude: signingBlock([idValuePair(APK_SIG_V2, schemeValue([blockSigner({})])), idValuePair(APK_SIG_V31, schemeValue([blockSigner({ certificates: [CERT_DER] })]))]),
  });
  const path = await targets.write('nocert.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.posture.schemes_agree_on_signer).toBeNull();
  expect(record.posture.strongest_scheme).toBe('v3.1');
});

test('decodes a source stamp certificate from the signing block', async () => {
  const targets = await tempTargets();
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { prelude: signingBlock([idValuePair(APK_SIG_SOURCE_STAMP, lengthPrefixed(CERT_DER))]) });
  const path = await targets.write('stamp.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.source_stamp.present).toBe(true);
  expect(record.source_stamp.certificate?.der_sha256).toBe(sha256Of(CERT_DER));
  expect(record.source_stamp.certificate?.serial_hex).toBe('beef');
  expect(record.source_stamp.decode_error).toBeNull();
  expect(record.posture.source_stamp_present).toBe(true);
});

test('reports a truncated source stamp certificate', async () => {
  const targets = await tempTargets();
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { prelude: signingBlock([idValuePair(APK_SIG_SOURCE_STAMP, Buffer.alloc(0))]) });
  const path = await targets.write('stamp-short.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.source_stamp).toStrictEqual({ present: true, certificate: null, decode_error: 'truncated source stamp certificate' });
});

test.for([
  { name: 'short signer', signer: Buffer.from([1, 2]), error: 'truncated signer' },
  { name: 'short digest block', signer: lengthPrefixed(Buffer.from([1, 2])), error: 'truncated signed-data digests' },
  { name: 'missing certificate block', signer: lengthPrefixed(lengthPrefixed(Buffer.alloc(4))), error: 'truncated signed-data certificates' },
])('records a $name decode error inside a v2 signer', async ({ signer, error }) => {
  const targets = await tempTargets();
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { prelude: signingBlock([idValuePair(APK_SIG_V2, schemeValue([signer]))]) });
  const path = await targets.write('broken-signer.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2.present).toBe(true);
  expect(record.schemes.v2.signers[0]?.decode_error).toBe(error);
  expect(record.schemes.v2.signers[0]?.certificates).toStrictEqual([]);
});

test('ignores a signing-block pair shorter than its own header', async () => {
  const targets = await tempTargets();
  const pair = Buffer.alloc(12);
  pair.writeBigUInt64LE(2n, 0);
  pair.writeUInt32LE(APK_SIG_V2, 8);
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { prelude: signingBlock([pair]) });
  const path = await targets.write('short-pair.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2).toStrictEqual({ present: false, signers: [], uninterpreted_bytes: 0 });
});

test('reports an APK without any signing scheme', async () => {
  const targets = await tempTargets();
  const path = await targets.write('empty.apk', zipOf([]));
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v1.present).toBe(false);
  expect(record.posture.strongest_scheme).toBe('none');
  expect(record.posture.v1_only).toBe(false);
});

test('reports a v1 block without its signature file as absent', async () => {
  const targets = await tempTargets();
  const path = await targets.write('orphan.apk', zipOf([{ name: 'META-INF/CERT.RSA', data: 'no signature file' }]));
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v1.block_files).toStrictEqual(['META-INF/CERT.RSA']);
  expect(record.schemes.v1.signature_files).toStrictEqual([]);
  expect(record.schemes.v1.present).toBe(false);
});

test('reports a PKCS#7 block without any decodable certificate', async () => {
  const targets = await tempTargets();
  const path = await targets.write(
    'plain-block.apk',
    zipOf([
      { name: 'META-INF/CERT.SF', data: 'x' },
      { name: 'META-INF/CERT.RSA', data: 'plain text' },
    ]),
  );
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v1.signers[0]?.decode_error).toBe('no X.509 certificates decoded from the PKCS#7 block');
});

test('reports a v1 block whose local header is unreadable', async () => {
  const targets = await tempTargets();
  const apk = zipOf([
    { name: 'META-INF/CERT.SF', data: 'x' },
    { name: 'META-INF/CERT.RSA', data: 'plain text', localOffset: 4096 },
  ]);
  const path = await targets.write('broken-local.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v1.signers[0]?.decode_error).toBe('No local header for META-INF/CERT.RSA.');
});

test('reads a ZIP64 end-of-central-directory locator', async () => {
  const targets = await tempTargets();
  const apk = zip64Of([{ name: 'classes.dex', data: 'dex\n' }]);
  const path = await targets.write('zip64.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.artifact).toStrictEqual({ path: realpathSync(path), sha256: sha256Of(apk), bytes: apk.length });
  expect(record.schemes.v1.present).toBe(false);
  expect(record.posture.strongest_scheme).toBe('none');
});

test.for([
  { name: 'below the minimum', declared: 24, stored: 8 },
  { name: 'beyond the directory', declared: 24, stored: 1_000_000 },
  { name: 'inconsistent', declared: 40, stored: 48 },
])('ignores a signing block with a $name size field', async ({ declared, stored }) => {
  const targets = await tempTargets();
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { prelude: signingBlock([], declared, stored) });
  const path = await targets.write('bad-block.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2.present).toBe(false);
  expect(record.posture.strongest_scheme).toBe('none');
});

test('ignores a signing block that starts before the file', async () => {
  const targets = await tempTargets();
  const body = Buffer.alloc(0);
  const cdOffset = 8 + body.length + 24;
  const apk = zipOf([], { prelude: signingBlock([], cdOffset - 4, cdOffset - 4) });
  const path = await targets.write('negative-start.apk', apk);
  const { record } = await inspectApkSignatureFromPath(path);

  expect(record.schemes.v2.present).toBe(false);
});

test('rejects an archive without an end-of-central-directory record', async () => {
  const targets = await tempTargets();
  const path = await targets.write('no-eocd.apk', Buffer.alloc(64));
  const payload = await payloadOf(() => inspectApkSignatureFromPath(path));

  expect(payload.code).toBe('invalid_request');
  expect(firstIssueMessage(payload)).toContain('no ZIP end-of-central-directory record was found');
});

test('surfaces a raw ZIP directory error for an out-of-range directory', async () => {
  const targets = await tempTargets();
  const apk = zipOf([{ name: 'classes.dex', data: 'dex\n' }], { centralDirectoryOffset: 0xfffffff0 });
  const path = await targets.write('wild-cd.apk', apk);
  const thrown = await thrownOf(() => inspectApkSignatureFromPath(path));

  expect(thrown.name).toBe('ZipError');
  expect((thrown as Error & { payload?: unknown }).payload).toBeUndefined();
  expect(thrown.message).toBe('The central directory extends past the end of the file.');
});

test('rejects an APK path that cannot be read', async () => {
  const payload = await payloadOf(() => inspectApkSignatureFromPath('/nonexistent/app.apk'));
  expect(payload.code).toBe('invalid_request');
  expect(firstIssueMessage(payload)).toContain('it could not be read');
});

test('stops at a note whose descriptor runs past the segment', async () => {
  const targets = await tempTargets();
  const rawNotes = Buffer.alloc(16);
  rawNotes.writeUInt32LE(4, 0);
  rawNotes.writeUInt32LE(64, 4);
  rawNotes.writeUInt32LE(3, 8);
  rawNotes.write('X\u0000\u0000\u0000', 12, 'latin1');
  const path = await targets.write('truncated-note.core', coreImage({ rawNotes }));
  const { record } = await inspectRecordedCrashFromPath(path);

  expect(record.notes).toStrictEqual([]);
  expect(record.coverage.examined_notes).toBe(0);
});

test('leaves a siginfo descriptor below sixteen bytes unparsed', async () => {
  const targets = await tempTargets();
  const path = await targets.write('short-siginfo.core', coreImage({ notes: [{ owner: 'CORE', type: 0x53494749, desc: siginfo({ bytes: 8 }) }] }));
  const { record } = await inspectRecordedCrashFromPath(path);

  expect(record.notes[0]?.type_name).toBe('NT_SIGINFO');
  expect(record.notes[0]?.siginfo).toBeNull();
});

test('accepts the in-repo minimal ELF64 core fixture', async () => {
  const targets = await tempTargets();
  const bytes = minimalElf64CoreFixture();
  const path = await targets.write('minimal-fixture.core', bytes);
  const { record } = await inspectRecordedCrashFromPath(path);

  expect(bytes).toHaveLength(128);
  expect(record).toMatchObject({ format: 'elf64-core', machine: 62, machine_name: 'x86_64', type: 4, segments: [], notes: [] });
  expect(record.artifact.sha256).toBe(sha256Of(bytes));
});

test('records the recorded-crash fixture with no segments or notes', async () => {
  const inspection = await inspectRecordedCrashFromPath(fixturePath('targets/crash/minimal.core'));

  expect(inspection.record).toMatchObject({
    format: 'elf64-core',
    byte_order: 'little',
    machine: 62,
    machine_name: 'x86_64',
    type: 4,
    segments: [],
    notes: [],
    threads: [],
    coverage: { status: 'complete', examined_segments: 0, examined_notes: 0 },
  });
  expect(inspection.record.artifact.bytes).toBe(128);
  expect(inspection.record.limitations).toHaveLength(3);
});

test('decodes segments, notes, thread state from a synthetic core', async () => {
  const targets = await tempTargets();
  const registers = prstatus({ registers: true });
  const signal = siginfo({});
  const notes: CoreNote[] = [
    { owner: 'CORE', type: 1, desc: registers },
    { owner: 'CORE', type: 0x53494749, desc: signal },
    { owner: 'CORE', type: 3, desc: Buffer.alloc(8) },
    { owner: 'CORE', type: 4, desc: Buffer.alloc(8) },
    { owner: 'CORE', type: 5, desc: Buffer.alloc(8) },
    { owner: 'LINUX', type: 9, desc: Buffer.alloc(8) },
    { owner: 'CORE', type: 1, desc: Buffer.alloc(16) },
  ];
  const core = coreImage({ notes, loads: [5, 6] });
  const path = await targets.write('rich.core', core);
  const { record } = await inspectRecordedCrashFromPath(path);

  expect(record.segments).toStrictEqual([
    { index: 0, type: 1, flags: 5, offset: 64, virt_addr: '0x400000', phys_addr: '0x400000', file_size: 0, mem_size: 16, alignment: 8 },
    { index: 1, type: 1, flags: 6, offset: 64, virt_addr: '0x400000', phys_addr: '0x400000', file_size: 0, mem_size: 16, alignment: 8 },
  ]);
  expect(record.notes.map((note) => note.type_name)).toStrictEqual(['NT_PRSTATUS', 'NT_SIGINFO', 'NT_PRPSINFO', 'NT_TASKSTRUCT', 'NT_AUXV', 'note_9', 'NT_PRSTATUS']);
  expect(record.notes.map((note) => note.index)).toStrictEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(record.notes[0]?.owner).toBe('CORE');
  expect(record.notes[0]?.descriptor_sha256).toBe(sha256Of(registers));
  expect(record.notes[0]?.prstatus).toMatchObject({ signal: 11, pid: 4242, ppid: 1, descriptor_bytes: 336 });
  const threadRegisters = (record.notes[0]?.prstatus ?? {}) as { registers: Record<string, string> };
  expect(threadRegisters.registers['rip']).toBe('0x11');
  expect(Object.keys(threadRegisters.registers)).toHaveLength(21);
  expect(record.notes[1]?.siginfo).toStrictEqual({ si_signo: 11, si_errno: 0, si_code: 1, descriptor_bytes: 16 });
  expect(record.notes[6]?.prstatus).toBeNull();
  expect(record.threads).toStrictEqual([{ index: 0, note_index: 0, signal: 11, pid: 4242, registers: record.notes[0]?.prstatus?.['registers'] }]);
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_segments: 2, examined_notes: 7 });
});

test('records an AArch64 core without x86_64 register windows', async () => {
  const targets = await tempTargets();
  const core = coreImage({ machine: 183, notes: [{ owner: 'CORE', type: 1, desc: prstatus({ registers: true, pid: 7, signal: 6 }) }] });
  const path = await targets.write('arm.core', core);
  const { record } = await inspectRecordedCrashFromPath(path);

  expect(record.machine_name).toBe('aarch64');
  expect(record.notes[0]?.prstatus).toMatchObject({ signal: 6, pid: 7, registers: null });
  expect(record.coverage.examined_notes).toBe(1);
});

test('marks core coverage as partial when the note budget is exhausted', async () => {
  const targets = await tempTargets();
  const notes: CoreNote[] = [
    { owner: 'CORE', type: 3, desc: Buffer.alloc(8) },
    { owner: 'CORE', type: 3, desc: Buffer.alloc(8) },
  ];
  const path = await targets.write('budget.core', coreImage({ notes }));
  const { record } = await inspectRecordedCrashFromPath(path, { maxNotes: 1 });

  expect(record.notes).toHaveLength(1);
  expect(record.coverage.status).toBe('partial');
});

test('marks core coverage as partial when the segment budget is exceeded', async () => {
  const targets = await tempTargets();
  const path = await targets.write('segments.core', coreImage({ loads: [5, 6, 7] }));
  const { record } = await inspectRecordedCrashFromPath(path, { maxSegments: 2 });

  expect(record.segments).toHaveLength(2);
  expect(record.coverage.status).toBe('partial');
});

test('records the debugger-context limitation when requested', async () => {
  const targets = await tempTargets();
  const path = await targets.write('debug.core', coreImage());
  const { record } = await inspectRecordedCrashFromPath(path, { includeDebuggerContext: true });

  expect(record.limitations).toHaveLength(4);
  expect(record.limitations.at(-1)).toContain('include_debugger_context was requested');
});

test('stops reading program headers that run past the file end', async () => {
  const targets = await tempTargets();
  const path = await targets.write('short-phdr.core', coreImage({ loads: [5], phentsize: 64, truncateTo: 100 }));
  const { record } = await inspectRecordedCrashFromPath(path);

  expect(record.segments).toStrictEqual([]);
  expect(record.coverage).toStrictEqual({ status: 'complete', examined_segments: 0, examined_notes: 0 });
});

test('reads a relative core path against the supplied cwd', async () => {
  const targets = await tempTargets();
  await targets.write('relative.core', coreImage({ machine: 62 }));
  const { record } = await inspectRecordedCrashFromPath('relative.core', { cwd: targets.dir });

  expect(record.machine_name).toBe('x86_64');
  expect(record.artifact.path).toBe(realpathSync(join(targets.dir, 'relative.core')));
});

test('rejects an empty core path', async () => {
  const payload = await payloadOf(() => inspectRecordedCrashFromPath(''));
  expect(payload).toMatchObject({ code: 'invalid_request', details: { operation: 'inspect_recorded_crash', parameter: 'path' } });
});

test('rejects a core path that cannot be resolved', async () => {
  const payload = await payloadOf(() => inspectRecordedCrashFromPath('/nonexistent/core.bin'));
  expect(firstIssueMessage(payload)).toContain('it could not be resolved');
});

test('rejects a directory as a core file', async () => {
  const targets = await tempTargets();
  const payload = await payloadOf(() => inspectRecordedCrashFromPath(targets.dir));
  expect(firstIssueMessage(payload)).toContain('it is not a regular file');
});

test('rejects a core larger than the byte budget', async () => {
  const targets = await tempTargets();
  const path = await targets.write('big.core', coreImage());
  const payload = await payloadOf(() => inspectRecordedCrashFromPath(path, { maxFileBytes: 32 }));

  expect(payload).toMatchObject({ code: 'unsupported_target', message: 'Core file exceeds max_file_bytes=32.' });
});

test.for([
  { name: 'not an ELF', bytes: Buffer.from('definitely not an elf core'), reason: 'not_elf' },
  { name: 'the wrong class', bytes: coreImage({ identClass: 1 }), reason: 'unsupported_elf_class_or_endian' },
  { name: 'big endian', bytes: coreImage({ identData: 2 }), reason: 'unsupported_elf_class_or_endian' },
])('refuses a core that is $name', async ({ bytes, reason }) => {
  const targets = await tempTargets();
  const path = await targets.write('bad.core', bytes);
  const payload = await payloadOf(() => inspectRecordedCrashFromPath(path));

  expect(payload).toMatchObject({ code: 'unsupported_target', message: 'inspect_recorded_crash accepts Linux ELF64 little-endian cores only.', details: { path, reason } });
});

test('refuses an ELF that is not a core', async () => {
  const targets = await tempTargets();
  const path = await targets.write('exec.elf', coreImage({ type: 2 }));
  const payload = await payloadOf(() => inspectRecordedCrashFromPath(path));

  expect(payload).toMatchObject({ code: 'unsupported_target', message: 'inspect_recorded_crash requires ELF type ET_CORE.', details: { path, type: 2 } });
});

test('refuses a core for an unsupported machine', async () => {
  const targets = await tempTargets();
  const path = await targets.write('mips.core', coreImage({ machine: 8 }));
  const payload = await payloadOf(() => inspectRecordedCrashFromPath(path));

  expect(payload).toMatchObject({ code: 'unsupported_target', message: 'inspect_recorded_crash accepts amd64 or AArch64 cores only.', details: { path, machine: 8 } });
});

test('inventories a PTX fixture as one standalone object', async () => {
  const inspection = await inspectGpuCodeObjectsFromPath(fixturePath('targets/gpu/sample.ptx'));

  expect(inspection.record.artifact).toStrictEqual({ path: inspection.resolvedPath, file_size: 148, sha256: '329f9ae5926573dd492583329766d5fcb5a8f682c9091c2f637c8038bcdf673a', bytes_read: 328 });
  expect(inspection.record.format).toBe('ptx');
  expect(inspection.record.analysis).toBe('inventory');
  expect(inspection.record.objects[0]).toMatchObject({ id: 'file@0', kind: 'ptx', target: 'sm_70', encoded_size: 148, inspection: 'inventory' });
  expect(inspection.record.kernels).toStrictEqual([]);
  expect(inspection.record.coverage).toStrictEqual({
    discovery_scope: 'supported-section-names-and-standalone-formats',
    discovery: 'complete',
    payloads: 'not-requested',
    examined_sections: 0,
    unknown_section_names: 0,
  });
});

test('projects PTX entry points when kernels are requested', async () => {
  const inspection = await inspectGpuCodeObjectsFromPath(fixturePath('targets/gpu/sample.ptx'), { analysis: 'kernels' });

  expect(inspection.record.kernels).toStrictEqual([{ object_id: 'file@0', name: 'add', kind: 'ptx_entry', target: 'sm_70', registers: null, shared_memory_bytes: null }]);
  expect(inspection.record.coverage.payloads).toBe('selected');
  expect(inspection.record.objects[0]?.inspection).toBe('kernels');
});

test('selects requested PTX objects against the expected digest', async () => {
  const targets = await tempTargets();
  const text = Buffer.from('.version 7.5\n.target sm_80\n.entry alpha\n.entry beta\n', 'latin1');
  const path = await targets.write('two.ptx', text);
  const inspection = await inspectGpuCodeObjectsFromPath(path, { analysis: 'kernels', expectedSha256: sha256Of(text), objectIds: ['file@0'] });

  expect(inspection.record.objects[0]?.inspection).toBe('kernels');
  expect(inspection.record.kernels.map((kernel) => kernel['name'])).toStrictEqual(['alpha', 'beta']);
  expect(inspection.record.coverage).toMatchObject({ payloads: 'selected' });
});

test('drops kernels whose object was not selected', async () => {
  const targets = await tempTargets();
  const text = Buffer.from('.version 7.5\n.target sm_80\n.entry alpha\n', 'latin1');
  const path = await targets.write('unselected.ptx', text);
  const inspection = await inspectGpuCodeObjectsFromPath(path, { expectedSha256: sha256Of(text), objectIds: ['section@9'] });

  expect(inspection.record.kernels).toStrictEqual([]);
  expect(inspection.record.objects[0]?.inspection).toBe('inventory');
});

test('rejects PTX text without a whitespace-separated target', async () => {
  const targets = await tempTargets();
  const path = await targets.write('odd.ptx', '.version 7.5\n.targetX\n');
  const payload = await payloadOf(() => inspectGpuCodeObjectsFromPath(path));

  expect(payload).toMatchObject({ code: 'invalid_request', details: { operation: 'inspect_gpu_code_objects' } });
  expect(firstIssueMessage(payload)).toContain('PTX text markers (.version/.target) were not observed.');
});

test.for([
  { name: '64-bit little-endian', bits: 64, little: true },
  { name: '64-bit big-endian', bits: 64, little: false },
  { name: '32-bit little-endian', bits: 32, little: true },
] as const)('inventories fatbin sections in a $name ELF host', async ({ bits, little }) => {
  const targets = await tempTargets();
  const fatbin = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const hip = Buffer.from([9, 9, 9, 9]);
  const elf = gpuElf({
    bits,
    little,
    sections: [{ name: '' }, { name: '.nv_fatbin', data: fatbin }, { name: '.hip_fat', data: hip }, { name: '.text', data: Buffer.from([0]) }, { name: '.shstrtab', strtab: true }],
  });
  const path = await targets.write('host.elf', elf);
  const inspection = await inspectGpuCodeObjectsFromPath(path);

  expect(inspection.record.format).toBe('elf');
  expect(inspection.record.objects.map((object) => object.kind)).toStrictEqual(['cuda-fatbin-section', 'hip-fatbin-section']);
  expect(inspection.record.objects.map((object) => object.id)).toStrictEqual(['section@1', 'section@2']);
  expect(inspection.record.objects[0]?.sha256).toBe(sha256Of(fatbin));
  expect(inspection.record.coverage).toStrictEqual({
    discovery_scope: 'supported-section-names-and-standalone-formats',
    discovery: 'complete',
    payloads: 'not-requested',
    examined_sections: 4,
    unknown_section_names: 0,
  });
});

test('adds the kernel-decode limitation for an ELF host', async () => {
  const targets = await tempTargets();
  const elf = gpuElf({ sections: [{ name: '' }, { name: '.nv_fatbin', data: Buffer.alloc(4) }, { name: '.shstrtab', strtab: true }] });
  const path = await targets.write('host-kernels.elf', elf);
  const inspection = await inspectGpuCodeObjectsFromPath(path, { analysis: 'kernels' });

  expect(inspection.record.analysis).toBe('kernels');
  expect(inspection.record.limitations.at(-1)).toBe('Selected kernel decode for ELF fatbin payloads is not implemented in this port; inventory rows remain.');
  expect(inspection.record.coverage.payloads).toBe('selected');
});

test('counts a fatbin section that runs past the file as unknown', async () => {
  const targets = await tempTargets();
  const elf = gpuElf({ sections: [{ name: '' }, { name: '.nv_fatbin', data: Buffer.alloc(4), size: 4096 }, { name: '.shstrtab', strtab: true }] });
  const path = await targets.write('overflow.elf', elf);
  const inspection = await inspectGpuCodeObjectsFromPath(path);

  expect(inspection.record.objects).toStrictEqual([]);
  expect(inspection.record.coverage.unknown_section_names).toBe(1);
});

test('resolves the final section name without a terminator', async () => {
  const targets = await tempTargets();
  const elf = gpuElf({ sections: [{ name: '' }, { name: '.nv_fatbin', data: Buffer.alloc(4) }, { name: '.shstrtab', strtab: true }] });
  const path = await targets.write('tail-name.elf', elf);
  const inspection = await inspectGpuCodeObjectsFromPath(path);

  expect(inspection.record.objects[0]?.location.section_name).toBe('.nv_fatbin');
  expect(inspection.record.coverage.examined_sections).toBe(2);
});

test('rejects an ELF host without a string table', async () => {
  const targets = await tempTargets();
  const elf = gpuElf({ sections: [{ name: '' }, { name: '.nv_fatbin', data: Buffer.alloc(4) }], shstrndx: 7 });
  const path = await targets.write('no-shstrtab.elf', elf);
  const payload = await payloadOf(() => inspectGpuCodeObjectsFromPath(path));

  expect(firstIssueMessage(payload)).toContain('ELF shstrtab missing');
});

test('rejects a host shorter than an ELF header', async () => {
  const targets = await tempTargets();
  const path = await targets.write('tiny.elf', Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const payload = await payloadOf(() => inspectGpuCodeObjectsFromPath(path));

  expect(firstIssueMessage(payload)).toContain('not an ELF host for GPU objects.');
});

test('rejects an object selection without an expected digest', async () => {
  const targets = await tempTargets();
  const path = await targets.write('select.ptx', '.version 7.5\n.target sm_70\n');
  const payload = await payloadOf(() => inspectGpuCodeObjectsFromPath(path, { objectIds: ['file@0'] }));

  expect(firstIssueMessage(payload)).toContain('object_ids require expected_sha256 from inventory.');
});

test('rejects an expected digest that does not match the file', async () => {
  const targets = await tempTargets();
  const path = await targets.write('digest.ptx', '.version 7.5\n.target sm_70\n');
  const payload = await payloadOf(() => inspectGpuCodeObjectsFromPath(path, { expectedSha256: 'f'.repeat(64) }));

  expect(firstIssueMessage(payload)).toContain('expected_sha256 does not match the current full-file digest.');
});

test('rejects an unknown GPU analysis mode', async () => {
  const targets = await tempTargets();
  const path = await targets.write('mode.ptx', '.version 7.5\n.target sm_70\n');
  const payload = await payloadOf(() => inspectGpuCodeObjectsFromPath(path, { analysis: 'sass' as 'inventory' }));

  expect(firstIssueMessage(payload)).toContain('analysis must be inventory or kernels.');
});

test('rejects a GPU container that is neither PTX nor ELF', async () => {
  const targets = await tempTargets();
  const path = await targets.write('blob.bin', 'no gpu objects here');
  const payload = await payloadOf(() => inspectGpuCodeObjectsFromPath(path));

  expect(firstIssueMessage(payload)).toContain('unsupported GPU code object container (expected PTX text or ELF host).');
});

test.for([
  { name: 'missing', path: '/nonexistent/sample.ptx', reason: 'no file exists there' },
  { name: 'unreadable', path: '', reason: 'it could not be read' },
])('reports a $name GPU input path', async ({ path, reason }) => {
  const targets = await tempTargets();
  const target = path === '' ? targets.dir : path;
  const payload = await payloadOf(() => inspectGpuCodeObjectsFromPath(target));

  expect(payload.code).toBe('invalid_request');
  expect(firstIssueMessage(payload)).toContain(reason);
});

test('projects every Apple IPS fixture thread', async () => {
  const inspection = await inspectAppleIpsFromPath(fixturePath('targets/ips/sample-crash.ips'));
  const record = inspection.record;

  expect(record.artifact.bytes).toBe(1227);
  expect(record.metadata).toStrictEqual({
    bug_type: '309',
    timestamp: '2024-01-02 03:04:05.678 +0000',
    os_version: '23A344',
    bundle_id: 'com.example.app',
    incident_id: 'ABC-123',
    name: 'Example',
    build_version: '1.0',
    platform: { decimal: '2', hex: '0x2' },
    unlisted_keys: [],
  });
  expect(record.process).toMatchObject({
    name: 'Example',
    pid: { decimal: '4242', hex: '0x1092' },
    parent: 'launchd',
    parent_pid: { decimal: '1', hex: '0x1' },
    cpu_type: 'ARM-64',
    translated: false,
    os_version: { form: 'structured', train: '23A344', build: '23A344', release_type: 'User', is_embedded: false, unlisted_keys: [] },
  });
  expect(record.exception).toStrictEqual({
    type: 'EXC_BAD_ACCESS',
    signal: 'SIGSEGV',
    subtype: 'KERN_INVALID_ADDRESS',
    codes: '0x1, 0x0',
    message: null,
    unlisted_keys: [],
  });
  expect(record.termination).toMatchObject({ namespace: 'SIGNAL', code: { decimal: '11', hex: '0xb' }, indicator: null, by_proc: 'Example', reasons: [] });
  expect(record.faulting_thread).toBe(0);
  expect(record.threads[0]?.frames.map((frame) => frame.runtime_address)).toStrictEqual([
    { decimal: '4294967396', hex: '0x100000064' },
    { decimal: '4294967346', hex: '0x100000032' },
  ]);
  expect(record.threads[0]?.frames.map((frame) => frame.role)).toStrictEqual(['faulting_instruction', 'return_address']);
  expect(record.threads[0]?.registers).toStrictEqual([]);
  expect(record.images[0]).toMatchObject({ source_meaning: 'process', uuid_unknown: false, base: { decimal: '4294967296', hex: '0x100000000' } });
  expect(record.classification).toStrictEqual({ status: 'unclassified', matches: [] });
  expect(record.coverage).toStrictEqual({ status: 'complete', reason: null, threads: 1, frames: 2, images: 1, registers: 0, type_mismatches: [] });
  expect(record.unlisted_body_keys).toStrictEqual([]);
});

test('projects metadata only for a bug type without a crash body', async () => {
  const targets = await tempTargets();
  const path = await targets.write('spindump.ips', ipsReport({ bug_type: '210', timestamp: 't', extra: 1 }, { procName: 'Example', threads: [{ id: 1 }] }));
  const { record } = await inspectAppleIpsFromPath(path);

  expect(record.metadata.bug_type).toBe('210');
  expect(record.metadata.timestamp).toBe('t');
  expect(record.metadata.unlisted_keys).toStrictEqual(['extra']);
  expect(record.process).toStrictEqual({ name: null, path: null, pid: null, parent: null, parent_pid: null, cpu_type: null, translated: null, os_version: null });
  expect(record.classification).toBeNull();
  expect(record.threads).toStrictEqual([]);
  expect(record.coverage).toStrictEqual({ status: 'complete', reason: 'bug_type 210 is not the crash body form 309', threads: 0, frames: 0, images: 0, registers: 0, type_mismatches: [] });
  expect(record.unlisted_body_keys).toStrictEqual(['procName', 'threads']);
  expect(record.limitations.at(-1)).toBe('Only metadata is projected for bug_type 210; crash-body fields are not established.');
});

test.for([
  { rule: 'watchdog', patch: { termination: { indicator: 'watchdog' } } },
  { rule: 'dead10cc', patch: { termination: { reasons: ['dead10cc'] } } },
  { rule: 'thermal', patch: { termination: { reasons: ['thermal pressure'] } } },
  { rule: 'guarded_file_descriptor', patch: { exception: { type: 'EXC_GUARD', codes: 'GUARD_TYPE_FD' } } },
  { rule: 'guarded_mach_port', patch: { exception: { type: 'EXC_GUARD', codes: 'GUARD_TYPE_MACH_PORT' } } },
  { rule: 'possible_pointer_authentication_failure', patch: { exception: { type: 'EXC_BAD_ACCESS', subtype: 'PAC' } } },
  { rule: 'dyld_missing_library', patch: { procName: 'Library not loaded: @rpath/libfoo.dylib' } },
])('classifies a crash body as $rule', async ({ rule, patch }) => {
  const targets = await tempTargets();
  const path = await targets.write('crash.ips', ipsReport({ bug_type: '309' }, crashBody(patch)));
  const { record } = await inspectAppleIpsFromPath(path);

  expect(record.classification?.status).toBe('matched');
  expect(record.classification?.matches.map((match) => match.rule)).toStrictEqual([rule]);
});

test('classifies a non-array reason list as unclassified', async () => {
  const targets = await tempTargets();
  const path = await targets.write('reasons.ips', ipsReport({ bug_type: '309' }, crashBody({ termination: { indicator: null, reasons: 'watchdog' } })));
  const { record } = await inspectAppleIpsFromPath(path);

  expect(record.termination?.reasons).toBeNull();
  expect(record.classification).toStrictEqual({ status: 'unclassified', matches: [] });
});

test('projects every used-image source marker', async () => {
  const targets = await tempTargets();
  const usedImages: Record<string, unknown>[] = ['P', 'S', 'C', 'B', 'T', 'K', 'Z'].map((source) => ({ source, base: 1 }));
  usedImages.push({});
  const path = await targets.write('images.ips', ipsReport({ bug_type: '309' }, crashBody({ usedImages })));
  const { record } = await inspectAppleIpsFromPath(path);

  expect(record.images.map((image) => image.source_meaning)).toStrictEqual(['process', 'shared_cache', 'shared_cache', 'kernel', 'kernel', 'kernel', null, null]);
  expect(record.images.map((image) => image.uuid_unknown)).toStrictEqual([true, true, true, true, true, true, true, true]);
  expect(record.coverage.images).toBe(8);
});

test('projects each frame address form', async () => {
  const targets = await tempTargets();
  const frames = [{ imageIndex: 0, imageOffset: 100 }, { imageIndex: 9, imageOffset: 100 }, { runtimeAddress: 4096 }, { address: '8192', inline: true, symbol: 'inner', symbolLocation: 8 }, { imageIndex: 0 }, {}];
  const path = await targets.write('frames.ips', ipsReport({ bug_type: '309' }, crashBody({ threads: [{ frames }], usedImages: [{ base: 4294967296 }] })));
  const { record } = await inspectAppleIpsFromPath(path);

  expect(record.threads[0]?.frames.map((frame) => frame.runtime_address)).toStrictEqual([{ decimal: '4294967396', hex: '0x100000064' }, null, { decimal: '4096', hex: '0x1000' }, { decimal: '8192', hex: '0x2000' }, null, null]);
  expect(record.threads[0]?.frames.map((frame) => frame.inline)).toStrictEqual([null, null, null, true, null, null]);
  expect(record.threads[0]?.frames[3]?.symbol_location).toStrictEqual({ decimal: '8', hex: '0x8' });
  expect(record.threads[0]?.frames.map((frame) => frame.image_index)).toStrictEqual([0, 9, null, null, 0, null]);
});

test('projects thread state registers without unparseable values', async () => {
  const targets = await tempTargets();
  const thread = { threadState: { x0: { value: 1 }, pc: 4096, miss: { value: 'nope' }, flag: true }, id: 3, triggered: false, name: 'worker', queue: 'q', flavor: 'ARM_THREAD_STATE64' };
  const path = await targets.write('registers.ips', ipsReport({ bug_type: '309' }, crashBody({ threads: [thread] })));
  const { record } = await inspectAppleIpsFromPath(path);

  expect(record.threads[0]?.registers).toStrictEqual([
    { name: 'x0', value: { decimal: '1', hex: '0x1' } },
    { name: 'pc', value: { decimal: '4096', hex: '0x1000' } },
  ]);
  expect(record.threads[0]?.state_flavor).toBe('ARM_THREAD_STATE64');
  expect(record.threads[0]?.triggered).toBe(false);
  expect(record.threads[0]).toMatchObject({ id: { decimal: '3', hex: '0x3' }, name: 'worker', queue: 'q' });
  expect(record.coverage.registers).toBe(2);
});

test('projects each osVersion form', async () => {
  const targets = await tempTargets();
  const textPath = await targets.write('text.ips', ipsReport({ bug_type: '309' }, crashBody({ osVersion: 'macOS 14.1' })));
  const missingPath = await targets.write('missing.ips', ipsReport({ bug_type: '309' }, crashBody({ osVersion: 42 })));
  const extraPath = await targets.write('extra.ips', ipsReport({ bug_type: '309' }, crashBody({ osVersion: { train: 'x', userVisible: true } })));

  expect((await inspectAppleIpsFromPath(textPath)).record.process.os_version).toStrictEqual({ form: 'text', text: 'macOS 14.1' });
  expect((await inspectAppleIpsFromPath(missingPath)).record.process.os_version).toBeNull();
  expect((await inspectAppleIpsFromPath(extraPath)).record.process.os_version).toStrictEqual({ form: 'structured', train: 'x', build: null, release_type: null, is_embedded: null, unlisted_keys: ['userVisible'] });
});

test('lists unlisted keys on every body section', async () => {
  const targets = await tempTargets();
  const body = crashBody({ extra: 1, exception: { type: 'EXC_BAD_ACCESS', detail: 2 }, termination: { namespace: 'SIGNAL', note: 3 } });
  const path = await targets.write('unlisted.ips', ipsReport({ bug_type: '309' }, body));
  const { record } = await inspectAppleIpsFromPath(path);

  expect(record.unlisted_body_keys).toStrictEqual(['extra']);
  expect(record.exception?.unlisted_keys).toStrictEqual(['detail']);
  expect(record.termination?.unlisted_keys).toStrictEqual(['note']);
  expect(record.exception?.type).toBe('EXC_BAD_ACCESS');
  expect(record.termination?.namespace).toBe('SIGNAL');
});

test.for([
  { name: 'max_file_bytes', options: { maxFileBytes: 40 }, message: 'more than the 40 byte limit' },
  { name: 'max_threads', options: { maxThreads: 1 }, message: 'more than max_threads=1' },
  { name: 'max_images', options: { maxImages: 0 }, message: 'more than max_images=0' },
  { name: 'max_frames', options: { maxFrames: 1 }, message: 'exceeds max_frames=1' },
  { name: 'max_registers', options: { maxRegisters: 0 }, message: 'exceeds max_registers=0' },
])('rejects a report that exceeds $name', async ({ options, message }) => {
  const targets = await tempTargets();
  const thread = {
    frames: [
      { imageIndex: 0, imageOffset: 1 },
      { imageIndex: 0, imageOffset: 2 },
    ],
    threadState: { x0: { value: 1 } },
  };
  const path = await targets.write('limits.ips', ipsReport({ bug_type: '309' }, crashBody({ threads: [thread, thread], usedImages: [{ base: 1 }] })));
  const payload = await payloadOf(() => inspectAppleIpsFromPath(path, options));

  expect(payload.code).toBe('invalid_request');
  expect(firstIssueMessage(payload)).toContain(message);
});

test.for([
  { name: 'fractional', value: 1.5 },
  { name: 'too small', value: 1 },
  { name: 'too large', value: 16_777_217 },
])('rejects a $name max_file_bytes value', async ({ value }) => {
  const targets = await tempTargets();
  const path = await targets.write('bounds.ips', ipsReport({ bug_type: '309' }, crashBody()));
  const payload = await payloadOf(() => inspectAppleIpsFromPath(path, { maxFileBytes: value }));

  expect(firstIssueMessage(payload)).toContain('max_file_bytes must be an integer between 2 and 16777216.');
});

test.for([
  { name: 'a single line', text: '{"bug_type": "309"}' },
  { name: 'invalid metadata JSON', text: 'not json\n{}' },
  { name: 'invalid body JSON', text: '{"bug_type": "309"}\nnot json' },
  { name: 'a non-object metadata value', text: '[]\n{}' },
  { name: 'a non-object body value', text: '{"bug_type": "309"}\n[]' },
  { name: 'a missing bug type', text: '{}\n{}' },
  { name: 'a non-string bug type', text: '{"bug_type": 309}\n{}' },
])('rejects an IPS report with $name', async ({ text }) => {
  const targets = await tempTargets();
  const path = await targets.write('malformed.ips', text);
  const payload = await payloadOf(() => inspectAppleIpsFromPath(path));

  expect(payload.code).toBe('invalid_request');
  expect(payload.details?.['operation']).toBe('inspect_apple_ips');
});

test.for([
  { name: 'a missing path', target: '/nonexistent/report.ips', reason: 'no file exists there' },
  { name: 'a directory path', target: '', reason: 'it could not be read' },
])('reports $name for an IPS report', async ({ target, reason }) => {
  const targets = await tempTargets();
  const path = target === '' ? targets.dir : target;
  const payload = await payloadOf(() => inspectAppleIpsFromPath(path));

  expect(firstIssueMessage(payload)).toContain(reason);
});

test('rejects an unexpected-header-size IL2CPP fixture', async () => {
  const payload = await payloadOf(() => inspectIl2CppMetadataFromPath(fixturePath('targets/il2cpp/global-metadata.dat')));

  expect(payload).toMatchObject({ code: 'invalid_request', category: 'invalid_input', retryable: false, details: { operation: 'inspect_il2cpp_metadata' } });
  expect(JSON.stringify(payload.details)).toContain('unexpected-header-size: stringLiterals starts at 0, not immediately after the 256-byte header');
  const partial = (payload.details?.['partial_observation'] ?? {}) as { normalized_result?: unknown };
  expect(partial.normalized_result).toStrictEqual({
    artifact: { path: fixturePath('targets/il2cpp/global-metadata.dat'), sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: 256 },
    inventory_status: 'not-returned-as-complete',
  });
});

const il2cppMetadata = (options: { version?: number; magic?: number; bytes?: number; sections?: readonly { offset: number; size: number }[] } = {}): Buffer => {
  const bytes = Buffer.alloc(options.bytes ?? 256);
  bytes.writeUInt32LE(options.magic ?? 0xfab11baf, 0);
  bytes.writeUInt32LE(options.version ?? 29, 4);
  (options.sections ?? [{ offset: 256, size: 0 }]).forEach((section, index) => {
    bytes.writeUInt32LE(section.offset, 8 + index * 8);
    bytes.writeUInt32LE(section.size, 12 + index * 8);
  });
  return bytes;
};

test('inventories an IL2CPP header with 31 section slots', async () => {
  const targets = await tempTargets();
  const bytes = il2cppMetadata({ sections: [{ offset: 256, size: 0 }] });
  const path = await targets.write('global-metadata.dat', bytes);
  const inspection = await inspectIl2CppMetadataFromPath(path);

  expect(inspection.path).toBe(path);
  expect(inspection.resolvedPath).toBe(path);
  expect(inspection.record).toMatchObject({
    magic: 0xfab11baf,
    metadata_version: 29,
    index_widths: { type_definition: 4, generic_container: 4, parameter: 4, type: 4, type_width_source: 'version_table' },
    binary: null,
    images: [],
    string_literals: [],
  });
  expect(inspection.record.sections).toHaveLength(31);
  expect(inspection.record.sections[0]).toStrictEqual({ name: 'stringLiteral', offset: 256, bytes: 0 });
  expect(inspection.record.sections[30]).toStrictEqual({ name: 'section_30', offset: 0, bytes: 0 });
  expect(inspection.record.limitations).toHaveLength(3);
});

test.for([
  { version: 24, header: 264 },
  { version: 27, header: 256 },
  { version: 31, header: 256 },
  { version: 39, header: 248 },
])('accepts IL2CPP metadata version $version', async ({ version, header }) => {
  const targets = await tempTargets();
  const path = await targets.write(`metadata-${String(version)}.dat`, il2cppMetadata({ version, sections: [{ offset: header, size: 0 }] }));
  const inspection = await inspectIl2CppMetadataFromPath(path);

  expect(inspection.record.metadata_version).toBe(version);
  expect(inspection.record.sections[0]?.offset).toBe(header);
});

test('rejects IL2CPP metadata with a foreign magic', async () => {
  const targets = await tempTargets();
  const path = await targets.write('magic.dat', il2cppMetadata({ magic: 0x12345678 }));
  const payload = await payloadOf(() => inspectIl2CppMetadataFromPath(path));

  expect(firstIssueMessage(payload)).toContain('IL2CPP metadata magic mismatch.');
});

test('rejects an unsupported IL2CPP metadata version', async () => {
  const targets = await tempTargets();
  const path = await targets.write('version.dat', il2cppMetadata({ version: 30 }));
  const payload = await payloadOf(() => inspectIl2CppMetadataFromPath(path));

  expect(firstIssueMessage(payload)).toContain('unsupported metadata_version 30.');
});

test.for([
  { name: 'truncated header', bytes: Buffer.alloc(4), message: 'metadata header is truncated.' },
  { name: 'truncated section table', bytes: il2cppMetadata({ bytes: 16 }), message: 'metadata section table is truncated.' },
  { name: 'section past the file', bytes: il2cppMetadata({ sections: [{ offset: 256, size: 8 }] }), message: 'section stringLiteral exceeds file size.' },
])('rejects IL2CPP metadata with a $name', async ({ bytes, message }) => {
  const targets = await tempTargets();
  const path = await targets.write('short.dat', bytes);
  const payload = await payloadOf(() => inspectIl2CppMetadataFromPath(path));

  expect(firstIssueMessage(payload)).toContain(message);
});

test('rejects IL2CPP binary linking options that cannot run', async () => {
  const targets = await tempTargets();
  const path = await targets.write('link.dat', il2cppMetadata());
  const genericInstances = await payloadOf(() => inspectIl2CppMetadataFromPath(path, { genericInstances: true }));
  const architecture = await payloadOf(() => inspectIl2CppMetadataFromPath(path, { binaryArchitecture: 'arm64' }));
  const linking = await payloadOf(() => inspectIl2CppMetadataFromPath(path, { binaryPath: '/tmp/libil2cpp.so' }));

  expect(firstIssueMessage(genericInstances)).toContain('generic_instances requires binary_path.');
  expect(firstIssueMessage(architecture)).toContain('binary_architecture requires binary_path.');
  expect(firstIssueMessage(linking)).toContain('binary_path linking is not implemented in this port yet.');
});

test('resolves IL2CPP metadata from a relative path', async () => {
  const targets = await tempTargets();
  await targets.write('rel.dat', il2cppMetadata());
  const inspection = await inspectIl2CppMetadataFromPath('rel.dat', { cwd: targets.dir });

  expect(inspection.path).toBe('rel.dat');
  expect(inspection.resolvedPath).toBe(join(targets.dir, 'rel.dat'));
  expect(inspection.record.sections).toHaveLength(31);
});

test('reports IL2CPP metadata that does not exist', async () => {
  const payload = await payloadOf(() => inspectIl2CppMetadataFromPath('/nonexistent/global-metadata.dat'));
  expect(firstIssueMessage(payload)).toContain('no file exists there');
});

test('records identify_flutter_build evidence for the fixture', async () => {
  const session = new ReaSession(runtime);
  const record = await evidenceOf(() => identifyFlutterBuild(session, { path: fixturePath('targets/flutter/demo.apk') }));

  expect(record['operation']).toBe('identify_flutter_build');
  expect(record['normalized_result']).toMatchObject({ flutter_detected: true, coverage: 'partial' });
  expect(session.evidence.size).toBe(1);
});

test('records inspect_dart_aot evidence with the selected ABI', async () => {
  const session = new ReaSession(runtime);
  const targets = await tempTargets();
  const path = await targets.write('aot.apk', flutterApk({ libapp: completeLibapp(), libflutter: completeLibflutter() }));
  const record = await evidenceOf(() => inspectDartAot(session, { path, abi: 'arm64-v8a', detail: 'summary' }));

  expect(record['operation']).toBe('inspect_dart_aot');
  expect(record['parameters']).toStrictEqual({ path, detail: 'summary', abi: 'arm64-v8a' });
  expect(record['normalized_result']).toMatchObject({ abi: 'arm64-v8a', library: { path: 'lib/arm64-v8a/libapp.so' } });
  expect(session.evidence.size).toBe(1);
});

test('records inspect_apk_signature evidence without limitations in the result', async () => {
  const session = new ReaSession(runtime);
  const record = await evidenceOf(() => inspectApkSignature(session, { path: fixturePath('targets/apk/v1-only.apk'), detail: 'summary' }));

  expect(record['operation']).toBe('inspect_apk_signature');
  expect(record['normalized_result']).toMatchObject({ posture: { v1_only: true, strongest_scheme: 'v1' }, runtime_execution: 'not-performed' });
  expect((record['normalized_result'] as Record<string, unknown>)['limitations']).toBeUndefined();
  expect(record['limitations']).toHaveLength(5);
  expect(session.evidence.size).toBe(1);
});

test('records inspect_recorded_crash evidence for a minimal core', async () => {
  const session = new ReaSession(runtime);
  const targets = await tempTargets();
  const path = await targets.write('minimal.core', coreImage());
  const record = await evidenceOf(() => inspectRecordedCrash(session, { path }));

  expect(record['operation']).toBe('inspect_recorded_crash');
  expect(record['normalized_result']).toMatchObject({ format: 'elf64-core', machine_name: 'x86_64', coverage: { status: 'complete' } });
  expect(record['parameters']).toMatchObject({ path, include_debugger_context: false, max_file_bytes: 64 * 1024 * 1024 });
  expect(session.evidence.size).toBe(1);
});

test('records inspect_gpu_code_objects evidence for PTX kernels', async () => {
  const session = new ReaSession(runtime);
  const record = await evidenceOf(() => inspectGpuCodeObjects(session, { path: fixturePath('targets/gpu/sample.ptx'), analysis: 'kernels', detail: 'complete' }));

  expect(record['operation']).toBe('inspect_gpu_code_objects');
  expect(record['normalized_result']).toMatchObject({ format: 'ptx', analysis: 'kernels' });
  expect((record['normalized_result'] as { kernels: { name: string }[] }).kernels[0]?.name).toBe('add');
  expect(session.evidence.size).toBe(1);
});

test('records inspect_apple_ips evidence with the default budgets', async () => {
  const session = new ReaSession(runtime);
  const record = await evidenceOf(() => inspectAppleIps(session, { path: fixturePath('targets/ips/sample-crash.ips') }));

  expect(record['operation']).toBe('inspect_apple_ips');
  expect(record['normalized_result']).toMatchObject({ metadata: { bug_type: '309' }, coverage: { threads: 1, frames: 2 } });
  expect(record['parameters']).toStrictEqual({
    path: fixturePath('targets/ips/sample-crash.ips'),
    max_file_bytes: 1_048_576,
    max_threads: 256,
    max_frames: 8192,
    max_images: 1024,
    max_registers: 16_384,
    max_integer_text_bytes: 8_388_608,
  });
  expect(session.evidence.size).toBe(1);
});

test('records inspect_il2cpp_metadata evidence for a valid header', async () => {
  const session = new ReaSession(runtime);
  const targets = await tempTargets();
  const path = await targets.write('metadata.dat', il2cppMetadata());
  const record = await evidenceOf(() => inspectIl2CppMetadata(session, { path, detail: 'complete' }));

  expect(record['operation']).toBe('inspect_il2cpp_metadata');
  expect(record['normalized_result']).toMatchObject({ metadata_version: 29, binary: null });
  expect((record['normalized_result'] as { sections: unknown[] }).sections).toHaveLength(31);
  expect(session.evidence.size).toBe(1);
});
