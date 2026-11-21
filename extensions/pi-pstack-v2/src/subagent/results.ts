import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from '@earendil-works/pi-coding-agent';
import { frameSubagentReport } from './framing.ts';
import type { DisplayItem, SingleResult, SubagentDetails, SubagentMode, UsageStats } from './types.ts';

const KIBIBYTES_PER_TASK = 50;
const BYTES_PER_KIBIBYTE = 1024;
const PER_TASK_OUTPUT_CAP = KIBIBYTES_PER_TASK * BYTES_PER_KIBIBYTE;
const TRUNCATION_NOTICE_RESERVE = 256;
const NO_OUTPUT = '(no output)';

export const emptyUsage = (): UsageStats => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 });

export function createUnstartedResult(agent: string, task: string, step: number | undefined, status: 'pending' | 'aborted' | 'failed', errorMessage?: string): SingleResult {
  return { agent, agentSource: 'unknown', task, status, exitCode: null, messages: [], stderr: '', usage: emptyUsage(), errorMessage, step };
}

export function getFinalOutput(messages: Message[]): string {
  for (const msg of messages.toReversed()) {
    if (msg.role !== 'assistant') continue;
    for (const part of msg.content) {
      if (part.type === 'text') return part.text;
    }
  }
  return '';
}

export function isFailedResult(result: SingleResult): boolean {
  return result.status === 'failed' || result.status === 'aborted';
}

export function isActiveResult(result: SingleResult): boolean {
  return result.status === 'pending' || result.status === 'running';
}

function getFailureEvidence(result: SingleResult): string {
  const entries: [string, string | undefined][] = [
    ['Error', result.errorMessage],
    ['Signal', result.terminationSignal],
    ['stderr', result.stderr],
    ['Assistant output', getFinalOutput(result.messages)],
  ];
  const evidence = entries.reduce<{ seen: string[]; lines: string[] }>(
    (acc, [label, value]) => {
      const text = value?.trim();
      if (!text || acc.seen.includes(text)) return acc;
      return { seen: [...acc.seen, text], lines: [...acc.lines, `${label}: ${text}`] };
    },
    { seen: [], lines: [] },
  );
  return evidence.lines.join('\n\n') || NO_OUTPUT;
}

export function getFailureSummary(result: SingleResult): string {
  return result.errorMessage?.trim() || (result.terminationSignal ? `Terminated by signal ${result.terminationSignal}` : '') || result.stderr.trim() || getFinalOutput(result.messages) || NO_OUTPUT;
}

export function getResultOutput(result: SingleResult): string {
  return isFailedResult(result) ? getFailureEvidence(result) : getFinalOutput(result.messages) || NO_OUTPUT;
}

export function truncateParallelOutput(output: string): string {
  const byteLength = Buffer.byteLength(output, 'utf8');
  if (byteLength <= PER_TASK_OUTPUT_CAP) return output;

  let truncated = output.slice(0, PER_TASK_OUTPUT_CAP);
  while (Buffer.byteLength(truncated, 'utf8') > PER_TASK_OUTPUT_CAP) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, 'utf8')} bytes omitted. Full output preserved in tool details.]`;
}

export function truncateModelOutput(output: string): string {
  const initial = truncateHead(output);
  if (!initial.truncated) return output;

  const body = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES - 2,
    maxBytes: DEFAULT_MAX_BYTES - TRUNCATION_NOTICE_RESERVE,
  });
  const omittedBytes = initial.totalBytes - body.outputBytes;
  const notice = `[Output truncated: ${omittedBytes} bytes omitted. Full output preserved in tool details.]`;
  return body.content ? `${body.content}\n\n${notice}` : notice;
}

/** A worker's text cut to `truncate`'s limit, then the note of where its kept worktree lives, so a long report never drops the note. */
export function formatResultText(result: SingleResult, text: string, truncate: (output: string) => string = truncateModelOutput): string {
  const body = truncate(text);
  return result.worktreeNote ? `${body}\n\n${result.worktreeNote}` : body;
}

export function getDisplayItems(messages: Message[]): DisplayItem[] {
  return messages.flatMap((msg): DisplayItem[] => {
    if (msg.role !== 'assistant') return [];
    return msg.content.flatMap((part): DisplayItem[] => {
      if (part.type === 'text') return [{ type: 'text', text: part.text }];
      if (part.type === 'toolCall') return [{ type: 'toolCall', name: part.name, args: part.arguments }];
      return [];
    });
  });
}

export function aggregateUsage(results: SingleResult[]): UsageStats {
  return results.reduce<UsageStats>(
    (total, { usage }) => ({
      input: total.input + usage.input,
      output: total.output + usage.output,
      cacheRead: total.cacheRead + usage.cacheRead,
      cacheWrite: total.cacheWrite + usage.cacheWrite,
      cost: total.cost + usage.cost,
      contextTokens: total.contextTokens,
      turns: total.turns + usage.turns,
    }),
    emptyUsage(),
  );
}

export type ToolResult = AgentToolResult<SubagentDetails>;

export const textResult = (text: string, details: SubagentDetails): ToolResult => ({ content: [{ type: 'text', text }], details });

export const makeDetails = (mode: SubagentMode, results: SingleResult[], forceError = false): SubagentDetails => ({ mode, results, isError: forceError || results.some(isFailedResult) });

/** A call's report: the text framed as untrusted output with the usage of every worker, and the workers as details. */
export const reportResult = (mode: SubagentMode, results: SingleResult[], text: string): ToolResult => textResult(frameSubagentReport(text, aggregateUsage(results)), makeDetails(mode, results));

/** A call that was turned away before any worker started. */
export const refusalResult = (mode: SubagentMode, text: string): ToolResult => textResult(text, makeDetails(mode, [], true));

/** The update a call streams while its workers run. */
export const progressResult = (mode: SubagentMode, results: SingleResult[], text: string): ToolResult => textResult(text, makeDetails(mode, results));

/** What a worker has said so far, or a note that it has said nothing yet. */
export const runningText = (result: SingleResult): string => getFinalOutput(result.messages) || '(running...)';
