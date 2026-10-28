import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest, unsupportedTarget } from '../contract/errors.ts';

export const MAX_DEVICETREE_FILE_BYTES = 16_777_216;
export const DEFAULT_MAX_FILE_BYTES = 4_194_304;
export const DEFAULT_MAX_NODES = 8192;
export const DEFAULT_MAX_PROPERTIES = 32_768;
export const DEFAULT_MAX_DEPTH = 64;
const DECODED_BYTE_ALLOWANCE = 33_554_432;
const FDT_MAGIC = 0xd00dfeed;
const FDT_BEGIN_NODE = 1;
const FDT_END_NODE = 2;
const FDT_PROP = 3;
const FDT_NOP = 4;
const FDT_END = 9;

export class DevicetreeLimitError extends Error {
  readonly limit: string;
  constructor(limit: string, message: string) {
    super(message);
    this.name = 'DevicetreeLimitError';
    this.limit = limit;
  }
}

export class DevicetreeFormatError extends Error {
  readonly kind: 'malformed' | 'unsupported';
  constructor(kind: 'malformed' | 'unsupported', message: string) {
    super(message);
    this.name = 'DevicetreeFormatError';
    this.kind = kind;
  }
}

export interface DevicetreeParseInput {
  readonly max_file_bytes: number;
  readonly max_nodes: number;
  readonly max_properties: number;
  readonly max_depth: number;
}

export interface DevicetreeArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface DevicetreeReport {
  readonly artifact: DevicetreeArtifact;
  readonly header: {
    readonly magic: number;
    readonly totalsize: number;
    readonly off_dt_struct: number;
    readonly off_dt_strings: number;
    readonly off_mem_rsvmap: number;
    readonly version: number;
    readonly last_comp_version: number;
    readonly boot_cpuid_phys: number;
    readonly size_dt_strings: number;
    readonly size_dt_struct: number | null;
  };
  readonly reservations: readonly { readonly offset: number; readonly address: string; readonly size: string }[];
  readonly nodes: readonly {
    readonly path: string;
    readonly parent: string | null;
    readonly offset: number;
    readonly properties: readonly DevicetreeProperty[];
  }[];
  readonly references: readonly {
    readonly source: string;
    readonly property: string;
    readonly phandle: number;
    readonly target: string | null;
    readonly confidence: 'derived';
  }[];
  readonly summary: {
    readonly confidence: 'derived';
    readonly compatible: readonly string[] | null;
    readonly model: string | null;
    readonly bootargs: string | null;
    readonly stdout_path: string | null;
    readonly aliases: readonly { readonly name: string; readonly path: string | null }[];
  };
  readonly coverage: {
    readonly status: 'complete';
    readonly examined_nodes: number;
    readonly examined_properties: number;
  };
  readonly limitations: readonly string[];
}

interface DevicetreeProperty {
  readonly name: string;
  readonly offset: number;
  readonly bytes: number;
  readonly hex: string;
  readonly truncated: boolean;
  readonly derived: {
    confidence: 'derived';
    strings: string[] | null;
    cells: number[] | null;
    reg: { address: string | null; size: string | null }[] | null;
  };
}

const align = (n: number): number => Math.ceil(n / 4) * 4;
const hex = (n: number | bigint): string => `0x${n.toString(16)}`;

const malformed = (message: string): never => {
  throw new DevicetreeFormatError('malformed', message);
};

