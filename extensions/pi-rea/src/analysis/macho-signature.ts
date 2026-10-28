
import { createHash } from 'node:crypto';

import { architectureName } from './macho.ts';
import { decodePlist } from './plist.ts';

export const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
export const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
export const CSMAGIC_REQUIREMENTS = 0xfade0c01;
export const CSMAGIC_BLOBWRAPPER = 0xfade0b01;
export const CSMAGIC_EMBEDDED_ENTITLEMENTS = 0xfade7171;
export const CSMAGIC_DETACHED_SIGNATURE = 0xfade0cc1;
export const CSMAGIC_REQUIREMENT = 0xfade0c00;

const CS_HARDENED_RUNTIME = 0x0001_0000;

const HASH_NAMES: Record<number, string> = {
  1: 'sha1',
  2: 'sha256',
  3: 'sha256',
  4: 'sha384',
};

const ORACLE_LIMITATION =
  'Inspected a digest-verified Mach-O byte snapshot; filesystem-bound signing context and trust validation are not examined.';

export interface MachoSignatureInspection {
  readonly signed: boolean;
  readonly identifier: string | null;
  readonly team_identifier: string | null;
  readonly format: string | null;
  readonly cdhashes: readonly string[];
  readonly hash_algorithms: readonly string[];
  readonly authorities: readonly string[];
  readonly designated_requirement: string | null;
  readonly entitlements: unknown;
  readonly timestamp: string | null;
  readonly hardened_runtime: boolean | null;
  readonly provenance: readonly Record<string, unknown>[];
  readonly limitations: readonly string[];
}

const readBe32 = (bytes: Buffer, offset: number): number => bytes.readUInt32BE(offset);

const cString = (bytes: Buffer, offset: number, end: number): string => {
  if (offset < 0 || offset >= end) return '';
  const zero = bytes.indexOf(0, offset);
  const stop = zero === -1 || zero > end ? end : zero;
  return bytes.subarray(offset, stop).toString('utf8');
};

interface SuperBlobEntry {
  readonly type: number;
  readonly offset: number;
}

interface CodeDirectoryFacts {
  readonly identifier: string | null;
  readonly team: string | null;
  readonly hashName: string | null;
  readonly hashType: number;
  readonly flags: number;
  readonly cdhash: string;
}

const parseSuperBlob = (blob: Buffer): { readonly magic: number; readonly entries: SuperBlobEntry[] } | null => {
  if (blob.length < 12) return null;
  const magic = readBe32(blob, 0);
  if (magic !== CSMAGIC_EMBEDDED_SIGNATURE && magic !== CSMAGIC_DETACHED_SIGNATURE) return null;
  const length = readBe32(blob, 4);
  const count = readBe32(blob, 8);
  if (length > blob.length || count > 256) return null;
  const entries: SuperBlobEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 8;
    if (at + 8 > blob.length) break;
    entries.push({ type: readBe32(blob, at), offset: readBe32(blob, at + 4) });
  }
  return { magic, entries };
};

const parseCodeDirectory = (blob: Buffer, offset: number): CodeDirectoryFacts | null => {
  if (offset + 44 > blob.length) return null;
  if (readBe32(blob, offset) !== CSMAGIC_CODEDIRECTORY) return null;
  const length = readBe32(blob, offset + 4);
  if (offset + length > blob.length || length < 44) return null;
  const version = readBe32(blob, offset + 8);
  const flags = readBe32(blob, offset + 12);
  const identOffset = readBe32(blob, offset + 20);
  const hashSize = blob[offset + 36] ?? 0;
  const hashType = blob[offset + 37] ?? 0;
  void hashSize;
  const end = offset + length;
  const identifier = identOffset === 0 ? null : cString(blob, offset + identOffset, end) || null;
  let team: string | null = null;
  if (version >= 0x20200 && offset + 0x34 <= end) {
    const teamOffset = readBe32(blob, offset + 0x30);
    if (teamOffset !== 0) team = cString(blob, offset + teamOffset, end) || null;
  }
  const cdBytes = blob.subarray(offset, offset + length);
  const digest =
    hashType === 1
      ? createHash('sha1').update(cdBytes).digest()
      : hashType === 4
        ? createHash('sha384').update(cdBytes).digest()
        : createHash('sha256').update(cdBytes).digest();
  // codesign CDHash / CandidateCDHash displays the first 20 bytes.
  const cdhash = digest.subarray(0, 20).toString('hex');
  return {
    identifier,
    team,
    hashName: HASH_NAMES[hashType] ?? (hashType === 0 ? null : `hash-type-${hashType}`),
    hashType,
    flags,
    cdhash,
  };
};

const parseEntitlements = (blob: Buffer, offset: number): unknown => {
  if (offset + 8 > blob.length) return null;
  if (readBe32(blob, offset) !== CSMAGIC_EMBEDDED_ENTITLEMENTS) return null;
  const length = readBe32(blob, offset + 4);
  if (offset + length > blob.length || length < 8) return null;
  const payload = blob.subarray(offset + 8, offset + length);
  try {
    return decodePlist(payload).value;
  } catch {
    return null;
  }
};

interface SignatureLink {
  readonly dataoff: number;
  readonly datasize: number;
  readonly format: string;
}

const thinFormat = (bytes: Buffer, little: boolean): string => {
  const cpuType = little ? bytes.readInt32LE(4) : bytes.readInt32BE(4);
  const cpuSubtype = little ? bytes.readInt32LE(8) : bytes.readInt32BE(8);
  return `Mach-O thin (${architectureName(cpuType >>> 0, cpuSubtype >>> 0)})`;
};

