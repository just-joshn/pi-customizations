
import { createHash } from 'node:crypto';

import {
  DIR,
  formatVa,
  mapRva,
  parsePeImage,
  peInputError,
  resolvePathBytes,
  sectionForRva,
  vaToRva,
  type PeFileLocation,
  type PeImage,
} from './pe-core.ts';

export const DEFAULT_MAX_CALLBACKS = 64;

export const peLoadConfigArchitecture = (architecture: string): string => {
  if (architecture === 'x86_64') return 'amd64';
  if (architecture === 'x86') return '386';
  return architecture;
};

export interface PeLoadConfigInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly format: 'pe32' | 'pe32-plus';
  readonly machine: number;
  readonly bits: 32 | 64;
  readonly architecture: string;
  readonly tls: PeTlsInfo | null;
  readonly load_config: PeLoadConfigInfo | null;
  readonly examined_callbacks: number;
  readonly limitations: readonly string[];
}

interface AddressRef {
  readonly va: string;
  readonly rva: number | null;
  readonly file_offset: number | null;
  readonly section: string | null;
}

interface PeTlsInfo {
  readonly directory: { readonly rva: number; readonly size: number; readonly file_offset: number };
  readonly start_address_of_raw_data: string;
  readonly end_address_of_raw_data: string;
  readonly raw_data_size: number;
  readonly raw_data_file_offset: number | null;
  readonly raw_data_section: string | null;
  readonly address_of_index: AddressRef;
  readonly address_of_callbacks: string;
  readonly size_of_zero_fill: number;
  readonly characteristics: number;
  readonly alignment: number | null;
  readonly callbacks: readonly AddressRef[];
  readonly callback_array_locations: readonly PeFileLocation[];
}

interface PeLoadConfigInfo {
  readonly directory: { readonly rva: number; readonly size: number; readonly file_offset: number };
  readonly size: number;
  readonly structure_location: PeFileLocation;
  readonly security_cookie: AddressRef | null;
  readonly se_handler_table: AddressRef | null;
  readonly se_handler_count: number | null;
  readonly guard_cf_check_function_pointer: AddressRef | null;
  readonly guard_cf_dispatch_function_pointer: AddressRef | null;
  readonly guard_cf_function_table: AddressRef | null;
  readonly guard_cf_function_count: number | null;
  readonly guard_flags: {
    readonly raw: number;
    readonly flags: readonly string[];
    readonly unrecognized: number;
    readonly cf_function_table_stride: number;
  } | null;
  readonly guard_address_taken_iat_entry_table: AddressRef | null;
  readonly guard_address_taken_iat_entry_count: number | null;
  readonly guard_long_jump_target_table: AddressRef | null;
  readonly guard_long_jump_target_count: number | null;
  readonly dynamic_value_reloc_table: string | null;
  readonly chpe_metadata_pointer: string | null;
  readonly dynamic_value_reloc_table_offset: number | null;
  readonly dynamic_value_reloc_table_section: number | null;
  readonly guard_eh_continuation_table: AddressRef | null;
  readonly guard_eh_continuation_count: number | null;
  readonly guard_xfg_check_function_pointer: AddressRef | null;
  readonly inferences: readonly { readonly id: string; readonly evidence_kind: string; readonly basis: string }[];
}

export const PE_LOAD_CONFIG_LIMITATIONS = [
  'TLS callbacks and load-config fields reproduce IMAGE_DIRECTORY_ENTRY_TLS and IMAGE_DIRECTORY_ENTRY_LOAD_CONFIG. They do not establish that a callback runs or that a mitigation is enforced at load.',
  'Claims such as CFG instrumentation are inferred from GuardFlags bits and are not observations of instrumented instructions.',
  'A missing TLS or load-config directory is observed absence of that table, not proof the image never registered callbacks or mitigations through another mechanism.',
  'SafeSEH table and count are reported only for PE32. PE32+ struct slots that share those names are not a SafeSEH table.',
  'CHPE metadata and dynamic value relocation pointers are raw virtual addresses. Dynamic relocation table offset and section are separate source values; their target is not derived or decoded.',
  'Load-config fields newer than GuardXFGCheckFunctionPointer stay unread. A Size larger than the fields this version knows does not fail the read.',
];

