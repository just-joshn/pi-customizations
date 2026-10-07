import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Static } from 'typebox';
import { Check } from 'typebox/value';
import type { Mode } from './modes.ts';
import { AssistantEntry, HistoryRow } from './schemas.ts';
import type { ModeTransition } from './state.ts';

export type Availability = 'complete' | 'partial' | 'unknown';
export interface Count {
  readonly value: number | null;
  readonly availability: Availability;
}
export interface ResponseUsage {
  readonly ts: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
}
export interface SessionUsage {
  readonly output: Count;
  readonly cacheRead: Count;
  readonly turns: number;
  readonly model: string | null;
  readonly responses: readonly ResponseUsage[];
}
export interface Attribution {
  readonly byMode: Readonly<Record<string, number>>;
  readonly unknownTokens: number;
  readonly basis: 'log' | 'whole-session' | 'unavailable';
}
export interface CompressedSummary {
  readonly count: number;
  readonly totalOriginal: number;
  readonly totalCompressed: number;
  readonly bytesReduced: number;
}
export interface HistoryAggregate {
  readonly sessions: number;
  readonly output: Count;
}

const SEP = '──────────────────────────────────';
const SAVINGS_UNKNOWN = 'Savings: unknown — no measured comparison for this session.';
const fmt = (n: number): string => n.toLocaleString('en-US');
const isTokenCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function totalCounts(counts: readonly { value: unknown; availability?: unknown }[]): Count {
  let total = 0;
  let known = 0;
  let complete = true;
  for (const { value, availability = 'complete' } of counts) {
    if (!isTokenCount(value) || (availability !== 'complete' && availability !== 'partial')) {
      complete = false;
      continue;
    }
    total += value;
    if (!Number.isSafeInteger(total)) return { value: null, availability: 'unknown' };
    known++;
    if (availability !== 'complete') complete = false;
  }
  return known === 0 ? { value: null, availability: 'unknown' } : { value: total, availability: complete ? 'complete' : 'partial' };
}

export function sessionUsage(entries: readonly unknown[]): SessionUsage {
  const messages = entries.flatMap((entry) => (Check(AssistantEntry, entry) ? [entry.message] : []));
  const model = messages.find((message) => message.model)?.model ?? null;
  const responses: ResponseUsage[] = messages.map((message) => ({
    ts: message.timestamp !== undefined && Number.isFinite(message.timestamp) ? message.timestamp : null,
    outputTokens: isTokenCount(message.usage?.output) ? message.usage.output : null,
    cacheReadTokens: isTokenCount(message.usage?.cacheRead) ? message.usage.cacheRead : null,
  }));
  return {
    output: totalCounts(responses.map((r) => ({ value: r.outputTokens }))),
    cacheRead: totalCounts(responses.map((r) => ({ value: r.cacheReadTokens }))),
    turns: responses.length,
    model,
    responses,
  };
}

export function attributeByMode(args: { responses: readonly ResponseUsage[]; transitions: readonly ModeTransition[]; mode: Mode | null; output: Count }): Attribution {
  const { responses, transitions, mode, output } = args;
  if (output.value === null) return { byMode: {}, unknownTokens: 0, basis: 'unavailable' };
  const first = transitions[0];
  if (!first) return { byMode: { [mode ?? 'none']: output.value }, unknownTokens: 0, basis: 'whole-session' };
  const byMode: Record<string, number> = {};
  let unknownTokens = 0;
  for (const response of responses) {
    if (response.outputTokens === null) continue;
    if (response.ts === null) {
      unknownTokens += response.outputTokens;
      continue;
    }
    const ts = response.ts;
    const active = transitions.findLast((transition) => transition.ts <= ts);
    const key = (active ? active.mode : first.prev) ?? 'none';
    byMode[key] = (byMode[key] ?? 0) + response.outputTokens;
  }
  return { byMode, unknownTokens, basis: 'log' };
}

function formatCount(count: Count): string {
  if (count.value === null) return 'unknown (usage unavailable)';
  return fmt(count.value) + (count.availability === 'partial' ? ' known (partial; total unknown)' : '');
}

function modeDetails(args: { mode: Mode | null; attribution: Attribution; output: Count }): string {
  const { mode, attribution, output } = args;
  const activeKeys = Object.keys(attribution.byMode).filter((key) => (attribution.byMode[key] ?? 0) > 0);
  const uniform = attribution.unknownTokens === 0 && (activeKeys.length === 0 || (activeKeys.length === 1 && activeKeys[0] === (mode ?? 'none')));
  let details: string;
  if (uniform) {
    details = `Mode: ${mode ?? 'caveman off'}${attribution.basis === 'whole-session' ? ' (current mode; no transition log)' : ''}`;
  } else {
    const lines = ['Mode changed mid-session — output attributed per mode:'];
    for (const key of activeKeys) lines.push(`  ${key === 'none' ? 'caveman off' : key}: ${fmt(attribution.byMode[key] ?? 0)} tokens`);
    if (attribution.unknownTokens > 0) lines.push(`  unattributed: ${fmt(attribution.unknownTokens)} tokens (mode unknown)`);
    details = lines.join('\n');
  }
  return output.availability === 'partial' ? `${details}\nMode attribution covers known output tokens only.` : details;
}