const findCodeSignatureLink = (bytes: Buffer): SignatureLink | null => {
  if (bytes.length < 32) return null;
  const magicLe = bytes.readUInt32LE(0);
  const magicBe = bytes.readUInt32BE(0);
  const little = magicLe === 0xfeedfacf || magicLe === 0xfeedface;
  const big = magicBe === 0xfeedfacf || magicBe === 0xfeedface;
  if (!little && !big) {
    if (magicBe === 0xcafebabe || magicLe === 0xcafebabe) {
      const be = magicBe === 0xcafebabe;
      const count = be ? bytes.readUInt32BE(4) : bytes.readUInt32LE(4);
      for (let index = 0; index < Math.min(count, 32); index += 1) {
        const base = 8 + index * 20;
        const cpuType = be ? bytes.readUInt32BE(base) : bytes.readUInt32LE(base);
        const cpuSubtype = be ? bytes.readUInt32BE(base + 4) : bytes.readUInt32LE(base + 4);
        const fileOffset = be ? bytes.readUInt32BE(base + 8) : bytes.readUInt32LE(base + 8);
        const size = be ? bytes.readUInt32BE(base + 12) : bytes.readUInt32LE(base + 12);
        if (fileOffset + size > bytes.length) continue;
        const found = findCodeSignatureLink(bytes.subarray(fileOffset, fileOffset + size));
        if (found !== null) {
          return {
            dataoff: found.dataoff + fileOffset,
            datasize: found.datasize,
            format: `Mach-O universal (${architectureName(cpuType, cpuSubtype)})`,
          };
        }
      }
    }
    return null;
  }
  const at = (offset: number, size: 4 | 8): number =>
    size === 8
      ? little
        ? Number(bytes.readBigUInt64LE(offset))
        : Number(bytes.readBigUInt64BE(offset))
      : little
        ? bytes.readUInt32LE(offset)
        : bytes.readUInt32BE(offset);
  const is64 = magicLe === 0xfeedfacf || magicBe === 0xfeedfacf;
  const headerSize = is64 ? 32 : 28;
  const ncmds = at(16, 4);
  const sizeofcmds = at(20, 4);
  let cursor = headerSize;
  const end = Math.min(bytes.length, headerSize + sizeofcmds);
  for (let index = 0; index < ncmds && cursor + 8 <= end; index += 1) {
    const cmd = at(cursor, 4);
    const cmdsize = at(cursor + 4, 4);
    if (cmdsize < 8 || cursor + cmdsize > end) break;
    if (cmd === 0x1d && cmdsize >= 16) {
      return {
        dataoff: at(cursor + 8, 4),
        datasize: at(cursor + 12, 4),
        format: thinFormat(bytes, little),
      };
    }
    cursor += cmdsize;
  }
  return null;
};

const unsigned = (format: string | null, extra: string): MachoSignatureInspection => ({
  signed: false,
  identifier: null,
  team_identifier: null,
  format,
  cdhashes: [],
  hash_algorithms: [],
  authorities: [],
  designated_requirement: null,
  entitlements: null,
  timestamp: null,
  hardened_runtime: null,
  provenance: [],
  limitations: [ORACLE_LIMITATION, extra],
});

const preferCodeDirectory = (candidates: CodeDirectoryFacts[]): CodeDirectoryFacts | null => {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((left, right) => {
    const rank = (hashType: number): number => (hashType === 2 || hashType === 3 ? 3 : hashType === 4 ? 2 : 1);
    return rank(right.hashType) - rank(left.hashType);
  });
  return ranked[0] ?? null;
};

export const inspectMachoSignatureBytes = (bytes: Buffer): MachoSignatureInspection => {
  const link = findCodeSignatureLink(bytes);
  if (link === null || link.datasize === 0) {
    return unsigned(null, 'No LC_CODE_SIGNATURE load command was present on the inspected image.');
  }
  if (link.dataoff + link.datasize > bytes.length) {
    return unsigned(link.format, 'LC_CODE_SIGNATURE points past the end of the file.');
  }
  const blob = bytes.subarray(link.dataoff, link.dataoff + link.datasize);
  const superBlob = parseSuperBlob(blob);
  if (superBlob === null) {
    return unsigned(link.format, 'The code-signature region is not an embedded SuperBlob.');
  }

  const codeDirectories: CodeDirectoryFacts[] = [];
  let entitlements: unknown = null;

  for (const entry of superBlob.entries) {
    if (entry.offset >= blob.length) continue;
    const magic = readBe32(blob, entry.offset);
    if (magic === CSMAGIC_CODEDIRECTORY) {
      const cd = parseCodeDirectory(blob, entry.offset);
      if (cd !== null) codeDirectories.push(cd);
    } else if (magic === CSMAGIC_EMBEDDED_ENTITLEMENTS) {
      entitlements = parseEntitlements(blob, entry.offset);
    }
  }

  const selected = preferCodeDirectory(codeDirectories);
  if (selected === null) {
    return unsigned(link.format, 'The SuperBlob contains no parseable CodeDirectory.');
  }

  return {
    signed: true,
    identifier: selected.identifier,
    team_identifier: selected.team,
    format: link.format,
    cdhashes: [selected.cdhash],
    hash_algorithms: selected.hashName === null ? [] : [selected.hashName],
    authorities: [],
    designated_requirement: `cdhash H"${selected.cdhash}"`,
    entitlements,
    timestamp: null,
    hardened_runtime: (selected.flags & CS_HARDENED_RUNTIME) !== 0,
    provenance: [],
    limitations: [ORACLE_LIMITATION],
  };
};