const GUARD_FLAGS: { bit: number; name: string }[] = [
  { bit: 0x00000100, name: 'IMAGE_GUARD_CF_INSTRUMENTED' },
  { bit: 0x00000200, name: 'IMAGE_GUARD_CFW_INSTRUMENTED' },
  { bit: 0x00000400, name: 'IMAGE_GUARD_CF_FUNCTION_TABLE_PRESENT' },
  { bit: 0x00000800, name: 'IMAGE_GUARD_SECURITY_COOKIE_UNUSED' },
  { bit: 0x00001000, name: 'IMAGE_GUARD_PROTECT_DELAYLOAD_IAT' },
  { bit: 0x00002000, name: 'IMAGE_GUARD_DELAYLOAD_IAT_IN_ITS_OWN_SECTION' },
  { bit: 0x00004000, name: 'IMAGE_GUARD_CF_EXPORT_SUPPRESSION_INFO_PRESENT' },
  { bit: 0x00008000, name: 'IMAGE_GUARD_CF_ENABLE_EXPORT_SUPPRESSION' },
  { bit: 0x00010000, name: 'IMAGE_GUARD_CF_LONGJUMP_TABLE_PRESENT' },
  { bit: 0x00020000, name: 'IMAGE_GUARD_RF_INSTRUMENTED' },
  { bit: 0x00040000, name: 'IMAGE_GUARD_RF_ENABLE' },
  { bit: 0x00080000, name: 'IMAGE_GUARD_RF_STRICT' },
  { bit: 0x00100000, name: 'IMAGE_GUARD_RETPOLINE_PRESENT' },
  { bit: 0x00400000, name: 'IMAGE_GUARD_EH_CONTINUATION_TABLE_PRESENT' },
  { bit: 0x00800000, name: 'IMAGE_GUARD_XFG_ENABLED' },
  { bit: 0x01000000, name: 'IMAGE_GUARD_CASTGUARD_PRESENT' },
  { bit: 0x02000000, name: 'IMAGE_GUARD_MEMCPY_PRESENT' },
];

const addressRef = (image: PeImage, va: bigint): AddressRef => {
  const rva = vaToRva(image.imageBase, va);
  if (rva === null) return { va: formatVa(va), rva: null, file_offset: null, section: null };
  const section = sectionForRva(image.sections, rva);
  const fileOffset = mapRva(image.sections, rva);
  return { va: formatVa(va), rva, file_offset: fileOffset ?? null, section: section?.name ?? null };
};

const readWide = (bytes: Buffer, offset: number, bits: 32 | 64): bigint =>
  bits === 64 ? bytes.readBigUInt64LE(offset) : BigInt(bytes.readUInt32LE(offset));

export interface PeLoadConfigOptions {
  readonly maxFileBytes?: number;
  readonly maxCallbacks?: number;
  readonly cwd?: string;
}

