import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export const DEFAULT_BLOCK_SIZE = 4096;
export const HIGH_THRESHOLD = 7.2;
export const LOW_THRESHOLD = 1.0;

export interface ByteEntropyInspection {
  readonly artifact: { readonly path: string; readonly bytes: number; readonly sha256: string };
  readonly block_size: number;
  readonly window: { readonly offset: number; readonly length: number };
  readonly file_entropy: number;
  readonly thresholds: { readonly high: number; readonly low: number };
  readonly blocks: readonly { readonly offset: number; readonly length: number; readonly entropy: number }[];
  readonly runs: readonly { readonly offset: number; readonly length: number; readonly classification: 'high' | 'low' }[];
  readonly limitations: readonly string[];
}

export const ENTROPY_LIMITATIONS = [
  'Entropy does not prove encryption; compressed and encrypted bytes cannot be distinguished by this measure.',
  'Entropy is rounded to four decimal places; thresholds classify those reported values. Small blocks can underestimate entropy.',
  'The file-wide hash and entropy cover the entire file; blocks and runs cover only the selected window. Empty input has entropy 0 by convention.',
];

const roundEntropy = (value: number): number => Math.round(value * 10_000) / 10_000;

const isPowerOfTwo = (value: number): boolean => value > 0 && (value & (value - 1)) === 0;

export const shannonEntropy = (bytes: Uint8Array): number => {
  if (bytes.length === 0) return 0;
  const counts = new Array<number>(256).fill(0);
  for (const value of bytes) counts[value]! += 1;
  let entropy = 0;
  const length = bytes.length;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
};

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_byte_entropy',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

export interface ByteEntropyOptions {
  readonly blockSize?: number;
  readonly offset?: number;
  readonly length?: number;
  readonly cwd?: string;
}

export const inspectByteEntropyFromPath = async (path: string, options: ByteEntropyOptions = {}): Promise<{ record: ByteEntropyInspection; path: string; resolvedPath: string }> => {
  const blockSize = options.blockSize ?? DEFAULT_BLOCK_SIZE;
  if (!Number.isInteger(blockSize) || blockSize < 256 || blockSize > 65_536 || !isPowerOfTwo(blockSize)) {
    throw inputError(path, 'invalid_value', 'block_size must be a power of two between 256 and 65536.');
  }
  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }

  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > bytes.length) {
    throw inputError(path, 'invalid_value', 'offset must be an integer within the file.');
  }
  const length = options.length ?? bytes.length - offset;
  if (!Number.isInteger(length) || length < 0 || offset + length > bytes.length) {
    throw inputError(path, 'invalid_value', 'length must fit within the file from offset.');
  }

  const window = bytes.subarray(offset, offset + length);
  const fileEntropy = roundEntropy(shannonEntropy(bytes));
  const blocks: { offset: number; length: number; entropy: number }[] = [];
  for (let at = 0; at < window.length; at += blockSize) {
    const slice = window.subarray(at, Math.min(at + blockSize, window.length));
    blocks.push({ offset: offset + at, length: slice.length, entropy: roundEntropy(shannonEntropy(slice)) });
  }

  const runs: { offset: number; length: number; classification: 'high' | 'low' }[] = [];
  let current: { offset: number; length: number; classification: 'high' | 'low' } | null = null;
  for (const block of blocks) {
    const classification: 'high' | 'low' | null = block.entropy >= HIGH_THRESHOLD ? 'high' : block.entropy <= LOW_THRESHOLD ? 'low' : null;
    if (classification === null) {
      if (current !== null) runs.push(current);
      current = null;
      continue;
    }
    if (current !== null && current.classification === classification && current.offset + current.length === block.offset) {
      current = { offset: current.offset, length: current.length + block.length, classification: current.classification };
    } else {
      if (current !== null) runs.push(current);
      current = { offset: block.offset, length: block.length, classification };
    }
  }
  if (current !== null) runs.push(current);

  return {
    path,
    resolvedPath,
    record: {
      artifact: { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
      block_size: blockSize,
      window: { offset, length },
      file_entropy: fileEntropy,
      thresholds: { high: HIGH_THRESHOLD, low: LOW_THRESHOLD },
      blocks,
      runs,
      limitations: [...ENTROPY_LIMITATIONS],
    },
  };
};