export function formatStats(args: { usage: SessionUsage; mode: Mode | null; sessionPath: string | null; compressed: CompressedSummary | null; attribution: Attribution }): string {
  const { usage, mode, sessionPath, compressed, attribution } = args;
  if (usage.turns === 0) return `\nCaveman Stats\n${SEP}\nNo conversation yet — stats available after first response.\n${SEP}\n`;
  const shortPath = sessionPath && sessionPath.length > 45 ? `...${sessionPath.slice(-45)}` : (sessionPath ?? '');
  const memory =
    compressed && compressed.count > 0
      ? `${SEP}\nMemory file sizes:     ${compressed.count} pair${compressed.count === 1 ? '' : 's'}, ${fmt(compressed.totalOriginal)} original bytes → ${fmt(compressed.totalCompressed)} current bytes (${fmt(compressed.bytesReduced)} fewer bytes)\nFile sizes do not measure provider token or billing savings.\n`
      : '';
  return (
    `\nCaveman Stats\n${SEP}\n` +
    (shortPath ? `Session:  ${shortPath}\n` : '') +
    `Turns:    ${usage.turns}\n${SEP}\n` +
    `Output tokens:         ${formatCount(usage.output)}\n` +
    `Cache-read tokens:     ${formatCount(usage.cacheRead)}\n${SEP}\n` +
    `${modeDetails({ mode, attribution, output: usage.output })}\n${SAVINGS_UNKNOWN}\n` +
    memory
  );
}

export function formatShare(usage: SessionUsage): string {
  if (usage.turns === 0) return '🪨 No turns yet; savings unknown — caveman.sh';
  const { value, availability } = usage.output;
  const tokens = value === null ? 'output tokens unknown (usage unavailable)' : `${fmt(value)}${availability === 'partial' ? ' known' : ''} output tokens${availability === 'partial' ? ' (partial; total unknown)' : ''}`;
  return `🪨 ${usage.turns} turn${usage.turns === 1 ? '' : 's'}, ${tokens} this session; savings unknown — caveman.sh`;
}

export function formatHistory(args: HistoryAggregate & { since: string | null }): string {
  const window = args.since ? ` (last ${args.since})` : '';
  if (args.sessions === 0) {
    return `\nCaveman Stats — Lifetime${window}\n${SEP}\nNo sessions logged yet — run /caveman-stats inside any session to start tracking.\n${SEP}\n`;
  }
  return (
    `\nCaveman Stats — Lifetime${window}\n${SEP}\n` +
    `Sessions:   ${fmt(args.sessions)}\n${SEP}\n` +
    `Output tokens:         ${formatCount(args.output)}\n` +
    `Savings: unknown — historical estimates are not verified measurements.\n${SEP}\n`
  );
}

export function parseDuration(spec: string): number | null {
  const match = /^(\d+)([dh])$/.exec(spec.trim());
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 10) * (match[2] === 'd' ? 86_400_000 : 3_600_000);
}

function readLines(path: string): string[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim());
  } catch {
    // No history file yet means no sessions logged, as upstream reports.
    return [];
  }
}

function parseRow(line: string): Static<typeof HistoryRow> | null {
  try {
    const row: unknown = JSON.parse(line);
    return Check(HistoryRow, row) ? row : null;
  } catch {
    // A torn or corrupt line is skipped, matching upstream's reader.
    return null;
  }
}

export function aggregateHistory(args: { path: string; sinceMs: number | null; now: number }): HistoryAggregate {
  const cutoff = args.sinceMs === null ? null : args.now - args.sinceMs;
  const rows = readLines(args.path).flatMap((line) => {
    const row = parseRow(line);
    return row && (cutoff === null || (row.ts ?? 0) >= cutoff) ? [row] : [];
  });
  const latest = new Map<string, Static<typeof HistoryRow>>();
  for (const row of rows) {
    const id = row.session_id || '_';
    if ((row.ts ?? 0) >= (latest.get(id)?.ts ?? Number.NEGATIVE_INFINITY)) latest.set(id, row);
  }
  return { sessions: latest.size, output: totalCounts([...latest.values()].map((row) => ({ value: row.output_tokens, availability: row.output_tokens_availability }))) };
}

export function appendHistory(path: string, record: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function fileSize(path: string): number | null {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat.size : null;
  } catch {
    // A backup without its compressed sibling is not a pair, as upstream skips it.
    return null;
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // An unreadable or missing scan directory contributes no pairs.
    return [];
  }
}

export function findCompressedPairs(dirs: readonly string[]): CompressedSummary | null {
  const pairs = [...new Set(dirs)].flatMap((dir) =>
    listDir(dir)
      .filter((name) => name.endsWith('.original.md'))
      .flatMap((name) => {
        const original = fileSize(join(dir, name));
        const compressed = fileSize(join(dir, `${name.slice(0, -'.original.md'.length)}.md`));
        return original !== null && compressed !== null && original > compressed ? [{ original, compressed }] : [];
      }),
  );
  if (pairs.length === 0) return null;
  const totalOriginal = pairs.reduce((sum, p) => sum + p.original, 0);
  const totalCompressed = pairs.reduce((sum, p) => sum + p.compressed, 0);
  return { count: pairs.length, totalOriginal, totalCompressed, bytesReduced: totalOriginal - totalCompressed };
}
