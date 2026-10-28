import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_ENTRIES = 8192;

const ELF_MACHINES: Record<number, string> = {
  3: 'x86',
  62: 'x86_64',
  40: 'arm',
  183: 'aarch64',
};

export const KERNEL_MODULE_LIMITATIONS_BASE = [
  'This workflow does not execute the module, resolve imported symbols, or validate an appended signature.',
  'struct module in .gnu.linkonce.this_module is kernel-version specific and is not decoded.',
  '__ksymtab entry layout is kernel-version specific and is not decoded.',
  'Only classic __versions records are decoded. Their absence does not establish the absence of CONFIG_EXTENDED_MODVERSIONS metadata in __version_ext_names and __version_ext_crcs.',
  'Metadata strings use a byte-preserving Latin1 projection; their original text encoding is unobserved.',
] as const;

const SIGNATURE_ABSENT_LIMITATION = "No '~Module signature appended~' trailer was present. That is not proof the module is unsigned in another container.";

const MODULE_SIGNATURE_MAGIC = '~Module signature appended~';

export interface FileSpan {
  readonly offset: number;
  readonly bytes: number;
}

export interface KernelModinfoEntry {
  readonly index: number;
  readonly location: FileSpan;
  readonly key: string;
  readonly value: string;
  readonly raw_sha256: string;
  readonly raw_hex: string;
  readonly status: 'observed';
  readonly reason: null;
}

export interface KernelVersionEntry {
  readonly index: number;
  readonly location: FileSpan;
  readonly crc_hex: string;
  readonly name: string;
  readonly status: 'observed';
  readonly reason: null;
}

export interface KernelModuleInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly format: 'elf32' | 'elf64' | null;
  readonly byte_order: 'little' | 'big' | null;
  readonly machine: number | null;
  readonly type: number | null;
  readonly type_name: 'relocatable' | 'executable' | 'shared' | 'core' | 'unknown' | null;
  readonly applicability: 'applicable' | 'not_applicable' | 'compressed_container';
  readonly compression: { readonly codec: 'gzip' | 'xz' | 'zstd'; readonly bytes: number } | null;
  readonly next_probe: { readonly operation: 'external_decompression'; readonly reason: string } | null;
  readonly modinfo: {
    readonly status: 'present' | 'absent' | 'not_applicable';
    readonly location: FileSpan | null;
    readonly sha256: string | null;
    readonly entries: readonly KernelModinfoEntry[];
    readonly reason: null;
  };
  readonly versions: {
    readonly status: 'present' | 'absent' | 'not_applicable';
    readonly layout: string | null;
    readonly entry_bytes: number | null;
    readonly location: FileSpan | null;
    readonly sha256: string | null;
    readonly entries: readonly KernelVersionEntry[];
    readonly reason: null;
  };
  readonly this_module: {
    readonly status: 'present' | 'absent' | 'not_applicable';
    readonly location: FileSpan | null;
    readonly layout: 'unknown' | null;
  };
  readonly ksymtab: {
    readonly status: 'observed' | 'absent' | 'not_applicable';
    readonly sections: readonly {
      readonly name: string;
      readonly location: FileSpan;
      readonly compressed: boolean;
      readonly reason: null;
    }[];
  };
  readonly init_text: {
    readonly status: 'present' | 'absent' | 'not_applicable';
    readonly location: FileSpan | null;
    readonly bytes: number | null;
    readonly compressed: boolean | null;
  } | null;
  readonly exit_text: {
    readonly status: 'present' | 'absent' | 'not_applicable';
    readonly location: FileSpan | null;
    readonly bytes: number | null;
    readonly compressed: boolean | null;
  } | null;
  readonly signature: {
    readonly status: 'absent' | 'present' | 'not_applicable';
    readonly magic: string | null;
    readonly info: Record<string, unknown> | null;
    readonly pkcs7: { readonly location: FileSpan; readonly sha256: string } | null;
    readonly reason: null;
  };
  readonly coverage: { readonly status: string; readonly examined_entries: number };
  readonly limitations: readonly string[];
}

