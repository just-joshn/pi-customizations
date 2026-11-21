import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';
import { MAX_PREVIEW_LINES, ONE, SIX, ZERO } from './types.ts';

const PI_DIR_NAME = '.pi';
const INVALID_SESSION_CHARS = /[^a-zA-Z0-9-]/g;

const DebugLogRecordSchema = z
  .object({
    id: z.string().optional(),
    timestamp: z.number().optional(),
    message: z.string().optional(),
    location: z.string().optional(),
  })
  .passthrough();

export interface DebugLogPreviewLine {
  readonly key: string;
  readonly text: string;
}

export interface DebugLogPreview {
  readonly logPath: string;
  readonly lines: readonly DebugLogPreviewLine[];
  readonly totalLines: number;
}

export function deriveDebugSessionId(conversationId: string): string {
  const cleaned = conversationId.replace(/-/g, '').replace(INVALID_SESSION_CHARS, '').slice(ZERO, SIX);
  return cleaned.length > ZERO ? cleaned : 'debug0';
}

export function getDebugLogPath(workspaceDir: string, conversationId: string): string {
  const sessionId = deriveDebugSessionId(conversationId);
  return join(workspaceDir, PI_DIR_NAME, `debug-${sessionId}.log`);
}

function formatTimeLabel(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, { hour12: false });
}

function parseSingleLogLine(rawLine: string, fallbackNow: number): DebugLogPreviewLine {
  const trimmed = rawLine.trim();
  const parsed = parseJsonObjectSafe(trimmed);
  if (parsed) {
    const ts = parsed.timestamp ?? fallbackNow;
    const msg = parsed.message ?? parsed.location ?? trimmed;
    return {
      key: parsed.id ?? `${ts}-${msg}`,
      text: `${formatTimeLabel(ts)} ${msg}`,
    };
  }
  return {
    key: `${fallbackNow}-${trimmed}`,
    text: `${formatTimeLabel(fallbackNow)} ${trimmed}`,
  };
}

function parseJsonObjectSafe(text: string): z.infer<typeof DebugLogRecordSchema> | undefined {
  if (!text.startsWith('{') || !text.endsWith('}')) {
    return undefined;
  }
  try {
    const parsed = DebugLogRecordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function readLogFileSafe(logPath: string): string | undefined {
  if (!existsSync(logPath)) {
    return undefined;
  }
  try {
    return statSync(logPath).isFile() ? readFileSync(logPath, 'utf-8') : undefined;
  } catch {
    return undefined;
  }
}

export function readDebugLogPreview(workspaceDir: string, conversationId: string, maxLines = MAX_PREVIEW_LINES): DebugLogPreview {
  const logPath = getDebugLogPath(workspaceDir, conversationId);
  const raw = readLogFileSafe(logPath);
  if (raw === undefined) {
    return { logPath, lines: [], totalLines: ZERO };
  }
  const nonEmpty = raw.split('\n').filter((line) => line.trim().length > ZERO);
  const now = Date.now();
  const tail = nonEmpty.slice(-maxLines).map((line) => parseSingleLogLine(line, now));
  return {
    logPath,
    lines: tail,
    totalLines: nonEmpty.length,
  };
}

export function formatDebugLogWidgetLines(preview: DebugLogPreview): readonly string[] {
  const header = `Runtime Logs (${preview.logPath})`;
  if (preview.lines.length === ZERO) {
    return [header, 'Waiting for log entries...'];
  }
  const hiddenCount = Math.max(ZERO, preview.totalLines - preview.lines.length);
  const hiddenLabel = hiddenCount === ONE ? 'line' : 'lines';
  const hiddenLine = hiddenCount > ZERO ? [`(${hiddenCount} ${hiddenLabel} hidden above)`] : [];
  return [header, ...hiddenLine, ...preview.lines.map((line) => line.text)];
}
