import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_OBJECTS = 16_384;
export const DEFAULT_MAX_DEPTH = 64;
export const DEFAULT_MAX_STRING_BYTES = 1_048_576;

export const PYC_LIMITATIONS = [
  'Bytecode is retained as length and SHA-256 only; this workflow does not decompile, disassemble, or recover source.',
  'The selected file is not executed and CPython is not invoked.',
  'source_mtime and source_size are header fields; they do not prove a matching .py is present.',
  'python_version is the pinned CPython magic table for this header, not a runtime interpreter.',
] as const;

const MAGIC_TO_VERSION: Record<number, string> = {
  218958387: '3.7',
  218958402: '3.8',
  218958421: '3.9',
  218958447: '3.10',
  168627358: '3.11',
  168627567: '3.12',
  168627699: '3.13',
  168627755: '3.14',
};

const FLAG_REF = 0x80;

export interface PycInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly header: {
    readonly magic: number;
    readonly python_version: string;
    readonly code_layout: string;
    readonly flags: number;
    readonly hash_based: boolean;
    readonly check_source: boolean;
    readonly source_hash_hex: string | null;
    readonly source_mtime: number | null;
    readonly source_size: number | null;
  };
  readonly code_objects: readonly PycCodeObject[];
  readonly coverage: {
    readonly status: 'complete';
    readonly objects: number;
    readonly code_objects: number;
    readonly marshal_bytes: number;
    readonly marshal_depth: number;
  };
  readonly limitations: readonly string[];
}

export type PycConst =
  | { readonly kind: 'code'; readonly name: string; readonly firstlineno: number }
  | { readonly kind: 'str'; readonly bytes: number; readonly truncated: boolean; readonly value: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'long' }
  | { readonly kind: 'float'; readonly value: number }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'int'; readonly value: number }
  | { readonly kind: 'other' };

export interface PycCodeObject {
  readonly name: string;
  readonly qualname: string | null;
  readonly filename: string;
  readonly firstlineno: number;
  readonly argcount: number;
  readonly posonlyargcount: number;
  readonly kwonlyargcount: number;
  readonly nlocals: number | null;
  readonly stacksize: number;
  readonly flags: number;
  readonly names: readonly string[];
  readonly varnames: readonly string[] | null;
  readonly freevars: readonly string[] | null;
  readonly cellvars: readonly string[] | null;
  readonly localsplusnames: readonly string[] | null;
  readonly localspluskinds_hex: string | null;
  readonly bytecode: { readonly bytes: number; readonly sha256: string };
  readonly consts: readonly PycConst[];
  readonly nested_code: readonly number[];
}

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_python_pyc',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

type CodeNode = Omit<PycCodeObject, 'nested_code'> & { nested_code: readonly number[]; nested: CodeNode[] };

class MarshalReader {
  offset = 0;
  depth = 0;
  objects = 0;
  maxDepthSeen = 0;
  readonly refs: unknown[] = [];
  constructor(
    readonly buffer: Buffer,
    readonly maxObjects: number,
    readonly maxDepth: number,
    readonly maxStringBytes: number,
    readonly modernCode: boolean,
  ) {}

  private need(n: number): void {
    if (this.offset + n > this.buffer.length) throw new Error('marshal stream truncated');
  }

  private bumpObject(): void {
    this.objects += 1;
    if (this.objects > this.maxObjects) throw new Error(`marshal exceeds max_objects=${this.maxObjects}`);
  }