export interface KernelModuleSubjectFields {
  readonly format: string;
  readonly architecture: string | null;
}

export interface KernelModuleLocation {
  readonly kind: 'artifact-path' | 'file-offset-range';
  readonly path?: string;
  readonly start?: number;
  readonly end?: number;
}

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_kernel_module',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const detectCompression = (bytes: Buffer): KernelModuleInspection['compression'] => {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return { codec: 'gzip', bytes: bytes.length };
  if (bytes.length >= 6 && bytes.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))) {
    return { codec: 'xz', bytes: bytes.length };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
    return { codec: 'zstd', bytes: bytes.length };
  }
  return null;
};

interface ElfSection {
  readonly name: string;
  readonly offset: number;
  readonly size: number;
}

const parseElfSections = (
  bytes: Buffer,
): {
  format: 'elf32' | 'elf64';
  byte_order: 'little' | 'big';
  machine: number;
  type: number;
  type_name: KernelModuleInspection['type_name'];
  sections: ElfSection[];
} => {
  if (bytes.length < 16 || bytes.subarray(0, 4).toString('ascii') !== '\u007fELF') throw new Error('not ELF');
  const little = bytes[5] === 1;
  const bits = bytes[4] === 2 ? 64 : bytes[4] === 1 ? 32 : null;
  if (bits === null || (bytes[5] !== 1 && bytes[5] !== 2)) throw new Error('invalid ELF ident');
  const readU16 = (offset: number) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
  const readU32 = (offset: number) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  const readU64 = (offset: number) => Number(little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset));
  const type = readU16(16);
  const machine = readU16(18);
  const typeName: KernelModuleInspection['type_name'] = type === 1 ? 'relocatable' : type === 2 ? 'executable' : type === 3 ? 'shared' : type === 4 ? 'core' : 'unknown';
  const shoff = bits === 64 ? readU64(40) : readU32(32);
  const shentsize = readU16(bits === 64 ? 58 : 46);
  const shnum = readU16(bits === 64 ? 60 : 48);
  const shstrndx = readU16(bits === 64 ? 62 : 50);
  if (shnum === 0 || shentsize === 0) {
    return {
      format: bits === 64 ? 'elf64' : 'elf32',
      byte_order: little ? 'little' : 'big',
      machine,
      type,
      type_name: typeName,
      sections: [],
    };
  }

  const sectionHeaders: { nameOffset: number; offset: number; size: number }[] = [];
  for (let index = 0; index < shnum; index += 1) {
    const base = shoff + index * shentsize;
    if (base + shentsize > bytes.length) throw new Error('section headers truncated');
    sectionHeaders.push({
      nameOffset: readU32(base),
      offset: bits === 64 ? readU64(base + 24) : readU32(base + 16),
      size: bits === 64 ? readU64(base + 32) : readU32(base + 20),
    });
  }
  const str = sectionHeaders[shstrndx];
  if (str === undefined || str.offset + str.size > bytes.length) throw new Error('shstrtab truncated');
  const strtab = bytes.subarray(str.offset, str.offset + str.size);
  const readName = (nameOffset: number): string => {
    if (nameOffset >= strtab.length) return '';
    const end = strtab.indexOf(0, nameOffset);
    return strtab.subarray(nameOffset, end === -1 ? strtab.length : end).toString('utf8');
  };
  return {
    format: bits === 64 ? 'elf64' : 'elf32',
    byte_order: little ? 'little' : 'big',
    machine,
    type,
    type_name: typeName,
    sections: sectionHeaders.map((section) => ({
      name: readName(section.nameOffset),
      offset: section.offset,
      size: section.size,
    })),
  };
};

