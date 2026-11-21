import { closeSync, existsSync, openSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';

import { z } from 'zod';
import { type Job, jobFiles, type OutputNotificationConfig, readJson } from './jobs.ts';

export type { OutputNotificationConfig };

export interface PendingBatch {
  startOccurrence: number;
  endOccurrence: number;
  count: number;
  matchedTextDetail: string;
  firstQueuedAtMs: number;
}

export interface OutputNotificationState {
  byteOffset: number;
  carryover: string;
  matchedOccurrences: number;
  emittedNotifications: number;
  limitReached: boolean;
  pendingBatch: PendingBatch | null;
}

export interface OutputNotification {
  taskId: string;
  title: string;
  detail: string;
  outputPath: string;
}

export interface NotificationContext {
  jobId: string;
  outputPath: string;
  nowMs: number;
  finished: boolean;
}

export interface AdvanceResult {
  nextState: OutputNotificationState;
  notifications: OutputNotification[];
}

export const MAX_PATTERN_LENGTH = 500;
export const CHUNK_CHARS = 65_536;
export const CARRYOVER_CHARS = 1024;
export const DEFAULT_DEBOUNCE_MS = 5000;
export const MIN_DEBOUNCE_MS = 5000;
export const DEFAULT_NOTIFICATION_LIMIT = 100;
export const MAX_MATCH_DETAIL_CHARS = 5000;
export const MAX_TITLE_CHARS = 500;
const MS_PER_SECOND = 1000;
const BYTES_PER_MEBIBYTE = 1_048_576;
const MAX_POLL_MEGABYTES = 4;
const MAX_POLL_BYTES = MAX_POLL_MEGABYTES * BYTES_PER_MEBIBYTE;
const UTF8_CONTINUATION_MASK = 0xc0;
const UTF8_CONTINUATION_BITS = 0x80;
const UTF8_LEAD_2_MASK = 0xe0;
const UTF8_LEAD_2_BITS = 0xc0;
const UTF8_LEAD_3_MASK = 0xf0;
const UTF8_LEAD_3_BITS = 0xe0;
const UTF8_LEAD_4_MASK = 0xf8;
const UTF8_LEAD_4_BITS = 0xf0;
const UTF8_MAX_SEQUENCE = 4;
const UTF8_SEQUENCE_THREE = 3;
const UTF8_SEQUENCE_TWO = 2;
const NEWLINE_BYTE = 0x0a;

export const initialOutputNotificationState: OutputNotificationState = {
  byteOffset: 0,
  carryover: '',
  matchedOccurrences: 0,
  emittedNotifications: 0,
  limitReached: false,
  pendingBatch: null,
};

const PendingBatchSchema = z.object({
  startOccurrence: z.number().int(),
  endOccurrence: z.number().int(),
  count: z.number().int(),
  matchedTextDetail: z.string(),
  firstQueuedAtMs: z.number(),
});

const StateSchema = z.object({
  byteOffset: z.number().int().min(0),
  carryover: z.string(),
  matchedOccurrences: z.number().int().min(0),
  emittedNotifications: z.number().int().min(0),
  limitReached: z.boolean(),
  pendingBatch: PendingBatchSchema.nullable(),
});

/** Throws a descriptive error when the pattern does not compile. */
function assertCompiles(pattern: string): void {
  try {
    new RegExp(pattern, 'gm');
  } catch (error) {
    console.error('Output notification pattern failed to compile:', error);
    throw new Error(`notify_on_output.pattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Checks a notify_on_output config at the boundary and throws a descriptive error when it is unusable. */
export function validateOutputNotificationConfig(config: OutputNotificationConfig): void {
  const pattern = config.pattern.trim();
  if (pattern === '') throw new Error('notify_on_output.pattern must not be empty.');
  if (config.pattern.length > MAX_PATTERN_LENGTH) throw new Error(`notify_on_output.pattern must be at most ${MAX_PATTERN_LENGTH} characters.`);
  assertCompiles(config.pattern);
  const { debounceSeconds, notificationLimit } = config;
  if (debounceSeconds !== undefined && !(Number.isFinite(debounceSeconds) && debounceSeconds >= 0)) throw new Error('notify_on_output.debounce_seconds must be a finite number of at least 0.');
  if (notificationLimit !== undefined && notificationLimit !== null && !(Number.isInteger(notificationLimit) && notificationLimit > 0)) throw new Error('notify_on_output.notification_limit must be a positive integer.');
}

const debounceMs = (config: OutputNotificationConfig): number => Math.max(Math.ceil((config.debounceSeconds ?? DEFAULT_DEBOUNCE_MS / MS_PER_SECOND) * MS_PER_SECOND), MIN_DEBOUNCE_MS);
const limitOf = (config: OutputNotificationConfig): number | null => (config.notificationLimit === undefined ? DEFAULT_NOTIFICATION_LIMIT : config.notificationLimit);

function titleOf(config: OutputNotificationConfig): string {
  const reason = config.reason?.trim();
  const raw = reason ? reason : `Shell output contains /${config.pattern}/`;
  return raw.length > MAX_TITLE_CHARS ? `${raw.slice(0, MAX_TITLE_CHARS)}...` : raw;
}

function matchDetail(text: string): string {
  return text.length > MAX_MATCH_DETAIL_CHARS ? `omitted (${text.length} characters exceeds ${MAX_MATCH_DETAIL_CHARS})` : text;
}

type Progress = { state: OutputNotificationState; notifications: OutputNotification[] };

function emit(progress: Progress, config: OutputNotificationConfig, ctx: NotificationContext, detail: string, title = titleOf(config)): Progress {
  const emitted = progress.state.emittedNotifications + 1;
  const notification: OutputNotification = { taskId: `${ctx.jobId}:task_progress:${emitted}`, title, detail, outputPath: ctx.outputPath };
  return { state: { ...progress.state, emittedNotifications: emitted }, notifications: [...progress.notifications, notification] };
}

function flushBatch(progress: Progress, config: OutputNotificationConfig, ctx: NotificationContext): Progress {
  const batch = progress.state.pendingBatch;
  if (!batch) return progress;
  const range = batch.count === 1 ? `occurrence ${batch.endOccurrence}` : `occurrences ${batch.startOccurrence}-${batch.endOccurrence}`;
  const detail = `${batch.count} more match(es), ${range}. Latest match: ${batch.matchedTextDetail}`;
  return emit({ ...progress, state: { ...progress.state, pendingBatch: null } }, config, ctx, detail);
}

function queueBatch(state: OutputNotificationState, occurrence: number, detail: string, nowMs: number): PendingBatch {
  const batch = state.pendingBatch;
  if (!batch) return { startOccurrence: occurrence, endOccurrence: occurrence, count: 1, matchedTextDetail: detail, firstQueuedAtMs: nowMs };
  return { ...batch, endOccurrence: occurrence, count: batch.count + 1, matchedTextDetail: detail };
}

function limitReached(progress: Progress, config: OutputNotificationConfig, ctx: NotificationContext, limit: number): Progress {
  const flushed = flushBatch(progress, config, ctx);
  const detail = `Pattern /${config.pattern}/ matched ${limit} times, so no further notifications will be sent. Read the output file directly: ${ctx.outputPath}`;
  const sent = emit(flushed, config, ctx, detail, `Notification limit reached (${limit})`);
  return { ...sent, state: { ...sent.state, limitReached: true } };
}

function registerMatch(progress: Progress, config: OutputNotificationConfig, ctx: NotificationContext, text: string): Progress {
  if (progress.state.limitReached) return progress;
  const occurrence = progress.state.matchedOccurrences + 1;
  const counted: Progress = { ...progress, state: { ...progress.state, matchedOccurrences: occurrence } };
  const detail = matchDetail(text);
  const handled = occurrence === 1 ? emit(counted, config, ctx, `Matched text: ${detail}`) : { ...counted, state: { ...counted.state, pendingBatch: queueBatch(counted.state, occurrence, detail, ctx.nowMs) } };
  const limit = limitOf(config);
  return limit !== null && occurrence === limit ? limitReached(handled, config, ctx, limit) : handled;
}

function scanSlice(progress: Progress, config: OutputNotificationConfig, ctx: NotificationContext, slice: string): Progress {
  if (progress.state.limitReached) return progress;
  const { carryover } = progress.state;
  const haystack = carryover + slice;
  const fresh = [...haystack.matchAll(new RegExp(config.pattern, 'gm'))].filter((match) => (match.index ?? 0) + match[0].length > carryover.length);
  const scanned = fresh.reduce((acc, match) => registerMatch(acc, config, ctx, match[0]), progress);
  return { ...scanned, state: { ...scanned.state, carryover: haystack.slice(-CARRYOVER_CHARS) } };
}

function slicesOf(chunk: string): string[] {
  return Array.from({ length: Math.ceil(chunk.length / CHUNK_CHARS) }, (_, index) => chunk.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS));
}

function flushDue(progress: Progress, config: OutputNotificationConfig, ctx: NotificationContext): Progress {
  const batch = progress.state.pendingBatch;
  if (!batch) return progress;
  return ctx.finished || ctx.nowMs - batch.firstQueuedAtMs >= debounceMs(config) ? flushBatch(progress, config, ctx) : progress;
}

/**
 * Pure transition: scans one chunk of new output, and returns the next state with the notifications to deliver.
 * The first match notifies at once, later matches coalesce until the debounce passes, the limit is hit, or the job ends.
 */
export function advanceOutputNotification(state: OutputNotificationState, config: OutputNotificationConfig, chunk: string, ctx: NotificationContext): AdvanceResult {
  if (state.limitReached) return { nextState: state, notifications: [] };
  const scanned = slicesOf(chunk).reduce((acc, slice) => scanSlice(acc, config, ctx, slice), { state, notifications: [] } as Progress);
  const done = flushDue(scanned, config, ctx);
  return { nextState: done.state, notifications: done.notifications };
}

/** How many leading bytes of the buffer end on a complete UTF-8 character. */
function completeUtf8Length(buffer: Buffer): number {
  const lookback = Math.min(buffer.length, UTF8_MAX_SEQUENCE - 1);
  const starts = Array.from({ length: lookback }, (_, back) => buffer.length - 1 - back);
  const leadIndex = starts.find((index) => ((buffer[index] ?? 0) & UTF8_CONTINUATION_MASK) !== UTF8_CONTINUATION_BITS);
  if (leadIndex === undefined) return buffer.length;
  const byte = buffer[leadIndex] ?? 0;
  const needed = sequenceLength(byte);
  return buffer.length - leadIndex < needed ? leadIndex : buffer.length;
}

function sequenceLength(byte: number): number {
  if ((byte & UTF8_LEAD_4_MASK) === UTF8_LEAD_4_BITS) return UTF8_MAX_SEQUENCE;
  if ((byte & UTF8_LEAD_3_MASK) === UTF8_LEAD_3_BITS) return UTF8_SEQUENCE_THREE;
  if ((byte & UTF8_LEAD_2_MASK) === UTF8_LEAD_2_BITS) return UTF8_SEQUENCE_TWO;
  return 1;
}

type NewOutput = { chunk: string; byteOffset: number; caughtUp: boolean };

function sliceEnd(buffer: Buffer, includePartialLine: boolean): number {
  if (includePartialLine) return buffer.length;
  const utf8End = completeUtf8Length(buffer);
  const newlineEnd = buffer.subarray(0, utf8End).lastIndexOf(NEWLINE_BYTE) + 1;
  if (newlineEnd > 0) return newlineEnd;
  return buffer.length === MAX_POLL_BYTES ? utf8End || buffer.length : 0;
}

/** Reads only the bytes written since `offset`, stopping at the last newline while the job is running so partial lines never match twice. */
function readNewOutput(path: string, offset: number, includePartialLine: boolean): NewOutput {
  const size = existsSync(path) ? statSync(path).size : 0;
  const start = Math.min(offset, size);
  const length = Math.min(size - start, MAX_POLL_BYTES);
  if (length === 0) return { chunk: '', byteOffset: start, caughtUp: true };
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }
  const whole = buffer.subarray(0, sliceEnd(buffer, includePartialLine));
  return { chunk: whole.toString('utf8'), byteOffset: start + whole.length, caughtUp: start + whole.length >= size };
}

const readState = (path: string): OutputNotificationState => readJson(path, StateSchema) ?? initialOutputNotificationState;

function writeState(path: string, state: OutputNotificationState): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state)}\n`);
  renameSync(temp, path);
}

export const formatNotification = (job: Job, n: OutputNotification): string => `tmux job ${job.spec.name} (${job.spec.id}) output match [${n.taskId}]: ${n.title}\n\n${n.detail}\n\nRaw output: ${n.outputPath}`;

export interface PollOutputResult {
  messages: string[];
  done: boolean;
}

/** Reads the job's new output, advances its persisted notify state, and returns the messages to wake the session with. */
export function pollOutputNotifications(job: Job, nowMs: number = Date.now()): PollOutputResult {
  const config = job.spec.notifyOnOutput;
  const exited = job.status.state !== 'running';
  if (!config) return { messages: [], done: exited };
  const files = jobFiles(job.dir);
  const state = readState(files.notifyState);
  if (state.limitReached) return { messages: [], done: exited };
  const fresh = readNewOutput(files.output, state.byteOffset, exited);
  const done = exited && fresh.caughtUp;
  const ctx: NotificationContext = { jobId: job.spec.id, outputPath: files.output, nowMs, finished: done };
  const { nextState, notifications } = advanceOutputNotification({ ...state, byteOffset: fresh.byteOffset }, config, fresh.chunk, ctx);
  const changed = fresh.byteOffset !== state.byteOffset || notifications.length > 0 || nextState.pendingBatch !== state.pendingBatch || nextState.limitReached !== state.limitReached;
  if (changed) writeState(files.notifyState, nextState);
  return { messages: notifications.map((n) => formatNotification(job, n)), done };
}
