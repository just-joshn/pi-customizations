import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export interface PeFileLocation {
  readonly offset: number;
  readonly bytes: number;
}

export interface PeResourceName {
  readonly kind: 'id' | 'name';
  readonly id?: number;
  readonly name?: string;
}

export interface PeResource {
  readonly index: number;
  readonly type: PeResourceName;
  readonly name: PeResourceName;
  readonly language: PeResourceName;
  readonly entry_locations: PeFileLocation[];
  readonly data_entry_location: PeFileLocation;
  readonly code_page: number;
  readonly reserved: number;
  readonly payload: { readonly rva: number; readonly location: PeFileLocation; readonly sha256: string };
}

export interface PeDirectory {
  readonly path: readonly PeResourceName[];
  readonly entry_locations: readonly PeFileLocation[];
  readonly location: PeFileLocation;
  readonly characteristics: number;
  readonly timestamp: number;
  readonly major_version: number;
  readonly minor_version: number;
  readonly named_entries: number;
  readonly id_entries: number;
}

export interface PeIconImage {
  readonly location: PeFileLocation;
  readonly width: number;
  readonly height: number;
  readonly color_count: number;
  readonly reserved: number;
  readonly planes: number;
  readonly bit_count: number;
  readonly declared_bytes: number;
  readonly resource_id: number;
  readonly candidate_resource_indices: number[];
  readonly same_language_resource_index: number | null;
  readonly size_matches: boolean;
}

export interface PeResourceInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly format: 'pe32' | 'pe32-plus';
  readonly machine: number;
  readonly directory: { readonly rva: number; readonly location: PeFileLocation; readonly data_directory_location: PeFileLocation } | null;
  readonly directories: PeDirectory[];
  readonly resources: PeResource[];
  readonly icon_groups: { readonly resource_index: number; readonly images: PeIconImage[] }[];
  readonly coverage: { readonly status: 'complete' | 'partial'; readonly examined_entries: number; readonly resources: number };
  readonly limitations: string[];
}

export const PE_LIMITATIONS = [
  'Static PE32/PE32+ type/name/language resource inventory; payloads other than RT_GROUP_ICON remain opaque.',
  'Icon candidates are resource-table relationships. Language fallback, image decoding and actual shell/window loading are not observed.',
  'Exact shared byte ranges are retained; non-identical overlapping resource structures or payloads are rejected.',
];

export const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_ENTRIES = 4096;

const DOS_MAGIC = 0x5a4d;
const RESOURCE_DIRECTORY_INDEX = 2;
const RT_ICON = 3;
const RT_GROUP_ICON = 14;

export const peInputError = (path: string, reason: string, detail: string): ReturnType<typeof invalidRequest> =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_pe_resources',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

interface Section {
  readonly name: string;
  readonly virtualAddress: number;
  readonly virtualSize: number;
  readonly rawOffset: number;
  readonly rawSize: number;
}

const readName = (bytes: Buffer, offset: number, length: number): string => {
  const raw = bytes.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
};

export const parsePe = (
  bytes: Buffer,
): {
  readonly format: 'pe32' | 'pe32-plus';
  readonly machine: number;
  readonly sections: Section[];
  readonly directoryRva: number;
  readonly directorySize: number;
  readonly dataDirectoryLocation: PeFileLocation;
} => {
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== DOS_MAGIC) throw new Error('not an MZ image');
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 24 > bytes.length || bytes.subarray(peOffset, peOffset + 4).toString('latin1') !== 'PE\0\0') {
    throw new Error('no PE signature');
  }
  const machine = bytes.readUInt16LE(peOffset + 4);
  const sectionCount = bytes.readUInt16LE(peOffset + 6);
  const optionalSize = bytes.readUInt16LE(peOffset + 20);
  const optional = peOffset + 24;
  if (optional + optionalSize > bytes.length) throw new Error('truncated optional header');
  const magic = bytes.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error('unsupported optional header magic');
  const format = magic === 0x20b ? 'pe32-plus' : 'pe32';
  const directoryCountOffset = magic === 0x20b ? 108 : 92;
  const directoriesOffset = magic === 0x20b ? 112 : 96;
  const directoryCount = bytes.readUInt32LE(optional + directoryCountOffset);
  if (directoryCount <= RESOURCE_DIRECTORY_INDEX) throw new Error('no resource data directory');
  const directoryAt = optional + directoriesOffset + RESOURCE_DIRECTORY_INDEX * 8;
  if (directoryAt + 8 > bytes.length) throw new Error('truncated resource data directory');
  const directoryRva = bytes.readUInt32LE(directoryAt);
  const directorySize = bytes.readUInt32LE(directoryAt + 4);

  const sections: Section[] = [];
  const sectionTable = optional + optionalSize;
  for (let index = 0; index < sectionCount; index += 1) {
    const at = sectionTable + index * 40;
    if (at + 40 > bytes.length) break;
    sections.push({
      name: readName(bytes, at, 8),
      virtualSize: bytes.readUInt32LE(at + 8),
      virtualAddress: bytes.readUInt32LE(at + 12),
      rawSize: bytes.readUInt32LE(at + 16),
      rawOffset: bytes.readUInt32LE(at + 20),
    });
  }
  return { format, machine, sections, directoryRva, directorySize, dataDirectoryLocation: { offset: directoryAt, bytes: 8 } };
};

