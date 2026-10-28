
import { createHash } from 'node:crypto';

import {
  DIR,
  mapRva,
  parsePeImage,
  peInputError,
  readCString,
  resolvePathBytes,
  type PeFileLocation,
  type PeImage,
} from './pe-core.ts';

export const DEFAULT_MAX_DLLS = 256;
export const DEFAULT_MAX_FUNCTIONS = 8192;

export const peImportsArchitecture = (architecture: string): string => {
  if (architecture === 'x86_64') return 'amd64';
  if (architecture === 'x86') return '386';
  return architecture;
};

export interface PeImportFunction {
  readonly hint: number | null;
  readonly name: string | null;
  readonly ordinal: number | null;
  readonly ilt_rva: number | null;
  readonly iat_rva: number;
  readonly thunk_hex: string;
}

export interface PeImportDll {
  readonly index: number;
  readonly name: string | null;
  readonly name_rva: number;
  readonly original_first_thunk_rva: number;
  readonly first_thunk_rva: number;
  readonly time_date_stamp: number;
  readonly forwarder_chain: number;
  readonly location: PeFileLocation;
  readonly functions: readonly PeImportFunction[];
}

export interface PeDelayImportDll {
  readonly index: number;
  readonly name: string | null;
  readonly name_rva: number;
  readonly attributes: number;
  readonly import_address_table_rva: number;
  readonly import_name_table_rva: number;
  readonly bound_import_rva: number;
  readonly unload_information_table_rva: number;
  readonly module_handle_rva: number;
  readonly time_date_stamp: number;
  readonly location: PeFileLocation;
  readonly functions: readonly PeImportFunction[];
}

export interface PeImportsInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly format: 'pe32' | 'pe32-plus';
  readonly machine: number;
  readonly bits: 32 | 64;
  readonly architecture: string;
  readonly import_directory: { readonly rva: number; readonly size: number; readonly locations: readonly PeFileLocation[] } | null;
  readonly delay_import_directory: { readonly rva: number; readonly size: number; readonly locations: readonly PeFileLocation[] } | null;
  readonly imports: readonly PeImportDll[];
  readonly delay_imports: readonly PeDelayImportDll[];
  readonly imphash: { readonly algorithm: string; readonly md5: string | null; readonly reason: string | null };
  readonly coverage: {
    readonly status: 'complete' | 'partial';
    readonly reason: string | null;
    readonly examined_dlls: number;
    readonly imports: number;
    readonly delay_imports: number;
  };
  readonly issues: readonly { readonly code: string; readonly location: string | null; readonly message: string }[];
  readonly limitations: readonly string[];
}

export const PE_IMPORT_LIMITATIONS = [
  'Rows reproduce the PE import and delay-load directories; they do not establish that an import is bound, forwarded or reachable at runtime.',
  'Bound import snapshots, the import address table as loaded, and export-forward resolution in another DLL remain unobserved.',
];

const highBit = (bits: 32 | 64): bigint => (bits === 64 ? 0x8000_0000_0000_0000n : 0x8000_0000n);

const thunkHex = (raw: bigint): string => raw.toString(16);

const readThunk = (bytes: Buffer, offset: number, bits: 32 | 64): bigint =>
  bits === 64 ? bytes.readBigUInt64LE(offset) : BigInt(bytes.readUInt32LE(offset));

