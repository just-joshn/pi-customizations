import { createHash } from 'node:crypto';

import { layerError } from './errors.ts';

const BOM = '\uFEFF';

export function stripBom(text: string): { readonly bom: string; readonly text: string } {
  return text.startsWith(BOM) ? { bom: BOM, text: text.slice(1) } : { bom: '', text };
}

/** The line ending a file predominantly uses. Empty when it has no line breaks. */
export function detectEol(text: string): '\r\n' | '\n' {
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) !== 10) {
      continue;
    }
    if (index > 0 && text.charCodeAt(index - 1) === 13) {
      crlf++;
    } else {
      lf++;
    }
  }
  return crlf > lf ? '\r\n' : '\n';
}

export function normalizeEol(text: string): string {
  return text.replaceAll('\r\n', '\n');
}

/** Rewrite LF line endings to the target ending, leaving existing CRLF intact. */
export function toEol(text: string, eol: '\r\n' | '\n'): string {
  if (eol === '\n') {
    return text;
  }
  return normalizeEol(text).replaceAll('\n', '\r\n');
}

/** Count lines the way an editor does: an empty file has none, a trailing newline adds no line. */
export function countLines(text: string): number {
  if (text === '') {
    return 0;
  }
  const normalized = normalizeEol(text);
  const lines = normalized.split('\n');
  if (normalized.endsWith('\n')) {
    lines.pop();
  }
  return lines.length;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Decode standard padded base64. Whitespace is ignored. A non-empty string that is not RFC 4648
 * alphabet, or whose length is not a multiple of 4, is rejected instead of being truncated.
 */
export function decodeBase64(content: string): Buffer {
  const compact = content.replace(/\s+/g, '');
  if (compact !== '' && (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0)) {
    throw layerError('invalid_arguments', 'content is not valid base64', {
      hint: 'Pass standard base64 (RFC 4648, padded) without a data: prefix, or use encoding "utf8".',
    });
  }
  return Buffer.from(compact, 'base64');
}

const BINARY_SAMPLE_BYTES = 8000;

/** Heuristic binary detection: a NUL byte or a high share of control characters in the sample. */
export function looksBinary(buffer: Uint8Array): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, BINARY_SAMPLE_BYTES));
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    const isControl = byte < 9 || (byte > 13 && byte < 32);
    if (isControl) {
      control++;
    }
  }
  return sample.length > 0 && control / sample.length > 0.3;
}

/** Occurrence count of a literal needle. */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
