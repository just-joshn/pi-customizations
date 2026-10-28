
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_CHUNKS = 64;
export const DEFAULT_MAX_ATOMS = 4096;

export const BEAM_LIMITATIONS = [
  'This workflow does not execute BEAM bytecode, inflate LitT literals, or decode Attr/CInf external-term payloads.',
  'Atom names are structural table entries; they do not authenticate the originating compiler or module checksum.',
] as const;

export interface BeamInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly form: { readonly location: { readonly offset: number; readonly bytes: number }; readonly size: number };
  readonly chunks: readonly {
    readonly index: number;
    readonly name: string;
    readonly location: { readonly offset: number; readonly bytes: number };
    readonly payload: {
      readonly location: { readonly offset: number; readonly bytes: number };
      readonly bytes: number;
      readonly sha256: string;
    };
  }[];
  readonly atoms: readonly { readonly index: number; readonly name: string }[] | null;
  readonly atom_encoding: 'latin1' | 'utf8' | null;
  readonly exports: readonly {
    readonly function: string | null;
    readonly arity: number;
    readonly label: number;
    readonly function_index: number;
  }[] | null;
  readonly imports: readonly {
    readonly module: string | null;
    readonly function: string | null;
    readonly arity: number;
    readonly module_index: number;
    readonly function_index: number;
  }[] | null;
  readonly lambdas: readonly { readonly function: string | null; readonly arity: number; readonly atom_index: number }[] | null;
  readonly code: {
    readonly instruction_set: number;
    readonly opcode_max: number;
    readonly labels: number;
    readonly functions: number;
    readonly extra_header_bytes: number;
    readonly instructions: { readonly offset: number; readonly bytes: number };
  } | null;
  readonly module: string | null;
  readonly coverage: { readonly status: 'complete'; readonly examined_chunks: number; readonly atoms: number };
  readonly limitations: readonly string[];
}

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_erlang_beam',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const resolveAtom = (atoms: BeamInspection['atoms'], index: number): string | null => {
  if (atoms === null) return null;
  const entry = atoms.find((atom) => atom.index === index);
  return entry?.name ?? null;
};

const decodeAtoms = (
  payload: Buffer,
  encoding: 'latin1' | 'utf8',
  maxAtoms: number,
): { atoms: NonNullable<BeamInspection['atoms']>; encoding: 'latin1' | 'utf8' } => {
  if (payload.length < 4) throw new Error('atom table truncated');
  const count = payload.readUInt32BE(0);
  if (count > maxAtoms) throw new Error(`atom table exceeds max_atoms=${maxAtoms}`);
  const atoms: { index: number; name: string }[] = [];
  let offset = 4;
  for (let index = 1; index <= count; index += 1) {
    if (offset >= payload.length) throw new Error('atom table truncated');
    const length = payload[offset]!;
    offset += 1;
    if (offset + length > payload.length) throw new Error('atom table truncated');
    atoms.push({ index, name: payload.subarray(offset, offset + length).toString(encoding) });
    offset += length;
  }
  return { atoms, encoding };
};

export interface BeamOptions {
  readonly maxFileBytes?: number;
  readonly maxChunks?: number;
  readonly maxAtoms?: number;
  readonly cwd?: string;
}

