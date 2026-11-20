import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ToolResult } from './results.ts';

const BYTES_PER_KIBIBYTE = 1024;
const BYTES_PER_MEBIBYTE = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const MAX_LOG_MEGABYTES = 32;
export const MAX_OUTPUT_LOG_BYTES = MAX_LOG_MEGABYTES * BYTES_PER_MEBIBYTE;
const FINAL_LINE_RESERVE_KIBIBYTES = 64;
const FINAL_LINE_RESERVE_BYTES = FINAL_LINE_RESERVE_KIBIBYTES * BYTES_PER_KIBIBYTE;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const replaceAt = (counts: readonly number[], index: number, value: number): readonly number[] =>
  index < counts.length ? counts.map((count, i) => (i === index ? value : count)) : [...counts, ...Array.from({ length: index - counts.length }, () => 0), value];

/** Writes what a wake job's workers say to a private JSONL file: one line per new message, then one final line. */
export function createOutputLog(file: string, id: string, now: () => number = Date.now) {
  let bytes = 0;
  let written: readonly number[] = [];

  const write = (line: Readonly<Record<string, unknown>>, limit: number, first = false): void => {
    const text = `${JSON.stringify({ ...line, at: now() })}\n`;
    const size = Buffer.byteLength(text);
    if (bytes + size > limit) return;
    if (first) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: DIR_MODE });
      fs.writeFileSync(file, text, { mode: FILE_MODE });
    } else if (fs.existsSync(path.dirname(file))) {
      fs.appendFileSync(file, text, { mode: FILE_MODE });
    } else {
      return;
    }
    bytes += size;
  };

  const begin = (): void => write({ type: 'start', id }, MAX_OUTPUT_LOG_BYTES, true);

  /** Appends the messages each worker has produced since the last snapshot. */
  const record = (result: ToolResult): void => {
    const results = result.details?.results ?? [];
    results.forEach((worker, index) => {
      const from = written[index] ?? 0;
      for (const message of worker.messages.slice(from)) {
        write({ type: 'message', index, agent: worker.agent, message }, MAX_OUTPUT_LOG_BYTES - FINAL_LINE_RESERVE_BYTES);
      }
      written = replaceAt(written, index, worker.messages.length);
    });
  };

  const finish = (report: string): void => write({ type: 'final', report }, MAX_OUTPUT_LOG_BYTES);

  return { begin, record, finish };
}

export type OutputLog = ReturnType<typeof createOutputLog>;
