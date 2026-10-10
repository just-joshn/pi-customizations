import { estimateTokens } from '@earendil-works/pi-coding-agent';

export type FileTokenRow = {
  readonly tokens: number;
  readonly label: string;
  readonly tip: string;
};

const DROP_HINT = '/drop to remove';
const FENCE = '```';

/** Pi-native estimate for fenced chat-file content (chars/4 via `estimateTokens`). */
export function estimateFencedFileTokens(relativeName: string, content: string): number {
  const body = `${relativeName}\n${FENCE}\n${content}${FENCE}\n`;
  return estimateTokens({ role: 'user', content: body, timestamp: 0 });
}

export type FileTokenEntry = { readonly relative: string; readonly content: string | null };

export type FileTokenListingInput = {
  readonly editable: readonly FileTokenEntry[];
  readonly readOnly: readonly FileTokenEntry[];
  readonly estimate?: (relativeName: string, content: string) => number;
};

/** Per-file rows for `/tokens`, matching Aider's file section of `cmd_tokens`. */
export function fileTokenRows(input: FileTokenListingInput): readonly FileTokenRow[] {
  const estimate = input.estimate ?? estimateFencedFileTokens;
  const rows: FileTokenRow[] = [];
  for (const file of input.editable) {
    if (file.content === null) continue;
    rows.push({ tokens: estimate(file.relative, file.content), label: file.relative, tip: DROP_HINT });
  }
  for (const file of input.readOnly) {
    if (file.content === null) continue;
    rows.push({ tokens: estimate(file.relative, file.content), label: `${file.relative} (read-only)`, tip: DROP_HINT });
  }
  return [...rows].sort((a, b) => a.tokens - b.tokens || a.label.localeCompare(b.label));
}

/** Lines that list each selected file with its native token estimate and drop hint. */
export function formatFileTokenLines(rows: readonly FileTokenRow[]): readonly string[] {
  if (!rows.length) return [];
  const width = Math.max(...rows.map((row) => row.label.length));
  return rows.map((row) => `${String(row.tokens).padStart(8)} ${row.label.padEnd(width)} ${row.tip}`);
}