const parseModinfo = (payload: Buffer, sectionOffset: number, maxEntries: number): KernelModinfoEntry[] => {
  const entries: KernelModinfoEntry[] = [];
  let start = 0;
  while (start < payload.length) {
    const end = payload.indexOf(0, start);
    const rawEnd = end === -1 ? payload.length : end + 1;
    const raw = payload.subarray(start, rawEnd);
    const next = end === -1 ? payload.length : end + 1;
    if (raw.length === 0 || (raw.length === 1 && raw[0] === 0)) {
      start = next;
      continue;
    }
    const text = raw.subarray(0, raw[raw.length - 1] === 0 ? raw.length - 1 : raw.length).toString('latin1');
    const eq = text.indexOf('=');
    if (eq <= 0) {
      start = next;
      continue;
    }
    entries.push({
      index: entries.length,
      location: { offset: sectionOffset + start, bytes: raw.length },
      key: text.slice(0, eq),
      value: text.slice(eq + 1),
      raw_sha256: sha256(raw),
      raw_hex: raw.toString('hex'),
      status: 'observed',
      reason: null,
    });
    if (entries.length > maxEntries) throw new Error(`modinfo exceeds max_entries=${maxEntries}`);
    start = next;
  }
  return entries;
};

const versionsLayout = (format: 'elf32' | 'elf64'): { layout: string; entryBytes: number; crcBytes: number; nameBytes: number } => {
  if (format === 'elf64') {
    return { layout: 'elf64_unsigned_long_name56', entryBytes: 64, crcBytes: 8, nameBytes: 56 };
  }
  return { layout: 'elf32_unsigned_long_name60', entryBytes: 64, crcBytes: 4, nameBytes: 60 };
};

const parseVersions = (payload: Buffer, sectionOffset: number, format: 'elf32' | 'elf64', maxEntries: number): KernelVersionEntry[] => {
  const { entryBytes, crcBytes } = versionsLayout(format);
  const entries: KernelVersionEntry[] = [];
  for (let offset = 0; offset + entryBytes <= payload.length; offset += entryBytes) {
    const record = payload.subarray(offset, offset + entryBytes);
    const nameBuf = record.subarray(crcBytes);
    const end = nameBuf.indexOf(0);
    const name = nameBuf.subarray(0, end === -1 ? nameBuf.length : end).toString('latin1');
    if (name.length === 0) continue;
    const crcHex = format === 'elf64' ? record.readBigUInt64LE(0).toString(16).padStart(16, '0') : record.readUInt32LE(0).toString(16).padStart(8, '0');
    entries.push({
      index: entries.length,
      location: { offset: sectionOffset + offset, bytes: entryBytes },
      crc_hex: crcHex,
      name,
      status: 'observed',
      reason: null,
    });
    if (entries.length > maxEntries) throw new Error(`versions exceed max_entries=${maxEntries}`);
  }
  return entries;
};

const findSignature = (bytes: Buffer): KernelModuleInspection['signature'] => {
  const magicBuf = Buffer.from(MODULE_SIGNATURE_MAGIC, 'ascii');
  const index = bytes.lastIndexOf(magicBuf);
  if (index === -1) {
    return { status: 'absent', magic: null, info: null, pkcs7: null, reason: null };
  }
  return {
    status: 'present',
    magic: MODULE_SIGNATURE_MAGIC,
    info: null,
    pkcs7: null,
    reason: null,
  };
};

const emptyModinfo = (status: 'absent' | 'not_applicable'): KernelModuleInspection['modinfo'] => ({
  status,
  location: null,
  sha256: null,
  entries: [],
  reason: null,
});

const emptyVersions = (status: 'absent' | 'not_applicable'): KernelModuleInspection['versions'] => ({
  status,
  layout: null,
  entry_bytes: null,
  location: null,
  sha256: null,
  entries: [],
  reason: null,
});

const limitationsFor = (signatureStatus: 'absent' | 'present' | 'not_applicable'): string[] => {
  const base = [...KERNEL_MODULE_LIMITATIONS_BASE];
  if (signatureStatus === 'absent') base.push(SIGNATURE_ABSENT_LIMITATION);
  return base;
};

const span = (section: ElfSection | undefined): FileSpan | null => (section === undefined ? null : { offset: section.offset, bytes: section.size });

