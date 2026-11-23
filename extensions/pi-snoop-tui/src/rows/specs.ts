import { homedir } from 'node:os';

import { formatReadLineRange } from '@earendil-works/pi-coding-agent';
import { countLines, headLines, tailLines } from '../text.ts';
import type { Preview, TargetText } from './view.ts';

export interface ResultSummary {
  readonly meta: string | undefined;
  readonly preview: Preview | undefined;
}
export interface ToolArgs {
  [key: string]: unknown;
  path?: unknown;
  offset?: unknown;
  limit?: unknown;
  pattern?: unknown;
  command?: unknown;
  content?: unknown;
}
export interface ResultInput {
  readonly args: ToolArgs;
  readonly text: string;
  readonly images: number;
  readonly details: unknown;
  readonly isError: boolean;
  readonly isPartial: boolean;
}
export interface ToolSpec {
  readonly verb: string;
  target(args: ToolArgs, cwd: string): TargetText;
  summarize(input: ResultInput): ResultSummary;
}
export const RUNNING_TAIL_LINES = 3;
export const ERROR_PREVIEW_LINES = 5;
const STATUS_TAIL_CHARS = 200;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && key in value ? Reflect.get(value, key) : undefined;
}
function relPath(value: unknown, cwd: string): string {
  const path = str(value);
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  const home = homedir();
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}
function pathTarget(args: ToolArgs, cwd: string): TargetText {
  return { kind: 'path', text: relPath(args.path, cwd) };
}
/** The exit status a failed command reports on its last line, such as `exit 2`. */
function parseExit(text: string): string | undefined {
  const code = /exit(?:ed with)? code (\d+)\s*$/i.exec(text.slice(-STATUS_TAIL_CHARS))?.[1];
  return code === undefined ? undefined : `exit ${code}`;
}
function totalLines(details: unknown): number | undefined {
  const total = field(field(details, 'truncation'), 'totalLines');
  return typeof total === 'number' ? total : undefined;
}
function firstLine(text: string): string {
  const end = text.indexOf('\n');
  return (end === -1 ? text : text.slice(0, end)).replace(/\s+/g, ' ') + (end === -1 ? '' : '…');
}
function summary(meta: string): ResultSummary {
  return { meta, preview: undefined };
}
function failed(input: ResultInput, meta = 'failed'): ResultSummary {
  return { meta, preview: { ...headLines(input.text, ERROR_PREVIEW_LINES), tone: 'error', from: 'head' } };
}
function checked(input: ResultInput, ok: () => ResultSummary): ResultSummary {
  return input.isError ? failed(input) : ok();
}
function withoutNotice(text: string): string {
  const start = text.lastIndexOf('\n\n[');
  return start === -1 ? text : text.slice(0, start);
}
function units(count: number, unit: 'line' | 'match' | 'file' | 'entry', limited = false): string {
  const plurals = { line: 'lines', match: 'matches', file: 'files', entry: 'entries' };
  return `${count}${limited ? '+' : ''} ${count === 1 ? unit : plurals[unit]}`;
}
function countPatchLines(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (let start = 0; start < patch.length;) {
    if (patch[start] === '+' && !patch.startsWith('+++', start)) added++;
    if (patch[start] === '-' && !patch.startsWith('---', start)) removed++;
    const end = patch.indexOf('\n', start);
    start = end === -1 ? patch.length : end + 1;
  }
  return { added, removed };
}
function listing(input: ResultInput, unit: 'match' | 'file' | 'entry', limit: string, empty: string): ResultSummary {
  return checked(input, () => {
    const count = input.text.startsWith(empty) ? 0 : (totalLines(input.details) ?? countLines(withoutNotice(input.text)));
    return summary(units(count, unit, Boolean(field(input.details, limit))));
  });
}
function bashFailure(input: ResultInput): ResultSummary {
  const rawTail = input.text.slice(-STATUS_TAIL_CHARS);
  const tail = rawTail.trimEnd();
  const meta = parseExit(input.text) ?? (/Command timed out/.test(tail) ? 'timeout' : /Command aborted$/.test(tail) ? 'aborted' : 'failed');
  const status = /Command (?:exited with code \d+|timed out[^\n]*|aborted)$/.exec(tail);
  const text = status ? input.text.slice(0, input.text.length - rawTail.length + status.index).trimEnd() : input.text;
  return { meta, preview: { ...tailLines(text, ERROR_PREVIEW_LINES), tone: 'error', from: 'tail' } };
}