export const parseDevicetree = (bytes: Buffer, artifact: DevicetreeArtifact, input: DevicetreeParseInput): DevicetreeReport => {
  if (bytes.length > input.max_file_bytes) {
    throw new DevicetreeLimitError('max_file_bytes', 'Devicetree exceeds max_file_bytes; raise that caller-selected limit within its schema ceiling or select a smaller blob.');
  }
  if (bytes.length < 28) malformed('Truncated FDT header');
  const u32 = (offset: number): number => bytes.readUInt32BE(offset);
  if (u32(0) !== FDT_MAGIC) throw new DevicetreeFormatError('unsupported', 'Not a flattened devicetree blob');
  const version = u32(20);
  if (version !== 16 && version !== 17) {
    throw new DevicetreeFormatError('unsupported', `FDT version ${version} is unsupported; supported versions are 16 and 17`);
  }
  const headerBytes = version === 17 ? 40 : 36;
  if (bytes.length < headerBytes) malformed('Truncated FDT header');
  const header = {
    magic: u32(0),
    totalsize: u32(4),
    off_dt_struct: u32(8),
    off_dt_strings: u32(12),
    off_mem_rsvmap: u32(16),
    version,
    last_comp_version: u32(24),
    boot_cpuid_phys: u32(28),
    size_dt_strings: u32(32),
    size_dt_struct: version === 17 ? u32(36) : null,
  };
  const end = header.totalsize;
  if (end > bytes.length || end < headerBytes || header.last_comp_version > version || header.last_comp_version > 17) {
    malformed('Invalid FDT header size or compatibility version');
  }

  let decodedBytes = 0;
  const admit = (size: number): void => {
    decodedBytes += size;
    if (decodedBytes > DECODED_BYTE_ALLOWANCE) {
      throw new DevicetreeLimitError('decoded_bytes', 'Devicetree exceeds its fixed 32 MiB decoded representation allowance; select a smaller blob. This allowance has no runtime override.');
    }
  };

  const ranges: { start: number; end: number }[] = [{ start: 0, end: headerBytes }];
  const range = (start: number, size: number): void => {
    if (size < 0 || start < headerBytes || start > end - size) malformed('FDT block outside totalsize');
    const next = { start, end: start + size };
    if (ranges.some((other) => next.start < other.end && other.start < next.end)) malformed('Overlapping FDT blocks');
    ranges.push(next);
  };

  if (header.off_dt_struct % 4 || header.off_mem_rsvmap % 8) malformed('Misaligned FDT block');
  range(header.off_dt_strings, header.size_dt_strings);
  const structEnd = header.size_dt_struct === null ? Math.min(end, ...[header.off_dt_strings, header.off_mem_rsvmap].filter((n) => n > header.off_dt_struct)) : header.off_dt_struct + header.size_dt_struct;
  range(header.off_dt_struct, structEnd - header.off_dt_struct);

  const reservations: { offset: number; address: string; size: string }[] = [];
  let cursor = header.off_mem_rsvmap;
  const reservationEnd = Math.min(end, ...[header.off_dt_struct, header.off_dt_strings].filter((n) => n >= cursor));
  if (ranges.some((r) => cursor >= r.start && cursor < r.end)) malformed('Reservation block overlaps another FDT block');
  for (;;) {
    if (cursor > reservationEnd - 16) malformed('Unterminated or overlapping FDT reservation block');
    const address = bytes.readBigUInt64BE(cursor);
    const size = bytes.readBigUInt64BE(cursor + 8);
    cursor += 16;
    if (address === 0n && size === 0n) break;
    if (reservations.length >= input.max_properties) {
      throw new DevicetreeLimitError('max_properties', 'Devicetree exceeds max_properties; raise that caller-selected limit within its schema ceiling or select a smaller blob.');
    }
    admit(128);
    reservations.push({ offset: cursor - 16, address: hex(address), size: hex(size) });
  }
  range(header.off_mem_rsvmap, cursor - header.off_mem_rsvmap);

  const text = (start: number, stop: number): { value: string; next: number } => {
    const nul = bytes.indexOf(0, start);
    if (nul < start || nul >= stop) return malformed('Unterminated FDT name');
    const raw = bytes.subarray(start, nul);
    if (raw.some((c) => c < 0x20 || c > 0x7e)) malformed('Non-ASCII FDT name');
    admit(raw.length * 2);
    return { value: raw.toString('ascii'), next: nul + 1 };
  };

  const names = new Map<number, string>();
  const propertiesByPath = new Map<string, Map<string, DevicetreeProperty>>();
  const nodes: { path: string; parent: string | null; offset: number; properties: DevicetreeProperty[] }[] = [];
  const stack: { node: (typeof nodes)[number]; children: boolean }[] = [];
  const paths = new Set<string>();
  let properties = 0;
  let finished = false;
  cursor = header.off_dt_struct;
  const need = (n: number): void => {
    if (cursor > structEnd - n) malformed('Truncated FDT structure token or property');
  };

  while (cursor < structEnd) {
    need(4);
    const offset = cursor;
    const token = u32(cursor);
    cursor += 4;
    if (token === FDT_BEGIN_NODE) {
      if (stack.length >= input.max_depth) {
        throw new DevicetreeLimitError('max_depth', 'Devicetree exceeds max_depth; raise that caller-selected limit within its schema ceiling or select a smaller blob.');
      }
      if (nodes.length >= input.max_nodes) {
        throw new DevicetreeLimitError('max_nodes', 'Devicetree exceeds max_nodes; raise that caller-selected limit within its schema ceiling or select a smaller blob.');
      }
      const name = text(cursor, structEnd);
      cursor = align(name.next);
      need(0);
      const parent = stack.at(-1);
      if (name.value.includes('/') || (!parent && (nodes.length > 0 || name.value !== '')) || (parent && !name.value)) {
        malformed('Invalid FDT node name or multiple roots');
      }
      admit((parent?.node.path.length ?? 0) * 4 + name.value.length * 2 + 128);
      const path = parent ? `${parent.node.path === '/' ? '' : parent.node.path}/${name.value}` : '/';
      if (paths.has(path)) malformed('Duplicate FDT node path');
      paths.add(path);
      const node = { path, parent: parent?.node.path ?? null, offset, properties: [] as DevicetreeProperty[] };
      if (parent) parent.children = true;
      propertiesByPath.set(path, new Map());
      nodes.push(node);
      stack.push({ node, children: false });
    } else if (token === FDT_END_NODE) {
      if (!stack.pop()) malformed('Unbalanced FDT_END_NODE');
    } else if (token === FDT_PROP) {
      const owner = stack.at(-1);
      if (!owner || owner.children) return malformed('FDT property outside node or after children');
      need(8);
      const length = u32(cursor);
      const nameoff = u32(cursor + 4);
      cursor += 8;
      need(length);
      if (++properties > input.max_properties) {
        throw new DevicetreeLimitError('max_properties', 'Devicetree exceeds max_properties; raise that caller-selected limit within its schema ceiling or select a smaller blob.');
      }
      if (nameoff >= header.size_dt_strings) malformed('FDT property string offset out of range');
      let name = names.get(nameoff);
      if (name === undefined) {
        name = text(header.off_dt_strings + nameoff, header.off_dt_strings + header.size_dt_strings).value;
        names.set(nameoff, name);
      }
      const propertyMap = propertiesByPath.get(owner.node.path);
      if (!name || propertyMap?.has(name)) malformed('Empty or duplicate FDT property name');
      admit(name.length * 2 + Math.min(length, 256) * 2 + 256);
      const raw = bytes.subarray(cursor, cursor + length);
      const stringProperty = ['compatible', 'model', 'status', 'bootargs', 'stdout-path'].includes(name) || owner.node.path === '/aliases';
      if (stringProperty) admit(raw.length * 4);
      let strings: string[] | null = null;
      if (stringProperty && raw.length > 0 && raw.at(-1) === 0 && raw.subarray(0, -1).every((c) => c === 0 || (c >= 0x20 && c <= 0x7e))) {
        let entries = 0;
        for (const byte of raw) if (byte === 0) entries += 1;
        admit(entries * 32);
        strings = raw.subarray(0, -1).toString('ascii').split('\0');
      }
      const cells = ['phandle', 'linux,phandle', '#address-cells', '#size-cells', 'interrupt-parent', 'remote-endpoint', 'msi-parent'].includes(name) && length === 4 ? [raw.readUInt32BE(0)] : null;
      const property: DevicetreeProperty = {
        name,
        offset: cursor,
        bytes: length,
        hex: raw.subarray(0, 256).toString('hex'),
        truncated: length > 256,
        derived: { confidence: 'derived', strings, cells, reg: null },
      };
      owner.node.properties.push(property);
      propertyMap?.set(name, property);
      cursor = align(cursor + length);
      need(0);
    } else if (token === FDT_END) {
      if (stack.length || nodes.length === 0) malformed('Premature FDT_END');
      if (header.size_dt_struct !== null && cursor !== structEnd) malformed('FDT_END does not terminate the declared structure block');
      finished = true;
      break;
    } else if (token !== FDT_NOP) {
      malformed(`Unknown FDT token ${token}`);
    }
  }
  if (!finished) malformed('Missing FDT_END');

  const byPath = new Map(nodes.map((n) => [n.path, n]));
  const prop = (path: string, name: string): DevicetreeProperty | undefined => propertiesByPath.get(path)?.get(name);
  const singleString = (path: string, name: string): string | null => {
    const s = prop(path, name)?.derived.strings;
    return s?.length === 1 ? (s[0] ?? null) : null;
  };

  const handles = new Map<number, string | null>();
  const limitations: string[] = [
    'Raw property previews are limited to 256 bytes; offsets and lengths identify complete values in the hashed artifact.',
    'Phandle references cover only single-cell interrupt-parent, remote-endpoint and msi-parent; binding-specific arrays and overlays are not resolved.',
  ];

  for (const node of nodes) {
    const canonical = prop(node.path, 'phandle');
    const legacy = prop(node.path, 'linux,phandle');
    const malformedCanonical = canonical !== undefined && canonical.derived.cells === null;
    const declared = [canonical, legacy].flatMap((property) => {
      const handle = property?.derived.cells?.[0];
      return handle === undefined ? [] : [handle];
    });
    if (malformedCanonical) {
      admit(node.path.length * 2 + 256);
      limitations.push(`phandle at ${node.path} is not a single cell; this node's reference identity remains unresolved.`);
    }
    const conflict = declared.length === 2 && declared[0] !== declared[1];
    if (conflict) {
      admit(node.path.length * 2 + 256);
      limitations.push(`phandle at ${node.path} conflicts with linux,phandle (0x${declared[0]?.toString(16)} vs 0x${declared[1]?.toString(16)}); references to either value are unresolved.`);
    }
    const unambiguous = !malformedCanonical && !conflict;
    for (const handle of declared) {
      if (handle !== 0 && handle !== 0xffffffff) {
        const existing = handles.get(handle);
        handles.set(handle, unambiguous && (existing === undefined || existing === node.path) ? node.path : null);
      }
    }
    const reg = prop(node.path, 'reg');
    if (!reg || node.parent === null) continue;
    const count = (name: string, fallback: number): number | undefined => {
      const p = prop(node.parent ?? '', name);
      return p === undefined ? fallback : p.derived.cells?.[0];
    };
    const addresses = count('#address-cells', 2);
    const sizes = count('#size-cells', 1);
    if (addresses === undefined || sizes === undefined || addresses > 4 || sizes > 4 || addresses + sizes === 0 || reg.bytes % ((addresses + sizes) * 4) !== 0) {
      admit(node.path.length * 2 + 256);
      limitations.push(`reg at ${node.path} was not decoded: unsupported or malformed parent cell sizes or tuple length.`);
      continue;
    }
    const readCells = (start: number, n: number): string | null => {
      if (n === 0) return null;
      let value = 0n;
      for (let i = 0; i < n; i += 1) value = (value << 32n) | BigInt(u32(start + i * 4));
      return hex(value);
    };
    admit((reg.bytes / ((addresses + sizes) * 4)) * 160);
    reg.derived.reg = [];
    for (let p = reg.offset; p < reg.offset + reg.bytes; p += (addresses + sizes) * 4) {
      reg.derived.reg.push({
        address: readCells(p, addresses),
        size: readCells(p + addresses * 4, sizes),
      });
    }
  }

  const references: DevicetreeReport['references'][number][] = [];
  for (const node of nodes) {
    for (const property of node.properties) {
      const phandle = property.derived.cells?.[0];
      if (['interrupt-parent', 'remote-endpoint', 'msi-parent'].includes(property.name) && phandle !== undefined) {
        const target = handles.get(phandle) ?? null;
        admit(256 + (node.path.length + property.name.length + (target?.length ?? 0)) * 2);
        references.push({
          source: node.path,
          property: property.name,
          phandle,
          target,
          confidence: 'derived',
        });
      }
    }
  }

  return {
    artifact,
    header,
    reservations,
    nodes,
    references,
    summary: {
      confidence: 'derived',
      compatible: prop('/', 'compatible')?.derived.strings ?? null,
      model: singleString('/', 'model'),
      bootargs: singleString('/chosen', 'bootargs'),
      stdout_path: singleString('/chosen', 'stdout-path'),
      aliases: (byPath.get('/aliases')?.properties ?? []).map((p) => ({
        name: p.name,
        path: singleString('/aliases', p.name),
      })),
    },
    coverage: {
      status: 'complete',
      examined_nodes: nodes.length,
      examined_properties: properties,
    },
    limitations,
  };
};

