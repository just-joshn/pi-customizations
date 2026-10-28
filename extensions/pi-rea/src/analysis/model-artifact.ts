import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export const MODEL_HEADER_ENVELOPE_LIMITATION = 'Full-file identity is unknown in header-only mode; normalized_result.artifact records a scoped header SHA-256 and exact source path/extent.';

export const MODEL_RESULT_LIMITATIONS = [
  'Facts are file declarations; model behavior, weight values and compatibility with an inference runtime were not verified.',
  'Header SHA-256 commits only to the recorded prefix; file size is a separate observation. Different weights may share these declarations.',
  'Full-file SHA-256 is unknown because tensor data was not read.',
] as const;

const GGUF_TYPES: Record<number, { name: string; bytes: number | null }> = {
  0: { name: 'F32', bytes: 4 },
  1: { name: 'F16', bytes: 2 },
  2: { name: 'Q4_0', bytes: null },
  3: { name: 'Q4_1', bytes: null },
  8: { name: 'Q8_0', bytes: null },
  9: { name: 'Q8_1', bytes: null },
  10: { name: 'Q2_K', bytes: null },
  11: { name: 'Q3_K', bytes: null },
  12: { name: 'Q4_K', bytes: null },
  13: { name: 'Q5_K', bytes: null },
  14: { name: 'Q6_K', bytes: null },
  15: { name: 'Q8_K', bytes: null },
  16: { name: 'I8', bytes: 1 },
  17: { name: 'I16', bytes: 2 },
  18: { name: 'I32', bytes: 4 },
  19: { name: 'I64', bytes: 8 },
  20: { name: 'F64', bytes: 8 },
  24: { name: 'BF16', bytes: 2 },
};

const SAFETENSORS_DTYPE_BYTES: Record<string, number> = {
  BOOL: 1,
  U8: 1,
  I8: 1,
  F8_E5M2: 1,
  F8_E4M3: 1,
  I16: 2,
  U16: 2,
  F16: 2,
  BF16: 2,
  I32: 4,
  U32: 4,
  F32: 4,
  F64: 8,
  I64: 8,
  U64: 8,
};

export interface ModelArtifactInspection {
  readonly artifact: {
    readonly path: string;
    readonly file_size: number;
    readonly header_sha256: string;
    readonly header_length: number;
    readonly sha256: string | null;
    readonly bytes_read: number;
    readonly read_scope: 'header' | 'full';
  };
  readonly format: 'gguf' | 'safetensors';
  readonly version: number | null;
  readonly byte_order: 'little' | 'big';
  readonly alignment: number | null;
  readonly tensor_data_offset: number;
  readonly metadata: readonly ModelMetadataEntry[];
  readonly tensors: readonly ModelTensorEntry[];
  readonly totals: {
    readonly confidence: 'observed' | 'derived' | 'unknown';
    readonly parameter_count: string | null;
    readonly tensor_bytes: number | null;
    readonly by_type: readonly {
      readonly type: string;
      readonly tensors: number;
      readonly parameter_count: string | null;
      readonly bytes: number | null;
    }[];
  };
  readonly coverage: {
    readonly header: 'complete';
    readonly tensor_data: 'not-interpreted' | 'hashed';
    readonly array_values: 'complete' | 'preview';
    readonly tensor_ranges: 'complete' | 'declared';
    readonly storage_sizes: 'complete' | 'derived' | 'unknown';
  };
  readonly limitations: readonly string[];
}

export interface ModelMetadataEntry {
  readonly index: number;
  readonly key: string;
  readonly type: string;
  readonly value: unknown;
  readonly element_type: string | null;
  readonly element_count: number | null;
  readonly preview_complete: boolean;
  readonly source_offset: number;
  readonly source_length: number;
  readonly json_pointer: string | null;
}