export interface KernelModuleOptions {
  readonly maxFileBytes?: number;
  readonly maxEntries?: number;
  readonly cwd?: string;
}

export const subjectFieldsForKernelModule = (inspection: KernelModuleInspection): KernelModuleSubjectFields => ({
  format: inspection.format === null ? 'bytes' : 'elf',
  architecture: inspection.machine === null ? null : (ELF_MACHINES[inspection.machine] ?? null),
});

export const locationsForKernelModule = (path: string, inspection: KernelModuleInspection): KernelModuleLocation[] => {
  const locations: KernelModuleLocation[] = [{ kind: 'artifact-path', path }];
  const pushSpan = (fileSpan: FileSpan | null | undefined) => {
    if (fileSpan === null || fileSpan === undefined || fileSpan.bytes <= 0) return;
    locations.push({ kind: 'file-offset-range', start: fileSpan.offset, end: fileSpan.offset + fileSpan.bytes });
  };
  if (inspection.modinfo.status === 'present') {
    pushSpan(inspection.modinfo.location);
    for (const entry of inspection.modinfo.entries) pushSpan(entry.location);
  }
  if (inspection.versions.status === 'present') {
    pushSpan(inspection.versions.location);
    for (const entry of inspection.versions.entries) pushSpan(entry.location);
  }
  if (inspection.this_module.status === 'present') pushSpan(inspection.this_module.location);
  if (inspection.init_text !== null && inspection.init_text.status === 'present') pushSpan(inspection.init_text.location);
  if (inspection.exit_text !== null && inspection.exit_text.status === 'present') pushSpan(inspection.exit_text.location);
  for (const section of inspection.ksymtab.sections) pushSpan(section.location);
  return locations;
};