const readFunctions = (
  bytes: Buffer,
  image: PeImage,
  nameTableRva: number,
  addressTableRva: number,
  bits: 32 | 64,
  remaining: { count: number },
  issues: { code: string; location: string | null; message: string }[],
  locationPrefix: string,
): { functions: PeImportFunction[]; truncated: boolean } => {
  const functions: PeImportFunction[] = [];
  const entrySize = bits === 64 ? 8 : 4;
  const bit = highBit(bits);
  let truncated = false;
  for (let index = 0; ; index += 1) {
    if (remaining.count <= 0) {
      truncated = true;
      break;
    }
    const iltOffset = nameTableRva === 0 ? undefined : mapRva(image.sections, nameTableRva + index * entrySize);
    const iatOffset = mapRva(image.sections, addressTableRva + index * entrySize);
    if (iatOffset === undefined || iatOffset + entrySize > bytes.length) {
      issues.push({ code: 'thunk_unreadable', location: `${locationPrefix}/function/${index}`, message: 'IAT thunk does not map to a readable file range.' });
      truncated = true;
      break;
    }
    const raw = readThunk(bytes, iatOffset, bits);
    const iltRaw =
      iltOffset !== undefined && iltOffset + entrySize <= bytes.length ? readThunk(bytes, iltOffset, bits) : raw;
    if (iltRaw === 0n && raw === 0n) break;
    remaining.count -= 1;
    const source = nameTableRva !== 0 ? iltRaw : raw;
    let hint: number | null = null;
    let name: string | null = null;
    let ordinal: number | null = null;
    if ((source & bit) !== 0n) {
      ordinal = Number(source & 0xffffn);
    } else {
      const nameRva = Number(source & (bits === 64 ? 0x7fff_ffff_ffff_ffffn : 0x7fff_ffffn));
      const nameOffset = mapRva(image.sections, nameRva);
      if (nameOffset === undefined || nameOffset + 2 > bytes.length) {
        issues.push({ code: 'name_unreadable', location: `${locationPrefix}/function/${index}`, message: 'Import name RVA does not map to a readable file range.' });
      } else {
        hint = bytes.readUInt16LE(nameOffset);
        name = readCString(bytes, nameOffset + 2);
      }
    }
    functions.push({
      hint,
      name,
      ordinal,
      ilt_rva: nameTableRva === 0 ? null : nameTableRva + index * entrySize,
      iat_rva: addressTableRva + index * entrySize,
      thunk_hex: thunkHex(source),
    });
  }
  return { functions, truncated };
};

const imphashOf = (imports: readonly PeImportDll[]): { md5: string | null; reason: string | null } => {
  const parts: string[] = [];
  for (const dll of imports) {
    if (dll.name === null) return { md5: null, reason: 'A DLL name was unreadable, so imphash is withheld.' };
    const dllName = dll.name.toLowerCase().replace(/\.dll$/i, '');
    for (const fn of dll.functions) {
      if (fn.ordinal !== null && fn.name === null) {
        parts.push(`${dllName}.ord${fn.ordinal}`);
      } else if (fn.name !== null) {
        parts.push(`${dllName}.${fn.name.toLowerCase()}`);
      } else {
        return { md5: null, reason: 'An imported function lacked both a name and an ordinal, so imphash is withheld.' };
      }
    }
  }
  if (parts.length === 0) return { md5: createHash('md5').update('').digest('hex'), reason: null };
  return { md5: createHash('md5').update(parts.join(',')).digest('hex'), reason: null };
};

