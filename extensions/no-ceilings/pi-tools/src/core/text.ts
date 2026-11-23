import { createHash } from 'node:crypto';

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