export const inspectErlangBeamFromPath = async (
  path: string,
  options: BeamOptions = {},
): Promise<{ record: BeamInspection; path: string; resolvedPath: string }> => {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const maxAtoms = options.maxAtoms ?? DEFAULT_MAX_ATOMS;
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 16) throw inputError(path, 'invalid_value', 'max_file_bytes must be an integer >= 16.');
  if (!Number.isInteger(maxChunks) || maxChunks < 1) throw inputError(path, 'invalid_value', 'max_chunks must be a positive integer.');
  if (!Number.isInteger(maxAtoms) || maxAtoms < 1) throw inputError(path, 'invalid_value', 'max_atoms must be a positive integer.');

  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }
  if (bytes.length > maxFileBytes) throw inputError(path, 'invalid_value', `file exceeds max_file_bytes=${maxFileBytes}.`);
  if (bytes.length < 12 || bytes.subarray(0, 4).toString('ascii') !== 'FOR1' || bytes.subarray(8, 12).toString('ascii') !== 'BEAM') {
    throw inputError(path, 'invalid_format', 'the file is not a BEAM IFF container.');
  }
  const formSize = bytes.readUInt32BE(4);
  if (8 + formSize > bytes.length) throw inputError(path, 'invalid_format', 'IFF form size is truncated.');

  const chunks: BeamInspection['chunks'][number][] = [];
  let offset = 12;
  while (offset + 8 <= 8 + formSize && offset + 8 <= bytes.length) {
    if (chunks.length >= maxChunks) throw inputError(path, 'invalid_value', `chunk count exceeds max_chunks=${maxChunks}.`);
    const name = bytes.subarray(offset, offset + 4).toString('ascii');
    const size = bytes.readUInt32BE(offset + 4);
    const payloadOffset = offset + 8;
    if (payloadOffset + size > bytes.length) throw inputError(path, 'invalid_format', `chunk ${name} is truncated.`);
    const payload = bytes.subarray(payloadOffset, payloadOffset + size);
    const pad = (4 - (size % 4)) % 4;
    chunks.push({
      index: chunks.length,
      name,
      location: { offset, bytes: 8 + size + pad },
      payload: {
        location: { offset: payloadOffset, bytes: size },
        bytes: size,
        sha256: sha256(payload),
      },
    });
    offset = payloadOffset + size + pad;
  }

  const atomChunk = chunks.find((chunk) => chunk.name === 'AtU8' || chunk.name === 'Atom');
  let atoms: BeamInspection['atoms'] = null;
  let atomEncoding: BeamInspection['atom_encoding'] = null;
  if (atomChunk !== undefined) {
    try {
      const decoded = decodeAtoms(
        bytes.subarray(atomChunk.payload.location.offset, atomChunk.payload.location.offset + atomChunk.payload.location.bytes),
        atomChunk.name === 'AtU8' ? 'utf8' : 'latin1',
        maxAtoms,
      );
      atoms = decoded.atoms;
      atomEncoding = decoded.encoding;
    } catch (error) {
      throw inputError(path, 'invalid_format', error instanceof Error ? error.message : 'atom table decode failed');
    }
  }

  const exportChunk = chunks.find((chunk) => chunk.name === 'ExpT');
  let exports: BeamInspection['exports'] = null;
  if (exportChunk !== undefined) {
    const payload = bytes.subarray(
      exportChunk.payload.location.offset,
      exportChunk.payload.location.offset + exportChunk.payload.location.bytes,
    );
    if (payload.length >= 4) {
      const count = payload.readUInt32BE(0);
      const rows: NonNullable<BeamInspection['exports']>[number][] = [];
      for (let index = 0; index < count; index += 1) {
        const at = 4 + index * 12;
        if (at + 12 > payload.length) throw inputError(path, 'invalid_format', 'export table truncated');
        const functionIndex = payload.readUInt32BE(at);
        rows.push({
          function_index: functionIndex,
          function: resolveAtom(atoms, functionIndex),
          arity: payload.readUInt32BE(at + 4),
          label: payload.readUInt32BE(at + 8),
        });
      }
      exports = rows;
    }
  }

  const importChunk = chunks.find((chunk) => chunk.name === 'ImpT');
  let imports: BeamInspection['imports'] = null;
  if (importChunk !== undefined) {
    const payload = bytes.subarray(
      importChunk.payload.location.offset,
      importChunk.payload.location.offset + importChunk.payload.location.bytes,
    );
    if (payload.length >= 4) {
      const count = payload.readUInt32BE(0);
      const rows: NonNullable<BeamInspection['imports']>[number][] = [];
      for (let index = 0; index < count; index += 1) {
        const at = 4 + index * 12;
        if (at + 12 > payload.length) throw inputError(path, 'invalid_format', 'import table truncated');
        const moduleIndex = payload.readUInt32BE(at);
        const functionIndex = payload.readUInt32BE(at + 4);
        rows.push({
          module_index: moduleIndex,
          module: resolveAtom(atoms, moduleIndex),
          function_index: functionIndex,
          function: resolveAtom(atoms, functionIndex),
          arity: payload.readUInt32BE(at + 8),
        });
      }
      imports = rows;
    }
  }

  const lambdaChunk = chunks.find((chunk) => chunk.name === 'FunT');
  let lambdas: BeamInspection['lambdas'] = null;
  if (lambdaChunk !== undefined) {
    const payload = bytes.subarray(
      lambdaChunk.payload.location.offset,
      lambdaChunk.payload.location.offset + lambdaChunk.payload.location.bytes,
    );
    if (payload.length >= 4) {
      const count = payload.readUInt32BE(0);
      const rows: NonNullable<BeamInspection['lambdas']>[number][] = [];
      // FunT entries are 24 bytes historically (atom, arity, label, index, num_free, old_uniq) — keep atom/arity only.
      const stride = payload.length >= 4 + count * 24 ? 24 : 12;
      for (let index = 0; index < count; index += 1) {
        const at = 4 + index * stride;
        if (at + 8 > payload.length) throw inputError(path, 'invalid_format', 'lambda table truncated');
        const atomIndex = payload.readUInt32BE(at);
        rows.push({ function: resolveAtom(atoms, atomIndex), arity: payload.readUInt32BE(at + 4), atom_index: atomIndex });
      }
      lambdas = rows;
    }
  }

  const codeChunk = chunks.find((chunk) => chunk.name === 'Code');
  let code: BeamInspection['code'] = null;
  if (codeChunk !== undefined && codeChunk.payload.location.bytes >= 20) {
    const payloadOffset = codeChunk.payload.location.offset;
    const payloadBytes = codeChunk.payload.location.bytes;
    const payload = bytes.subarray(payloadOffset, payloadOffset + payloadBytes);
    const infoBytes = payload.readUInt32BE(0);
    const instructionsOffset = payloadOffset + 4 + infoBytes;
    const instructionsBytes = Math.max(0, payloadBytes - 4 - infoBytes);
    code = {
      instruction_set: payload.readUInt32BE(4),
      opcode_max: payload.readUInt32BE(8),
      labels: payload.readUInt32BE(12),
      functions: payload.readUInt32BE(16),
      extra_header_bytes: Math.max(0, infoBytes - 16),
      instructions: { offset: instructionsOffset, bytes: instructionsBytes },
    };
  }

  return {
    record: {
      artifact: { path, sha256: sha256(bytes), bytes: bytes.length },
      form: { location: { offset: 0, bytes: 8 + formSize }, size: formSize },
      chunks,
      atoms,
      atom_encoding: atomEncoding,
      exports,
      imports,
      lambdas,
      code,
      module: atoms?.find((atom) => atom.index === 1)?.name ?? null,
      coverage: { status: 'complete', examined_chunks: chunks.length, atoms: atoms?.length ?? 0 },
      limitations: [...BEAM_LIMITATIONS],
    },
    path,
    resolvedPath,
  };
};