export interface ModelTensorEntry {
  readonly index: number;
  readonly name: string;
  readonly type: string;
  readonly type_id: number | null;
  readonly shape: readonly string[];
  readonly data_offset: number;
  readonly file_offset: number;
  readonly byte_length: number | null;
  readonly parameter_count: string;
  readonly byte_length_state: 'derived' | 'declared' | 'unknown';
  readonly storage_validation: 'consistent' | 'unknown';
  readonly source_offset: number;
  readonly source_length: number;
  readonly json_pointer: string | null;
}

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_model_artifact',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const firstByte = (bytes: Buffer): number => {
  const value = bytes[0];
  if (value === undefined) throw new Error('truncated primitive preview');
  return value;
};

const product = (shape: readonly number[]): bigint => shape.reduce((acc, dim) => acc * BigInt(dim), 1n);

const alignUp = (value: number, alignment: number): number => (alignment <= 1 ? value : (value + alignment - 1) & ~(alignment - 1));

class Reader {
  offset = 0;
  readonly buffer: Buffer;
  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }
  need(n: number, label: string): void {
    if (this.offset + n > this.buffer.length) throw new Error(`truncated at ${label}`);
  }
  u32(): number {
    this.need(4, 'u32');
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }
  u64(): bigint {
    this.need(8, 'u64');
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }
  f32(): number {
    this.need(4, 'f32');
    const value = this.buffer.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }
  f64(): number {
    this.need(8, 'f64');
    const value = this.buffer.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }
  i32(): number {
    this.need(4, 'i32');
    const value = this.buffer.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }
  i64(): bigint {
    this.need(8, 'i64');
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }
  take(n: number): Buffer {
    this.need(n, 'bytes');
    const slice = this.buffer.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }
  string(): string {
    const length = Number(this.u64());
    if (!Number.isSafeInteger(length)) throw new Error('string length exceeds exact host offset precision');
    if (length < 0 || length > 1_048_576) throw new Error('string length out of range');
    return this.take(length).toString('utf8');
  }
}

const readGgufValue = (reader: Reader, type: number): { typeName: string; value: unknown; elementType: string | null; elementCount: number | null; previewComplete: boolean } => {
  switch (type) {
    case 0:
      return { typeName: 'UINT8', value: firstByte(reader.take(1)), elementType: null, elementCount: null, previewComplete: true };
    case 1:
      return { typeName: 'INT8', value: reader.take(1).readInt8(0), elementType: null, elementCount: null, previewComplete: true };
    case 2:
      return { typeName: 'UINT16', value: reader.take(2).readUInt16LE(0), elementType: null, elementCount: null, previewComplete: true };
    case 3:
      return { typeName: 'INT16', value: reader.take(2).readInt16LE(0), elementType: null, elementCount: null, previewComplete: true };
    case 4:
      return { typeName: 'UINT32', value: reader.u32(), elementType: null, elementCount: null, previewComplete: true };
    case 5:
      return { typeName: 'INT32', value: reader.i32(), elementType: null, elementCount: null, previewComplete: true };
    case 6:
      return { typeName: 'FLOAT32', value: reader.f32(), elementType: null, elementCount: null, previewComplete: true };
    case 7:
      return { typeName: 'BOOL', value: firstByte(reader.take(1)) !== 0, elementType: null, elementCount: null, previewComplete: true };
    case 8:
      return { typeName: 'STRING', value: reader.string(), elementType: null, elementCount: null, previewComplete: true };
    case 9: {
      const elementType = reader.u32();
      const count = Number(reader.u64());
      if (!Number.isSafeInteger(count)) throw new Error('array count exceeds exact host offset precision');
      if (count < 0 || count > 1_048_576) throw new Error('array count out of range');
      const previewLimit = Math.min(count, 8);
      const values: unknown[] = [];
      for (let index = 0; index < count; index += 1) {
        const entry = readGgufValue(reader, elementType);
        if (index < previewLimit) values.push(entry.value);
      }
      return {
        typeName: 'ARRAY',
        value: values,
        elementType: readGgufValueTypeName(elementType),
        elementCount: count,
        previewComplete: count <= previewLimit,
      };
    }
    case 10:
      return { typeName: 'UINT64', value: reader.u64().toString(), elementType: null, elementCount: null, previewComplete: true };
    case 11:
      return { typeName: 'INT64', value: reader.i64().toString(), elementType: null, elementCount: null, previewComplete: true };
    case 12:
      return { typeName: 'FLOAT64', value: reader.f64(), elementType: null, elementCount: null, previewComplete: true };
    default:
      throw new Error(`unsupported GGUF metadata type ${type}`);
  }
};