export interface InspectDevicetreeParams {
  readonly path: string;
  readonly max_file_bytes?: number;
  readonly max_nodes?: number;
  readonly max_properties?: number;
  readonly max_depth?: number;
}

export const inspectDevicetreeFromPath = async (params: InspectDevicetreeParams, options: { readonly cwd?: string } = {}): Promise<{ readonly report: DevicetreeReport; readonly path: string; readonly resolvedPath: string }> => {
  if (typeof params.path !== 'string' || params.path.length === 0) {
    throw invalidRequest('Invalid arguments for tool inspect_devicetree: path: Invalid input: expected string, received undefined', {
      parameter: 'path',
    });
  }
  if (!isAbsolute(params.path)) {
    throw invalidRequest('Expected an absolute filesystem path on this host.', {
      operation: 'inspect_devicetree',
      issues: [{ path: ['path'], reason: 'invalid_format', message: 'Expected an absolute filesystem path on this host.' }],
    });
  }
  const resolvedPath = resolve(params.path);
  const maxFileBytes = params.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES;
  const facts = await stat(resolvedPath).catch((error: NodeJS.ErrnoException) => {
    throw unsupportedTarget(`Cannot read device-tree blob: ${error.message}`, { path: params.path, reason: 'unreadable' });
  });
  if (!facts.isFile()) {
    throw unsupportedTarget('inspect_devicetree accepts a regular file.', { path: params.path, reason: 'not a regular file' });
  }
  if (facts.size > maxFileBytes) {
    throw new DevicetreeLimitError('max_file_bytes', 'Devicetree exceeds max_file_bytes; raise that caller-selected limit within its schema ceiling or select a smaller blob.');
  }
  const bytes = await readFile(resolvedPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const report = parseDevicetree(
    bytes,
    { path: resolvedPath, sha256, bytes: bytes.length },
    {
      max_file_bytes: maxFileBytes,
      max_nodes: params.max_nodes ?? DEFAULT_MAX_NODES,
      max_properties: params.max_properties ?? DEFAULT_MAX_PROPERTIES,
      max_depth: params.max_depth ?? DEFAULT_MAX_DEPTH,
    },
  );
  return { report, path: params.path, resolvedPath };
};