const readImportDirectory = (
  bytes: Buffer,
  image: PeImage,
  maxDlls: number,
  remaining: { count: number },
  issues: { code: string; location: string | null; message: string }[],
): { imports: PeImportDll[]; truncated: boolean } => {
  const directory = image.directories[DIR.IMPORT];
  if (directory === undefined || (directory.rva === 0 && directory.size === 0)) return { imports: [], truncated: false };
  const base = mapRva(image.sections, directory.rva);
  if (base === undefined) {
    issues.push({ code: 'descriptor_unreadable', location: 'import_directory', message: 'Import directory RVA does not map to a readable file range.' });
    return { imports: [], truncated: true };
  }
  const imports: PeImportDll[] = [];
  let truncated = false;
  for (let index = 0; index < maxDlls; index += 1) {
    const descriptor = base + index * 20;
    if (descriptor + 20 > bytes.length) {
      issues.push({ code: 'descriptor_unreadable', location: `imports/${index}`, message: 'Import descriptor is truncated.' });
      truncated = true;
      break;
    }
    const originalFirstThunk = bytes.readUInt32LE(descriptor);
    const timeDateStamp = bytes.readUInt32LE(descriptor + 4);
    const forwarderChain = bytes.readUInt32LE(descriptor + 8);
    const nameRva = bytes.readUInt32LE(descriptor + 12);
    const firstThunk = bytes.readUInt32LE(descriptor + 16);
    if (originalFirstThunk === 0 && nameRva === 0 && firstThunk === 0) break;
    if (imports.length >= maxDlls) {
      truncated = true;
      break;
    }
    const nameOffset = mapRva(image.sections, nameRva);
    const name = nameOffset === undefined ? null : readCString(bytes, nameOffset);
    if (name === null) issues.push({ code: 'name_unreadable', location: `imports/${index}`, message: 'DLL name RVA does not map to a readable string.' });
    const { functions, truncated: fnTruncated } = readFunctions(bytes, image, originalFirstThunk, firstThunk, image.bits, remaining, issues, `imports/${index}`);
    truncated = truncated || fnTruncated;
    imports.push({
      index,
      name,
      name_rva: nameRva,
      original_first_thunk_rva: originalFirstThunk,
      first_thunk_rva: firstThunk,
      time_date_stamp: timeDateStamp,
      forwarder_chain: forwarderChain,
      location: { offset: descriptor, bytes: 20 },
      functions,
    });
  }
  return { imports, truncated };
};

const readDelayImports = (
  bytes: Buffer,
  image: PeImage,
  maxDlls: number,
  remaining: { count: number },
  issues: { code: string; location: string | null; message: string }[],
): { delayImports: PeDelayImportDll[]; truncated: boolean } => {
  const directory = image.directories[DIR.DELAY_IMPORT];
  if (directory === undefined || (directory.rva === 0 && directory.size === 0)) return { delayImports: [], truncated: false };
  const base = mapRva(image.sections, directory.rva);
  if (base === undefined) {
    issues.push({ code: 'descriptor_unreadable', location: 'delay_import_directory', message: 'Delay-import directory RVA does not map to a readable file range.' });
    return { delayImports: [], truncated: true };
  }
  const delayImports: PeDelayImportDll[] = [];
  let truncated = false;
  for (let index = 0; index < maxDlls; index += 1) {
    const descriptor = base + index * 32;
    if (descriptor + 32 > bytes.length) {
      issues.push({ code: 'descriptor_unreadable', location: `delay_imports/${index}`, message: 'Delay-import descriptor is truncated.' });
      truncated = true;
      break;
    }
    const attributes = bytes.readUInt32LE(descriptor);
    const nameRva = bytes.readUInt32LE(descriptor + 4);
    const moduleHandleRva = bytes.readUInt32LE(descriptor + 8);
    const iatRva = bytes.readUInt32LE(descriptor + 12);
    const intRva = bytes.readUInt32LE(descriptor + 16);
    const boundRva = bytes.readUInt32LE(descriptor + 20);
    const unloadRva = bytes.readUInt32LE(descriptor + 24);
    const timeDateStamp = bytes.readUInt32LE(descriptor + 28);
    if (attributes === 0 && nameRva === 0 && iatRva === 0 && intRva === 0) break;
    if (delayImports.length >= maxDlls) {
      truncated = true;
      break;
    }
    const nameOffset = mapRva(image.sections, nameRva);
    const name = nameOffset === undefined ? null : readCString(bytes, nameOffset);
    const { functions, truncated: fnTruncated } = readFunctions(bytes, image, intRva, iatRva, image.bits, remaining, issues, `delay_imports/${index}`);
    truncated = truncated || fnTruncated;
    delayImports.push({
      index,
      name,
      name_rva: nameRva,
      attributes,
      import_address_table_rva: iatRva,
      import_name_table_rva: intRva,
      bound_import_rva: boundRva,
      unload_information_table_rva: unloadRva,
      module_handle_rva: moduleHandleRva,
      time_date_stamp: timeDateStamp,
      location: { offset: descriptor, bytes: 32 },
      functions,
    });
  }
  return { delayImports, truncated };
};