  private readRawI32(): number {
    this.need(4);
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  read(): unknown {
    this.bumpObject();
    this.depth += 1;
    this.maxDepthSeen = Math.max(this.maxDepthSeen, this.depth);
    if (this.depth > this.maxDepth) throw new Error(`marshal exceeds max_depth=${this.maxDepth}`);
    try {
      this.need(1);
      const flag = this.buffer[this.offset]!;
      this.offset += 1;
      const type = flag & 0x7f;
      const withRef = (flag & FLAG_REF) !== 0;
      let refIndex = -1;
      if (withRef && type !== 'r'.charCodeAt(0)) {
        refIndex = this.refs.length;
        this.refs.push(null);
      }
      const result = this.readType(type);
      if (refIndex >= 0) this.refs[refIndex] = result;
      return result;
    } finally {
      this.depth -= 1;
    }
  }

  private readType(type: number): unknown {
    switch (type) {
      case '0'.charCodeAt(0):
      case 'N'.charCodeAt(0):
        return null;
      case 'F'.charCodeAt(0):
        return false;
      case 'T'.charCodeAt(0):
        return true;
      case 'i'.charCodeAt(0):
        return this.readRawI32();
      case 'l'.charCodeAt(0): {
        const digits = this.readRawI32();
        const count = Math.abs(digits);
        this.need(count * 2);
        this.offset += count * 2;
        return { kind: 'long' };
      }
      case 'g'.charCodeAt(0): {
        this.need(8);
        const value = this.buffer.readDoubleLE(this.offset);
        this.offset += 8;
        return value;
      }
      case 's'.charCodeAt(0):
      case 't'.charCodeAt(0):
      case 'a'.charCodeAt(0):
      case 'A'.charCodeAt(0):
      case 'u'.charCodeAt(0): {
        const size = this.readRawI32();
        if (size < 0 || size > this.maxStringBytes) throw new Error('string length out of range');
        this.need(size);
        const slice = this.buffer.subarray(this.offset, this.offset + size);
        this.offset += size;
        return type === 's'.charCodeAt(0) ? Buffer.from(slice) : slice.toString('utf8');
      }
      case 'z'.charCodeAt(0):
      case 'Z'.charCodeAt(0): {
        this.need(1);
        const size = this.buffer[this.offset]!;
        this.offset += 1;
        if (size > this.maxStringBytes) throw new Error('string length out of range');
        this.need(size);
        const slice = this.buffer.subarray(this.offset, this.offset + size);
        this.offset += size;
        return slice.toString('utf8');
      }
      case ')'.charCodeAt(0): {
        this.need(1);
        const size = this.buffer[this.offset]!;
        this.offset += 1;
        const values: unknown[] = [];
        for (let index = 0; index < size; index += 1) values.push(this.read());
        return values;
      }
      case '('.charCodeAt(0):
      case '['.charCodeAt(0): {
        const size = this.readRawI32();
        if (size < 0 || size > this.maxObjects) throw new Error('sequence size out of range');
        const values: unknown[] = [];
        for (let index = 0; index < size; index += 1) values.push(this.read());
        return values;
      }
      case '{'.charCodeAt(0): {
        const out: Record<string, unknown> = {};
        while (true) {
          const key = this.read();
          if (key === null) break;
          out[String(key)] = this.read();
        }
        return out;
      }
      case 'c'.charCodeAt(0):
        return this.readCode();
      case 'r'.charCodeAt(0): {
        const index = this.readRawI32();
        if (index < 0 || index >= this.refs.length) throw new Error('marshal ref out of range');
        return this.refs[index];
      }
      default:
        throw new Error(`unsupported marshal type ${type} (${type >= 32 && type < 127 ? String.fromCharCode(type) : 'bin'})`);
    }
  }

  private readCode(): CodeNode {
    let argcount: number;
    let posonlyargcount: number;
    let kwonlyargcount: number;
    let stacksize: number;
    let flags: number;
    let nlocalsLegacy = 0;

    if (this.modernCode) {
      argcount = this.readRawI32();
      posonlyargcount = this.readRawI32();
      kwonlyargcount = this.readRawI32();
      stacksize = this.readRawI32();
      flags = this.readRawI32();
    } else {
      argcount = this.read() as number;
      posonlyargcount = this.read() as number;
      kwonlyargcount = this.read() as number;
      nlocalsLegacy = this.read() as number;
      stacksize = this.read() as number;
      flags = this.read() as number;
    }

    const code = this.read();
    const consts = this.read();
    const names = this.read();

    let localsplusnames: unknown = null;
    let localspluskinds: unknown = null;
    let varnames: string[] = [];
    let freevars: string[] = [];
    let cellvars: string[] = [];
    if (this.modernCode) {
      localsplusnames = this.read();
      localspluskinds = this.read();
    } else {
      varnames = asStringArray(this.read());
      freevars = asStringArray(this.read());
      cellvars = asStringArray(this.read());
    }

    const filename = this.read();
    const name = this.read();
    const qualname = this.modernCode ? this.read() : null;
    const firstlineno = this.modernCode ? this.readRawI32() : (this.read() as number);
    this.read();
    if (this.modernCode) this.read();

    const bytecodeBuffer = Buffer.isBuffer(code) ? code : Buffer.from(typeof code === 'string' ? code : []);
    const nested: CodeNode[] = [];
    const constSummaries: PycConst[] = [];
    if (Array.isArray(consts)) {
      for (const entry of consts) {
        if (isCodeNode(entry)) {
          nested.push(entry);
          constSummaries.push({ kind: 'code', name: entry.name, firstlineno: entry.firstlineno });
        } else if (entry === null) constSummaries.push({ kind: 'none' });
        else if (typeof entry === 'string') {
          const utf8 = Buffer.byteLength(entry, 'utf8');
          const truncated = utf8 > this.maxStringBytes;
          const value = truncated ? entry.slice(0, Math.max(0, this.maxStringBytes)) : entry;
          constSummaries.push({ kind: 'str', bytes: truncated ? this.maxStringBytes : utf8, truncated, value });
        } else if (typeof entry === 'boolean') constSummaries.push({ kind: 'bool', value: entry });
        else if (typeof entry === 'number') {
          constSummaries.push(Number.isInteger(entry) ? { kind: 'int', value: entry } : { kind: 'float', value: entry });
        } else if (typeof entry === 'object' && entry !== null && 'kind' in entry && (entry as { kind: string }).kind === 'long') {
          constSummaries.push({ kind: 'long' });
        } else constSummaries.push({ kind: 'other' });
      }
    }

    const localsNames = this.modernCode ? asStringArray(localsplusnames) : varnames;
    return {
      name: typeof name === 'string' ? name : '<module>',
      qualname: typeof qualname === 'string' ? qualname : null,
      filename: typeof filename === 'string' ? filename : '',
      firstlineno,
      argcount: typeof argcount === 'number' ? argcount : 0,
      posonlyargcount: typeof posonlyargcount === 'number' ? posonlyargcount : 0,
      kwonlyargcount: typeof kwonlyargcount === 'number' ? kwonlyargcount : 0,
      nlocals: this.modernCode ? null : nlocalsLegacy,
      stacksize: typeof stacksize === 'number' ? stacksize : 0,
      flags: typeof flags === 'number' ? flags : 0,
      names: asStringArray(names),
      varnames: this.modernCode ? null : varnames,
      freevars: this.modernCode ? null : freevars,
      cellvars: this.modernCode ? null : cellvars,
      localsplusnames: this.modernCode ? localsNames : null,
      localspluskinds_hex: Buffer.isBuffer(localspluskinds) ? localspluskinds.toString('hex') : null,
      bytecode: { bytes: bytecodeBuffer.length, sha256: sha256(bytecodeBuffer) },
      consts: constSummaries,
      nested_code: [],
      nested,
    };
  }
}

const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

const isCodeNode = (value: unknown): value is CodeNode => typeof value === 'object' && value !== null && 'bytecode' in value && 'name' in value && 'nested' in value;

const flattenCodeTree = (root: CodeNode): PycCodeObject[] => {
  const out: PycCodeObject[] = [];
  const visit = (node: CodeNode): number => {
    const index = out.length;
    out.push(null as unknown as PycCodeObject);
    const nestedIndexes = node.nested.map((child) => visit(child));
    const { nested: _nested, ...rest } = node;
    out[index] = { ...rest, nested_code: nestedIndexes };
    return index;
  };
  visit(root);
  return out;
};

export interface PycOptions {
  readonly maxFileBytes?: number;
  readonly maxObjects?: number;
  readonly maxDepth?: number;
  readonly maxStringBytes?: number;
  readonly cwd?: string;
}

export const inspectPythonPycFromPath = async (path: string, options: PycOptions = {}): Promise<{ record: PycInspection; path: string; resolvedPath: string }> => {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxObjects = options.maxObjects ?? DEFAULT_MAX_OBJECTS;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxStringBytes = options.maxStringBytes ?? DEFAULT_MAX_STRING_BYTES;
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }
  if (bytes.length < 16) throw inputError(path, 'invalid_format', 'pyc header must be 16 bytes.');
  if (bytes.length > maxFileBytes) throw inputError(path, 'invalid_value', `file exceeds max_file_bytes=${maxFileBytes}`);