export const mapRva = (sections: readonly Section[], rva: number): number | undefined => {
  const matches = sections.filter((section) => rva >= section.virtualAddress && rva < section.virtualAddress + Math.max(section.virtualSize, section.rawSize));
  if (matches.length !== 1) return undefined;
  const [section] = matches as [Section];
  const offset = section.rawOffset + (rva - section.virtualAddress);
  return offset < section.rawOffset + section.rawSize ? offset : undefined;
};

const resourceName = (bytes: Buffer, base: number, nameField: number): PeResourceName => {
  if ((nameField & 0x8000_0000) === 0) return { kind: 'id', id: nameField };
  const at = base + (nameField & 0x7fff_ffff);
  const length = bytes.readUInt16LE(at);
  return { kind: 'name', name: bytes.subarray(at + 2, at + 2 + length * 2).toString('utf16le') };
};

export interface PeResourceOptions {
  readonly maxFileBytes?: number;
  readonly maxEntries?: number;
  readonly cwd?: string;
}

export const inspectPeResourcesFromPath = async (path: string, options: PeResourceOptions = {}): Promise<{ record: PeResourceInspection; path: string; resolvedPath: string }> => {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 64 || maxFileBytes > 536_870_912) {
    throw peInputError(path, 'invalid_value', 'max_file_bytes must be an integer between 64 and 536870912.');
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 65_536) {
    throw peInputError(path, 'invalid_value', 'max_entries must be an integer between 1 and 65536.');
  }
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw peInputError(path, 'invalid_value', reason);
  }
  if (bytes.length > maxFileBytes) {
    throw peInputError(path, 'invalid_value', `the image is ${bytes.length} bytes, more than the ${maxFileBytes} byte limit`);
  }

  let pe: ReturnType<typeof parsePe>;
  try {
    pe = parsePe(bytes);
  } catch {
    throw peInputError(path, 'invalid_format', 'the file is not an MZ PE image.');
  }

  const hasDirectory = pe.directoryRva !== 0 && pe.directorySize !== 0;
  const directoryOffset = hasDirectory ? mapRva(pe.sections, pe.directoryRva) : undefined;
  if (hasDirectory && directoryOffset === undefined) {
    throw peInputError(path, 'invalid_format', 'the resource directory RVA does not map to exactly one file range.');
  }

  const directories: PeDirectory[] = [];
  const resources: PeResource[] = [];
  let examinedEntries = 0;

  const readDirectory = (offset: number, pathNames: readonly PeResourceName[], entryLocations: readonly PeFileLocation[]): PeDirectory => {
    const namedEntries = bytes.readUInt16LE(offset + 12);
    const idEntries = bytes.readUInt16LE(offset + 14);
    const directory: PeDirectory = {
      path: pathNames,
      entry_locations: entryLocations,
      location: { offset, bytes: 16 + (namedEntries + idEntries) * 8 },
      characteristics: bytes.readUInt32LE(offset),
      timestamp: bytes.readUInt32LE(offset + 4),
      major_version: bytes.readUInt16LE(offset + 8),
      minor_version: bytes.readUInt16LE(offset + 10),
      named_entries: namedEntries,
      id_entries: idEntries,
    };
    directories.push(directory);
    return directory;
  };

  const entryCount = (directory: PeDirectory): number => directory.named_entries + directory.id_entries;

  const callerPath = path;
  const resourceBase = directoryOffset ?? 0;
  const walk = (offset: number, node: { type?: PeResourceName; name?: PeResourceName; pathNames: readonly PeResourceName[]; locations: PeFileLocation[] }): void => {
    const directory = readDirectory(offset, node.pathNames, node.locations);
    const total = entryCount(directory);
    examinedEntries += total;
    if (examinedEntries > maxEntries) {
      throw peInputError(callerPath, 'invalid_value', `the resource tree exceeds the ${maxEntries} entry limit`);
    }
    for (let index = 0; index < total; index += 1) {
      const at = offset + 16 + index * 8;
      const nameField = bytes.readUInt32LE(at);
      const valueField = bytes.readUInt32LE(at + 4);
      const name = resourceName(bytes, resourceBase, nameField);
      const locations = [...node.locations, { offset: at, bytes: 8 }];
      const pathNames = [...node.pathNames, name];
      if ((valueField & 0x8000_0000) !== 0) {
        const child = resourceBase + (valueField & 0x7fff_ffff);
        if (node.type === undefined) walk(child, { type: name, pathNames, locations });
        else if (node.name === undefined) walk(child, { type: node.type, name, pathNames, locations });
        else throw new Error('resource tree is deeper than type/name/language');
        continue;
      }
      if (node.type === undefined || node.name === undefined) throw new Error('a resource data entry is not under type, name and language');
      const dataEntry = resourceBase + valueField;
      const payloadRva = bytes.readUInt32LE(dataEntry);
      const payloadSize = bytes.readUInt32LE(dataEntry + 4);
      const payloadOffset = mapRva(pe.sections, payloadRva);
      if (payloadOffset === undefined || payloadOffset + payloadSize > bytes.length) {
        throw peInputError(callerPath, 'invalid_format', 'a resource payload does not map to one file range.');
      }
      const payload = bytes.subarray(payloadOffset, payloadOffset + payloadSize);
      resources.push({
        index: resources.length,
        type: node.type,
        name: node.name,
        language: name,
        entry_locations: locations,
        data_entry_location: { offset: dataEntry, bytes: 16 },
        code_page: bytes.readUInt32LE(dataEntry + 8),
        reserved: bytes.readUInt32LE(dataEntry + 12),
        payload: { rva: payloadRva, location: { offset: payloadOffset, bytes: payloadSize }, sha256: createHash('sha256').update(payload).digest('hex') },
      });
    }
  };

  try {
    if (directoryOffset !== undefined) walk(directoryOffset, { pathNames: [], locations: [] });
  } catch (error) {
    if (error instanceof Error && 'payload' in error) throw error;
    throw peInputError(path, 'invalid_format', (error as Error).message);
  }

  const iconResources = resources.filter((resource) => resource.type.kind === 'id' && resource.type.id === RT_ICON);
  const iconGroups = resources
    .filter((resource) => resource.type.kind === 'id' && resource.type.id === RT_GROUP_ICON)
    .map((resource) => {
      const group = bytes.subarray(resource.payload.location.offset, resource.payload.location.offset + resource.payload.location.bytes);
      const count = group.length >= 6 ? group.readUInt16LE(4) : 0;
      const images: PeIconImage[] = [];
      for (let index = 0; index < count; index += 1) {
        const at = resource.payload.location.offset + 6 + index * 14;
        if (at + 14 > bytes.length) break;
        const entry = bytes.subarray(at, at + 14);
        const resourceId = entry.readUInt16LE(12);
        const declaredBytes = entry.readUInt32LE(8);
        const candidates = iconResources.filter((candidate) => candidate.name.kind === 'id' && candidate.name.id === resourceId);
        const sameLanguage = candidates.find((candidate) => candidate.language.kind === 'id' && resource.language.kind === 'id' && candidate.language.id === resource.language.id);
        images.push({
          location: { offset: at, bytes: 14 },
          width: entry.readUInt8(0),
          height: entry.readUInt8(1),
          color_count: entry.readUInt8(2),
          reserved: entry.readUInt8(3),
          planes: entry.readUInt16LE(4),
          bit_count: entry.readUInt16LE(6),
          declared_bytes: declaredBytes,
          resource_id: resourceId,
          candidate_resource_indices: candidates.map((candidate) => candidate.index),
          same_language_resource_index: sameLanguage?.index ?? null,
          size_matches: candidates.some((candidate) => candidate.payload.location.bytes === declaredBytes),
        });
      }
      return { resource_index: resource.index, images };
    });

  return {
    path,
    resolvedPath,
    record: {
      artifact: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length },
      format: pe.format,
      machine: pe.machine,
      directory: hasDirectory && directoryOffset !== undefined ? { rva: pe.directoryRva, location: { offset: directoryOffset, bytes: pe.directorySize }, data_directory_location: pe.dataDirectoryLocation } : null,
      directories,
      resources,
      icon_groups: iconGroups,
      coverage: { status: 'complete', examined_entries: examinedEntries, resources: resources.length },
      limitations: [...PE_LIMITATIONS],
    },
  };
};