export const TOOL_SPECS = {
  read: {
    verb: 'read',
    target: (args, cwd) => ({
      kind: 'path',
      text: relPath(args.path, cwd) + formatReadLineRange(typeof args.offset === 'number' ? args.offset : undefined, typeof args.limit === 'number' ? args.limit : undefined),
    }),
    summarize: (input) =>
      checked(input, () => {
        if (input.images > 0) return summary('image');
        return summary(units(totalLines(input.details) ?? countLines(withoutNotice(input.text)), 'line'));
      }),
  },
  edit: {
    verb: 'edit',
    target: pathTarget,
    summarize: (input) =>
      checked(input, () => {
        const patch = str(field(input.details, 'patch'));
        const { added, removed } = countPatchLines(patch);
        return patch ? summary(`+${added} −${removed}`) : summary('edited');
      }),
  },
  write: {
    verb: 'write',
    target: pathTarget,
    summarize: (input) => checked(input, () => summary(units(countLines(str(input.args.content)), 'line'))),
  },
  bash: {
    verb: 'bash',
    target: (args) => ({ kind: 'plain', text: firstLine(str(args.command)) }),
    summarize: (input) => {
      if (input.isPartial) return { meta: undefined, preview: { ...tailLines(input.text, RUNNING_TAIL_LINES), tone: 'output', from: 'tail' } };
      return input.isError ? bashFailure(input) : summary('exit 0');
    },
  },
  grep: {
    verb: 'grep',
    target: (args) => ({ kind: 'plain', text: str(args.pattern) + (typeof args.path === 'string' ? `  ${args.path}` : '') }),
    summarize: (input) => (input.text === 'No matches found' && !input.isError ? summary('no matches') : listing(input, 'match', 'matchLimitReached', 'No matches found')),
  },
  find: {
    verb: 'find',
    target: (args) => ({ kind: 'plain', text: str(args.pattern) }),
    summarize: (input) => listing(input, 'file', 'resultLimitReached', 'No files found'),
  },
  ls: {
    verb: 'ls',
    target: (args, cwd) => pathTarget({ path: args.path ?? '.' }, cwd),
    summarize: (input) => listing(input, 'entry', 'entryLimitReached', '(empty directory)'),
  },
} satisfies Record<string, ToolSpec>;

export type CompactToolName = keyof typeof TOOL_SPECS;
export function isCompactTool(name: string): name is CompactToolName {
  return Object.hasOwn(TOOL_SPECS, name);
}

const TARGET_KEYS = ['command', 'path', 'code', 'brief', 'name', 'query', 'url'];

export function genericSpec(toolName: string): ToolSpec {
  return {
    verb: toolName,
    target: (args, cwd) => {
      const key = TARGET_KEYS.find((name) => typeof args[name] === 'string') ?? Object.keys(args).find((name) => typeof args[name] === 'string');
      const value = key === undefined ? '' : str(args[key]);
      return key === 'path' ? { kind: 'path', text: relPath(value, cwd) } : { kind: 'plain', text: firstLine(value) };
    },
    summarize: (input) => {
      if (input.isPartial) return { meta: undefined, preview: undefined };
      if (input.isError) return failed(input, parseExit(input.text) ?? 'failed');
      return summary(input.images > 0 ? 'image' : units(countLines(input.text), 'line'));
    },
  };
}