export const inspectKernelModuleFromPath = async (path: string, options: KernelModuleOptions = {}): Promise<{ record: KernelModuleInspection; path: string; resolvedPath: string }> => {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }
  if (bytes.length > maxFileBytes) throw inputError(path, 'invalid_value', `file exceeds max_file_bytes=${maxFileBytes}`);

  const compression = detectCompression(bytes);
  if (compression !== null) {
    return {
      record: {
        artifact: { path, sha256: sha256(bytes), bytes: bytes.length },
        format: null,
        byte_order: null,
        machine: null,
        type: null,
        type_name: null,
        applicability: 'compressed_container',
        compression,
        next_probe: {
          operation: 'external_decompression',
          reason: `${compression.codec} kernel module containers are not decoded in-process`,
        },
        modinfo: emptyModinfo('not_applicable'),
        versions: emptyVersions('not_applicable'),
        this_module: { status: 'not_applicable', location: null, layout: null },
        ksymtab: { status: 'not_applicable', sections: [] },
        init_text: null,
        exit_text: null,
        signature: { status: 'not_applicable', magic: null, info: null, pkcs7: null, reason: null },
        coverage: { status: 'complete', examined_entries: 0 },
        limitations: limitationsFor('not_applicable'),
      },
      path,
      resolvedPath,
    };
  }

  let elf: ReturnType<typeof parseElfSections>;
  try {
    elf = parseElfSections(bytes);
  } catch (error) {
    throw inputError(path, 'invalid_format', error instanceof Error ? error.message : 'ELF parse failed');
  }

  if (elf.type_name !== 'relocatable') {
    return {
      record: {
        artifact: { path, sha256: sha256(bytes), bytes: bytes.length },
        format: elf.format,
        byte_order: elf.byte_order,
        machine: elf.machine,
        type: elf.type,
        type_name: elf.type_name,
        applicability: 'not_applicable',
        compression: null,
        next_probe: null,
        modinfo: emptyModinfo('not_applicable'),
        versions: emptyVersions('not_applicable'),
        this_module: { status: 'not_applicable', location: null, layout: null },
        ksymtab: { status: 'not_applicable', sections: [] },
        init_text: null,
        exit_text: null,
        signature: { status: 'not_applicable', magic: null, info: null, pkcs7: null, reason: null },
        coverage: { status: 'complete', examined_entries: 0 },
        limitations: limitationsFor('not_applicable'),
      },
      path,
      resolvedPath,
    };
  }

  const find = (name: string) => elf.sections.find((section) => section.name === name);
  const modinfoSection = find('.modinfo');
  const versionsSection = find('__versions');
  const thisModuleSection = find('.gnu.linkonce.this_module');
  const initSection = find('.init.text');
  const exitSection = find('.exit.text');
  const ksymSections = elf.sections.filter((section) => section.name === '__ksymtab' || section.name.startsWith('__ksymtab_'));

  let modinfoEntries: KernelModinfoEntry[] = [];
  if (modinfoSection !== undefined) {
    try {
      modinfoEntries = parseModinfo(bytes.subarray(modinfoSection.offset, modinfoSection.offset + modinfoSection.size), modinfoSection.offset, maxEntries);
    } catch (error) {
      throw inputError(path, 'invalid_value', error instanceof Error ? error.message : 'modinfo parse failed');
    }
  }

  let versionEntries: KernelVersionEntry[] = [];
  const versionMeta = versionsLayout(elf.format);
  if (versionsSection !== undefined) {
    try {
      versionEntries = parseVersions(bytes.subarray(versionsSection.offset, versionsSection.offset + versionsSection.size), versionsSection.offset, elf.format, maxEntries);
    } catch (error) {
      throw inputError(path, 'invalid_value', error instanceof Error ? error.message : 'versions parse failed');
    }
  }

  const signature = findSignature(bytes);
  const ksymtabSections = ksymSections.map((section) => ({
    name: section.name,
    location: { offset: section.offset, bytes: section.size },
    compressed: false,
    reason: null as null,
  }));

  const examinedEntries = modinfoEntries.length + versionEntries.length + ksymtabSections.length;

  return {
    record: {
      artifact: { path, sha256: sha256(bytes), bytes: bytes.length },
      format: elf.format,
      byte_order: elf.byte_order,
      machine: elf.machine,
      type: elf.type,
      type_name: elf.type_name,
      applicability: 'applicable',
      compression: null,
      next_probe: null,
      modinfo: {
        status: modinfoSection === undefined ? 'absent' : 'present',
        location: span(modinfoSection),
        sha256: modinfoSection === undefined ? null : sha256(bytes.subarray(modinfoSection.offset, modinfoSection.offset + modinfoSection.size)),
        entries: modinfoEntries,
        reason: null,
      },
      versions: {
        status: versionsSection === undefined ? 'absent' : 'present',
        layout: versionsSection === undefined ? null : versionMeta.layout,
        entry_bytes: versionsSection === undefined ? null : versionMeta.entryBytes,
        location: span(versionsSection),
        sha256: versionsSection === undefined ? null : sha256(bytes.subarray(versionsSection.offset, versionsSection.offset + versionsSection.size)),
        entries: versionEntries,
        reason: null,
      },
      this_module: {
        status: thisModuleSection === undefined ? 'absent' : 'present',
        location: span(thisModuleSection),
        layout: thisModuleSection === undefined ? null : 'unknown',
      },
      ksymtab: {
        status: ksymtabSections.length === 0 ? 'absent' : 'observed',
        sections: ksymtabSections,
      },
      init_text: {
        status: initSection === undefined ? 'absent' : 'present',
        location: span(initSection),
        bytes: initSection === undefined ? null : initSection.size,
        compressed: initSection === undefined ? null : false,
      },
      exit_text: {
        status: exitSection === undefined ? 'absent' : 'present',
        location: span(exitSection),
        bytes: exitSection === undefined ? null : exitSection.size,
        compressed: exitSection === undefined ? null : false,
      },
      signature,
      coverage: { status: 'complete', examined_entries: examinedEntries },
      limitations: limitationsFor(signature.status),
    },
    path,
    resolvedPath,
  };
};