export const inspectPeLoadConfigFromPath = async (
  path: string,
  options: PeLoadConfigOptions = {},
): Promise<{ record: PeLoadConfigInspection; path: string; resolvedPath: string }> => {
  const maxCallbacks = options.maxCallbacks ?? DEFAULT_MAX_CALLBACKS;
  if (!Number.isInteger(maxCallbacks) || maxCallbacks < 1 || maxCallbacks > 65_536) {
    throw peInputError('inspect_pe_load_config', path, 'invalid_value', 'max_callbacks must be an integer between 1 and 65536.');
  }

  const { bytes, resolvedPath } = await resolvePathBytes(path, {
    ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    operation: 'inspect_pe_load_config',
  });

  let image: PeImage;
  try {
    image = parsePeImage(bytes);
  } catch {
    throw peInputError('inspect_pe_load_config', path, 'invalid_format', 'the file is not an MZ PE image.');
  }

  const ptrSize = image.bits === 64 ? 8 : 4;
  let examinedCallbacks = 0;

  let tls: PeTlsInfo | null = null;
  const tlsDir = image.directories[DIR.TLS];
  if (tlsDir !== undefined && tlsDir.rva !== 0) {
    const fileOffset = mapRva(image.sections, tlsDir.rva);
    if (fileOffset === undefined) throw peInputError('inspect_pe_load_config', path, 'invalid_format', 'TLS directory RVA does not map.');
    const need = ptrSize * 4 + 8;
    if (fileOffset + need > bytes.length) throw peInputError('inspect_pe_load_config', path, 'invalid_format', 'TLS directory is truncated.');
    const start = readWide(bytes, fileOffset, image.bits);
    const endVa = readWide(bytes, fileOffset + ptrSize, image.bits);
    const indexVa = readWide(bytes, fileOffset + ptrSize * 2, image.bits);
    const callbacksVa = readWide(bytes, fileOffset + ptrSize * 3, image.bits);
    const sizeOfZeroFill = bytes.readUInt32LE(fileOffset + ptrSize * 4);
    const characteristics = bytes.readUInt32LE(fileOffset + ptrSize * 4 + 4);
    const startRva = vaToRva(image.imageBase, start);
    const callbacks: AddressRef[] = [];
    const callbackLocations: PeFileLocation[] = [];
    const callbacksRva = vaToRva(image.imageBase, callbacksVa);
    if (callbacksRva !== null) {
      const callbacksOffset = mapRva(image.sections, callbacksRva);
      if (callbacksOffset !== undefined) {
        for (let index = 0; ; index += 1) {
          if (examinedCallbacks >= maxCallbacks) {
            throw peInputError('inspect_pe_load_config', path, 'invalid_value', `TLS callbacks exceed max_callbacks=${maxCallbacks}`);
          }
          const at = callbacksOffset + index * ptrSize;
          if (at + ptrSize > bytes.length) throw peInputError('inspect_pe_load_config', path, 'invalid_format', 'TLS callback array is truncated.');
          const entry = readWide(bytes, at, image.bits);
          callbackLocations.push({ offset: at, bytes: ptrSize });
          if (entry === 0n) break;
          examinedCallbacks += 1;
          callbacks.push(addressRef(image, entry));
        }
      }
    }
    tls = {
      directory: { rva: tlsDir.rva, size: tlsDir.size, file_offset: fileOffset },
      start_address_of_raw_data: formatVa(start),
      end_address_of_raw_data: formatVa(endVa),
      raw_data_size: startRva === null ? 0 : Number(endVa - start),
      raw_data_file_offset: startRva === null ? null : (mapRva(image.sections, startRva) ?? null),
      raw_data_section: startRva === null ? null : (sectionForRva(image.sections, startRva)?.name ?? null),
      address_of_index: addressRef(image, indexVa),
      address_of_callbacks: formatVa(callbacksVa),
      size_of_zero_fill: sizeOfZeroFill,
      characteristics,
      alignment: null,
      callbacks,
      callback_array_locations: callbackLocations,
    };
  }

  let loadConfig: PeLoadConfigInfo | null = null;
  const lcDir = image.directories[DIR.LOAD_CONFIG];
  if (lcDir !== undefined && lcDir.rva !== 0) {
    const fileOffset = mapRva(image.sections, lcDir.rva);
    if (fileOffset === undefined) throw peInputError('inspect_pe_load_config', path, 'invalid_format', 'load config directory RVA does not map.');
    if (fileOffset + 4 > bytes.length) throw peInputError('inspect_pe_load_config', path, 'invalid_format', 'load config directory is truncated.');
    const size = bytes.readUInt32LE(fileOffset);
    if (size < 4 || fileOffset + size > bytes.length) throw peInputError('inspect_pe_load_config', path, 'invalid_format', 'load config structure is truncated.');

    const readOptionalVa = (fieldOffset: number): AddressRef | null => {
      if (fieldOffset + ptrSize > size) return null;
      return addressRef(image, readWide(bytes, fileOffset + fieldOffset, image.bits));
    };
    const readOptionalU32 = (fieldOffset: number): number | null => (fieldOffset + 4 > size ? null : bytes.readUInt32LE(fileOffset + fieldOffset));
    const readOptionalU64 = (fieldOffset: number): string | null => {
      if (fieldOffset + ptrSize > size) return null;
      return formatVa(readWide(bytes, fileOffset + fieldOffset, image.bits));
    };

    // Layout mirrors Microsoft PE/COFF IMAGE_LOAD_CONFIG_DIRECTORY32/64.
    const cookieOff = image.bits === 64 ? 88 : 60;
    const seTableOff = image.bits === 64 ? 96 : 64;
    const seCountOff = image.bits === 64 ? 104 : 68;
    const cfgCheckOff = image.bits === 64 ? 112 : 72;
    const cfgDispatchOff = image.bits === 64 ? 120 : 76;
    const cfgTableOff = image.bits === 64 ? 128 : 80;
    const cfgCountOff = image.bits === 64 ? 136 : 84;
    const guardFlagsOff = image.bits === 64 ? 144 : 88;
    const codeIntegrityEnd = image.bits === 64 ? 164 : 108;
    const iatTableOff = codeIntegrityEnd;
    const iatCountOff = iatTableOff + ptrSize;
    const longJumpOff = iatCountOff + ptrSize;
    const longJumpCountOff = longJumpOff + ptrSize;
    const dynamicRelocOff = longJumpCountOff + ptrSize;
    const chpeOff = dynamicRelocOff + ptrSize;
    const dynamicRelocTableOffsetOff = chpeOff + ptrSize;
    const dynamicRelocSectionOff = dynamicRelocTableOffsetOff + 4;
    const ehContTableOff = dynamicRelocSectionOff + 4;
    const ehContCountOff = ehContTableOff + ptrSize;
    const xfgCheckOff = ehContCountOff + ptrSize;

    const guardFlagsRaw = readOptionalU32(guardFlagsOff);
    let guardFlags: PeLoadConfigInfo['guard_flags'] = null;
    if (guardFlagsRaw !== null) {
      const flags = GUARD_FLAGS.filter((entry) => (guardFlagsRaw & entry.bit) !== 0).map((entry) => entry.name);
      const recognized = GUARD_FLAGS.reduce((mask, entry) => mask | entry.bit, 0) | 0xf000_0000;
      guardFlags = {
        raw: guardFlagsRaw,
        flags,
        unrecognized: guardFlagsRaw & ~recognized,
        cf_function_table_stride: (guardFlagsRaw >>> 28) & 0xf,
      };
    }

    const inferences: { id: string; evidence_kind: string; basis: string }[] = [];
    if (guardFlags?.flags.includes('IMAGE_GUARD_CF_INSTRUMENTED') === true) {
      inferences.push({ id: 'cfg_instrumented', evidence_kind: 'inferred', basis: 'IMAGE_GUARD_CF_INSTRUMENTED is set in GuardFlags' });
    }
    if (guardFlags?.flags.includes('IMAGE_GUARD_CFW_INSTRUMENTED') === true) {
      inferences.push({ id: 'cf_write_instrumented', evidence_kind: 'inferred', basis: 'IMAGE_GUARD_CFW_INSTRUMENTED is set in GuardFlags' });
    }
    if (guardFlags?.flags.includes('IMAGE_GUARD_RF_INSTRUMENTED') === true) {
      inferences.push({ id: 'rf_instrumented', evidence_kind: 'inferred', basis: 'IMAGE_GUARD_RF_INSTRUMENTED is set in GuardFlags' });
    }
    if (guardFlags?.flags.includes('IMAGE_GUARD_RETPOLINE_PRESENT') === true) {
      inferences.push({ id: 'retpoline_present', evidence_kind: 'inferred', basis: 'IMAGE_GUARD_RETPOLINE_PRESENT is set in GuardFlags' });
    }
    if (guardFlags?.flags.includes('IMAGE_GUARD_XFG_ENABLED') === true) {
      inferences.push({ id: 'xfg_enabled', evidence_kind: 'inferred', basis: 'IMAGE_GUARD_XFG_ENABLED is set in GuardFlags' });
    }
    if (guardFlags?.flags.includes('IMAGE_GUARD_CASTGUARD_PRESENT') === true) {
      inferences.push({ id: 'castguard_present', evidence_kind: 'inferred', basis: 'IMAGE_GUARD_CASTGUARD_PRESENT is set in GuardFlags' });
    }

    loadConfig = {
      directory: { rva: lcDir.rva, size: lcDir.size, file_offset: fileOffset },
      size,
      structure_location: { offset: fileOffset, bytes: size },
      security_cookie: readOptionalVa(cookieOff),
      se_handler_table: image.bits === 32 ? readOptionalVa(seTableOff) : null,
      se_handler_count: image.bits === 32 ? readOptionalU32(seCountOff) : null,
      guard_cf_check_function_pointer: readOptionalVa(cfgCheckOff),
      guard_cf_dispatch_function_pointer: readOptionalVa(cfgDispatchOff),
      guard_cf_function_table: readOptionalVa(cfgTableOff),
      guard_cf_function_count: readOptionalU32(cfgCountOff) === null && image.bits === 64 ? (cfgCountOff + 8 <= size ? Number(readWide(bytes, fileOffset + cfgCountOff, 64)) : null) : readOptionalU32(cfgCountOff),
      guard_flags: guardFlags,
      guard_address_taken_iat_entry_table: readOptionalVa(iatTableOff),
      guard_address_taken_iat_entry_count: image.bits === 64 ? (iatCountOff + 8 <= size ? Number(readWide(bytes, fileOffset + iatCountOff, 64)) : null) : readOptionalU32(iatCountOff),
      guard_long_jump_target_table: readOptionalVa(longJumpOff),
      guard_long_jump_target_count: image.bits === 64 ? (longJumpCountOff + 8 <= size ? Number(readWide(bytes, fileOffset + longJumpCountOff, 64)) : null) : readOptionalU32(longJumpCountOff),
      dynamic_value_reloc_table: readOptionalU64(dynamicRelocOff),
      chpe_metadata_pointer: readOptionalU64(chpeOff),
      dynamic_value_reloc_table_offset: readOptionalU32(dynamicRelocTableOffsetOff),
      dynamic_value_reloc_table_section: readOptionalU32(dynamicRelocSectionOff) !== null ? bytes.readUInt16LE(fileOffset + dynamicRelocSectionOff) : null,
      guard_eh_continuation_table: readOptionalVa(ehContTableOff),
      guard_eh_continuation_count: image.bits === 64 ? (ehContCountOff + 8 <= size ? Number(readWide(bytes, fileOffset + ehContCountOff, 64)) : null) : readOptionalU32(ehContCountOff),
      guard_xfg_check_function_pointer: readOptionalVa(xfgCheckOff),
      inferences,
    };
  }

  return {
    path,
    resolvedPath,
    record: {
      artifact: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
      format: image.format,
      machine: image.machine,
      bits: image.bits,
      architecture: peLoadConfigArchitecture(image.architecture),
      tls,
      load_config: loadConfig,
      examined_callbacks: examinedCallbacks,
      limitations: [...PE_LOAD_CONFIG_LIMITATIONS],
    },
  };
};