export interface PeImportsOptions {
  readonly maxFileBytes?: number;
  readonly maxDlls?: number;
  readonly maxFunctions?: number;
  readonly cwd?: string;
}

export const inspectPeImportsFromPath = async (
  path: string,
  options: PeImportsOptions = {},
): Promise<{ record: PeImportsInspection; path: string; resolvedPath: string }> => {
  const maxDlls = options.maxDlls ?? DEFAULT_MAX_DLLS;
  const maxFunctions = options.maxFunctions ?? DEFAULT_MAX_FUNCTIONS;
  if (!Number.isInteger(maxDlls) || maxDlls < 1 || maxDlls > 65_536) {
    throw peInputError('inspect_pe_imports', path, 'invalid_value', 'max_dlls must be an integer between 1 and 65536.');
  }
  if (!Number.isInteger(maxFunctions) || maxFunctions < 1 || maxFunctions > 1_048_576) {
    throw peInputError('inspect_pe_imports', path, 'invalid_value', 'max_functions must be an integer between 1 and 1048576.');
  }

  const { bytes, resolvedPath } = await resolvePathBytes(path, {
    ...(options.maxFileBytes === undefined ? {} : { maxFileBytes: options.maxFileBytes }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    operation: 'inspect_pe_imports',
  });

  let image: PeImage;
  try {
    image = parsePeImage(bytes);
  } catch {
    throw peInputError('inspect_pe_imports', path, 'invalid_format', 'the file is not an MZ PE image.');
  }

  const issues: { code: string; location: string | null; message: string }[] = [];
  const remaining = { count: maxFunctions };
  const { imports, truncated: importTruncated } = readImportDirectory(bytes, image, maxDlls, remaining, issues);
  const { delayImports, truncated: delayTruncated } = readDelayImports(bytes, image, maxDlls, remaining, issues);
  const truncated = importTruncated || delayTruncated;
  if (truncated) {
    throw peInputError(
      'inspect_pe_imports',
      path,
      'invalid_value',
      `the import tables exceed the configured budget (max_dlls=${maxDlls}, max_functions=${maxFunctions}) or contain unreadable entries.`,
    );
  }

  const importDir = image.directories[DIR.IMPORT];
  const delayDir = image.directories[DIR.DELAY_IMPORT];
  const hash = imphashOf(imports);
  const importTableOffset =
    importDir === undefined || (importDir.rva === 0 && importDir.size === 0) ? undefined : mapRva(image.sections, importDir.rva);
  const delayTableOffset =
    delayDir === undefined || (delayDir.rva === 0 && delayDir.size === 0) ? undefined : mapRva(image.sections, delayDir.rva);

  return {
    path,
    resolvedPath,
    record: {
      artifact: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
      format: image.format,
      machine: image.machine,
      bits: image.bits,
      architecture: peImportsArchitecture(image.architecture),
      import_directory:
        importDir === undefined || (importDir.rva === 0 && importDir.size === 0) || importTableOffset === undefined
          ? null
          : {
              rva: importDir.rva,
              size: importDir.size,
              locations: [{ offset: importTableOffset, bytes: (imports.length + 1) * 20 }],
            },
      delay_import_directory:
        delayDir === undefined || (delayDir.rva === 0 && delayDir.size === 0) || delayTableOffset === undefined
          ? null
          : {
              rva: delayDir.rva,
              size: delayDir.size,
              locations: [{ offset: delayTableOffset, bytes: (delayImports.length + 1) * 32 }],
            },
      imports,
      delay_imports: delayImports,
      imphash: { algorithm: 'pefile', md5: hash.md5, reason: hash.reason },
      coverage: {
        status: 'complete',
        reason: null,
        examined_dlls: imports.length + delayImports.length,
        imports: imports.reduce((sum, dll) => sum + dll.functions.length, 0),
        delay_imports: delayImports.reduce((sum, dll) => sum + dll.functions.length, 0),
      },
      issues,
      limitations: [...PE_IMPORT_LIMITATIONS],
    },
  };
};