const readGgufValueTypeName = (type: number): string => {
  const names = ['UINT8', 'INT8', 'UINT16', 'INT16', 'UINT32', 'INT32', 'FLOAT32', 'BOOL', 'STRING', 'ARRAY', 'UINT64', 'INT64', 'FLOAT64'];
  return names[type] ?? `TYPE_${type}`;
};

const parseGguf = (bytes: Buffer, path: string, hashMode: 'header' | 'full'): ModelArtifactInspection => {
  if (bytes.length < 24 || bytes.subarray(0, 4).toString('ascii') !== 'GGUF') {
    throw inputError(path, 'invalid_format', 'the file is not a GGUF container.');
  }
  const reader = new Reader(bytes);
  reader.offset = 4;
  const version = reader.u32();
  if (version !== 2 && version !== 3) throw inputError(path, 'invalid_format', `unsupported GGUF version ${version}.`);
  const tensorCount = Number(reader.u64());
  const metadataCount = Number(reader.u64());
  if (![tensorCount, metadataCount].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw inputError(path, 'invalid_format', 'GGUF header length/count exceeds exact host offset precision.');
  }
  if (![tensorCount, metadataCount].every((value) => value <= 1_048_576)) {
    throw inputError(path, 'invalid_format', 'GGUF counts are out of range.');
  }

  const metadata: ModelMetadataEntry[] = [];
  for (let index = 0; index < metadataCount; index += 1) {
    const start = reader.offset;
    const key = reader.string();
    const type = reader.u32();
    const decoded = readGgufValue(reader, type);
    metadata.push({
      index,
      key,
      type: decoded.typeName,
      value: decoded.value,
      element_type: decoded.elementType,
      element_count: decoded.elementCount,
      preview_complete: decoded.previewComplete,
      source_offset: start,
      source_length: reader.offset - start,
      json_pointer: null,
    });
  }

  const tensors: ModelTensorEntry[] = [];
  let derivedBytes = 0n;
  let derivedParams = 0n;
  let storageKnown = true;
  const byType = new Map<string, { tensors: number; parameters: bigint; bytes: bigint | null }>();

  for (let index = 0; index < tensorCount; index += 1) {
    const start = reader.offset;
    const name = reader.string();
    const nDims = reader.u32();
    if (nDims > 16) throw inputError(path, 'invalid_format', 'tensor rank is out of range.');
    const shapeDims: number[] = [];
    for (let dim = 0; dim < nDims; dim += 1) shapeDims.push(Number(reader.u64()));
    const shape = shapeDims.map((dim) => String(dim));
    const typeId = reader.u32();
    const dataOffsetRaw = reader.u64();
    if (dataOffsetRaw > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('tensor data offset exceeds exact host offset precision');
    const dataOffset = Number(dataOffsetRaw);
    const typeInfo = GGUF_TYPES[typeId];
    const typeName = typeInfo?.name ?? `GGML_${typeId}`;
    const params = product(shapeDims);
    let byteLength: number | null = null;
    let byteLengthState: ModelTensorEntry['byte_length_state'] = 'unknown';
    if (typeInfo?.bytes !== null && typeInfo?.bytes !== undefined && Number.isSafeInteger(Number(params))) {
      byteLength = Number(params) * typeInfo.bytes;
      byteLengthState = 'derived';
      derivedBytes += BigInt(byteLength);
    } else {
      storageKnown = false;
    }
    derivedParams += params;
    const entry = byType.get(typeName) ?? { tensors: 0, parameters: 0n, bytes: 0n };
    entry.tensors += 1;
    entry.parameters += params;
    if (byteLength === null) entry.bytes = null;
    else if (entry.bytes !== null) entry.bytes += BigInt(byteLength);
    byType.set(typeName, entry);
    tensors.push({
      index,
      name,
      type: typeName,
      type_id: typeId,
      shape,
      data_offset: dataOffset,
      file_offset: 0,
      byte_length: byteLength,
      parameter_count: params.toString(),
      byte_length_state: byteLengthState,
      storage_validation: byteLengthState === 'derived' ? 'consistent' : 'unknown',
      source_offset: start,
      source_length: reader.offset - start,
      json_pointer: null,
    });
  }

  const alignment = 32;
  const headerLength = reader.offset;
  const tensorDataOffset = alignUp(headerLength, alignment);
  for (const tensor of tensors) {
    (tensor as { file_offset: number }).file_offset = tensorDataOffset + tensor.data_offset;
  }

  const headerBytes = bytes.subarray(0, Math.min(headerLength, bytes.length));
  const fullSha = hashMode === 'full' ? sha256(bytes) : null;

  return {
    artifact: {
      path,
      file_size: bytes.length,
      header_sha256: sha256(headerBytes),
      header_length: headerLength,
      sha256: fullSha,
      bytes_read: hashMode === 'full' ? bytes.length : headerLength,
      read_scope: hashMode,
    },
    format: 'gguf',
    version,
    byte_order: 'little',
    alignment,
    tensor_data_offset: tensorDataOffset,
    metadata,
    tensors,
    totals: {
      confidence: storageKnown ? 'derived' : 'unknown',
      parameter_count: derivedParams.toString(),
      tensor_bytes: storageKnown ? Number(derivedBytes) : null,
      by_type: [...byType.entries()].map(([type, info]) => ({
        type,
        tensors: info.tensors,
        parameter_count: info.parameters.toString(),
        bytes: info.bytes === null ? null : Number(info.bytes),
      })),
    },
    coverage: {
      header: 'complete',
      tensor_data: hashMode === 'full' ? 'hashed' : 'not-interpreted',
      array_values: 'complete',
      tensor_ranges: 'complete',
      storage_sizes: storageKnown ? 'complete' : 'unknown',
    },
    limitations: [...MODEL_RESULT_LIMITATIONS],
  };
};

const parseSafetensors = (bytes: Buffer, path: string, hashMode: 'header' | 'full'): ModelArtifactInspection => {
  if (bytes.length < 8) throw inputError(path, 'invalid_format', 'the file is too short for a safetensors header.');
  const headerLength = Number(bytes.readBigUInt64LE(0));
  if (!Number.isSafeInteger(headerLength) || headerLength < 2 || 8 + headerLength > bytes.length) {
    throw inputError(path, 'invalid_format', 'safetensors header length is invalid.');
  }
  const headerBytes = bytes.subarray(8, 8 + headerLength);
  let parsed: unknown;
  try {
    parsed = JSON.parse(headerBytes.toString('utf8'));
  } catch {
    throw inputError(path, 'invalid_format', 'safetensors header is not JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw inputError(path, 'invalid_format', 'safetensors header must be an object.');
  }
  const root = parsed as Record<string, unknown>;
  const metadata: ModelMetadataEntry[] = [];
  const tensors: ModelTensorEntry[] = [];
  let derivedBytes = 0n;
  let derivedParams = 0n;
  const byType = new Map<string, { tensors: number; parameters: bigint; bytes: bigint }>();
  let metaIndex = 0;
  let tensorIndex = 0;
  const dataBase = 8 + headerLength;

  for (const [key, value] of Object.entries(root)) {
    if (key === '__metadata__') {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [metaKey, metaValue] of Object.entries(value as Record<string, unknown>)) {
          metadata.push({
            index: metaIndex,
            key: metaKey,
            type: typeof metaValue,
            value: metaValue,
            element_type: null,
            element_count: null,
            preview_complete: true,
            source_offset: 8,
            source_length: headerLength,
            json_pointer: `/__metadata__/${metaKey}`,
          });
          metaIndex += 1;
        }
      }
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw inputError(path, 'invalid_format', `tensor declaration ${key} is not an object.`);
    }
    const decl = value as Record<string, unknown>;
    const dtype = typeof decl['dtype'] === 'string' ? decl['dtype'] : null;
    const shape = Array.isArray(decl['shape']) ? decl['shape'].filter((entry): entry is number => typeof entry === 'number') : null;
    const offsets = Array.isArray(decl['data_offsets']) ? decl['data_offsets'] : null;
    if (dtype === null || shape === null || offsets === null || offsets.length !== 2 || typeof offsets[0] !== 'number' || typeof offsets[1] !== 'number') {
      throw inputError(path, 'invalid_format', `tensor declaration ${key} is missing dtype/shape/data_offsets.`);
    }
    const byteLength = offsets[1] - offsets[0];
    if (!Number.isInteger(byteLength) || byteLength < 0) throw inputError(path, 'invalid_format', `tensor ${key} has invalid data_offsets.`);
    const params = product(shape);
    const unit = SAFETENSORS_DTYPE_BYTES[dtype.toUpperCase()];
    derivedParams += params;
    derivedBytes += BigInt(byteLength);
    const typeKey = dtype.toUpperCase();
    const entry = byType.get(typeKey) ?? { tensors: 0, parameters: 0n, bytes: 0n };
    entry.tensors += 1;
    entry.parameters += params;
    entry.bytes += BigInt(byteLength);
    byType.set(typeKey, entry);
    const expected = unit === undefined ? null : Number(params) * unit;
    tensors.push({
      index: tensorIndex,
      name: key,
      type: typeKey,
      type_id: null,
      shape: shape.map((dim) => String(dim)),
      data_offset: offsets[0],
      file_offset: dataBase + offsets[0],
      byte_length: byteLength,
      parameter_count: params.toString(),
      byte_length_state: 'declared',
      storage_validation: expected === null || expected === byteLength ? 'consistent' : 'unknown',
      source_offset: 8,
      source_length: headerLength,
      json_pointer: `/${key}`,
    });
    tensorIndex += 1;
  }

  return {
    artifact: {
      path,
      file_size: bytes.length,
      header_sha256: sha256(bytes.subarray(0, 8 + headerLength)),
      header_length: 8 + headerLength,
      sha256: hashMode === 'full' ? sha256(bytes) : null,
      bytes_read: hashMode === 'full' ? bytes.length : 8 + headerLength,
      read_scope: hashMode,
    },
    format: 'safetensors',
    version: null,
    byte_order: 'little',
    alignment: null,
    tensor_data_offset: dataBase,
    metadata,
    tensors,
    totals: {
      confidence: 'derived',
      parameter_count: derivedParams.toString(),
      tensor_bytes: Number(derivedBytes),
      by_type: [...byType.entries()].map(([type, info]) => ({
        type,
        tensors: info.tensors,
        parameter_count: info.parameters.toString(),
        bytes: Number(info.bytes),
      })),
    },
    coverage: {
      header: 'complete',
      tensor_data: hashMode === 'full' ? 'hashed' : 'not-interpreted',
      array_values: 'complete',
      tensor_ranges: 'complete',
      storage_sizes: 'complete',
    },
    limitations: [...MODEL_RESULT_LIMITATIONS],
  };
};

export interface ModelArtifactOptions {
  readonly hash?: 'header' | 'full';
  readonly cwd?: string;
}

export const inspectModelArtifactFromPath = async (path: string, options: ModelArtifactOptions = {}): Promise<{ record: ModelArtifactInspection; path: string; resolvedPath: string }> => {
  const hashMode = options.hash ?? 'header';
  if (hashMode !== 'header' && hashMode !== 'full') throw inputError(path, 'invalid_value', 'hash must be header or full.');
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }

  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'GGUF') {
    return { record: parseGguf(bytes, path, hashMode), path, resolvedPath };
  }
  if (bytes.length >= 8) {
    try {
      return { record: parseSafetensors(bytes, path, hashMode), path, resolvedPath };
    } catch (error) {
      if (error && typeof error === 'object' && 'payload' in error) throw error;
    }
  }
  throw inputError(path, 'invalid_format', 'the file is neither GGUF nor safetensors.');
};