  const magicWord = bytes.readUInt32LE(0);
  const pythonVersion = MAGIC_TO_VERSION[magicWord];
  if (pythonVersion === undefined) throw inputError(path, 'invalid_format', `unsupported pyc magic 0x${magicWord.toString(16)}.`);
  const flags = bytes.readUInt32LE(4);
  const hashBased = (flags & 0x1) !== 0;
  const checkSource = (flags & 0x2) !== 0;
  const modernCode = pythonVersion >= '3.11';
  const magic = bytes.readUInt16LE(0);
  const header = {
    magic,
    python_version: pythonVersion,
    code_layout: modernCode ? 'py311' : 'legacy',
    flags,
    hash_based: hashBased,
    check_source: checkSource,
    source_hash_hex: hashBased ? bytes.subarray(8, 16).toString('hex') : null,
    source_mtime: hashBased ? null : bytes.readUInt32LE(8),
    source_size: hashBased ? null : bytes.readUInt32LE(12),
  };

  const reader = new MarshalReader(bytes.subarray(16), maxObjects, maxDepth, maxStringBytes, modernCode);
  let root: unknown;
  try {
    root = reader.read();
  } catch (error) {
    throw inputError(path, 'invalid_format', error instanceof Error ? error.message : 'marshal decode failed');
  }
  if (!isCodeNode(root)) throw inputError(path, 'invalid_format', 'top-level marshal object is not a code object.');
  const codeObjects = flattenCodeTree(root);

  return {
    record: {
      artifact: { path: resolvedPath, sha256: sha256(bytes), bytes: bytes.length },
      header,
      code_objects: codeObjects,
      coverage: {
        status: 'complete',
        objects: reader.objects,
        code_objects: codeObjects.length,
        marshal_bytes: bytes.length - 16,
        marshal_depth: Math.max(0, reader.maxDepthSeen - 1),
      },
      limitations: [...PYC_LIMITATIONS],
    },
    path,
    resolvedPath,
  };
};
