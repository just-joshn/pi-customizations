import { formatReadLineRange } from '@earendil-works/pi-coding-agent';
import { countLines, headLines, type LineSlice, tailLines } from '../text.ts';

export interface Preview extends LineSlice {
  readonly tone: 'output' | 'error';
}
export interface ResultSummary {
  readonly meta: string | undefined;
  readonly preview: Preview | undefined;
}
export interface ToolArgs {
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
  readonly details: unknown;
  readonly isError: boolean;
  readonly isPartial: boolean;
}
export interface TargetText {
  readonly text: string;
  readonly kind: 'path' | 'plain';
}
export interface ToolSpec {
  readonly verb: string;
  target(args: ToolArgs | undefined, cwd: string): TargetText;
  summarize(input: ResultInput): ResultSummary;
}
export const RUNNING_TAIL_LINES = 3;
export const ERROR_PREVIEW_LINES = 5;
const HOME = process.env['HOME'] ?? process.env['USERPROFILE'];

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && key in value ? Reflect.get(value, key) : undefined;
}
function relPath(value: unknown, cwd: string): string {
  const path = str(value);
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  if (HOME && (path === HOME || path.startsWith(`${HOME}/`))) return `~${path.slice(HOME.length)}`;
  return path;
}
function pathTarget(args: ToolArgs | undefined, cwd: string): TargetText {
  return { kind: 'path', text: relPath(args?.path, cwd) };
}
function summary(meta: string): ResultSummary {
  return { meta, preview: undefined };
}
function checked(input: ResultInput, ok: () => ResultSummary): ResultSummary {
  return input.isError ? { meta: 'failed', preview: { ...headLines(input.text, ERROR_PREVIEW_LINES), tone: 'error' } } : ok();
}
function withoutNotice(text: string): string {
  const start = text.lastIndexOf('\n\n[');
  return start === -1 ? text : text.slice(0, start);
}
function listing(input: ResultInput, unit: string, limit: string, empty: string): ResultSummary {
  return checked(input, () => {
    const total = field(field(input.details, 'truncation'), 'totalLines');
    const count = input.text.startsWith(empty) ? 0 : typeof total === 'number' ? total : countLines(withoutNotice(input.text));
    return summary(`${count}${field(input.details, limit) ? '+' : ''} ${unit}`);
  });
}

export const TOOL_SPECS = {
  read: {
    verb: 'read',
    target: (args, cwd) => ({
      kind: 'path',
      text: relPath(args?.path, cwd) + formatReadLineRange(typeof args?.offset === 'number' ? args.offset : undefined, typeof args?.limit === 'number' ? args.limit : undefined),
    }),
    summarize: (input) =>
      checked(input, () => {
        const total = field(field(input.details, 'truncation'), 'totalLines');
        return summary(`${typeof total === 'number' ? total : countLines(withoutNotice(input.text))} lines`);
      }),
  },
  edit: {
    verb: 'edit',
    target: pathTarget,
    summarize: (input) =>
      checked(input, () => {
        const patch = str(field(input.details, 'patch'));
        let added = 0;
        let removed = 0;
        for (let start = 0; start < patch.length; ) {
          if (patch[start] === '+' && !patch.startsWith('+++', start)) added++;
          if (patch[start] === '-' && !patch.startsWith('---', start)) removed++;
          const end = patch.indexOf('\n', start);
          start = end === -1 ? patch.length : end + 1;
        }
        return patch ? summary(`+${added} −${removed}`) : summary('edited');
      }),
  },
  write: {
    verb: 'write',
    target: pathTarget,
    summarize: (input) => checked(input, () => summary(`${countLines(str(input.args.content))} lines`)),
  },
  bash: {
    verb: 'bash',
    target: (args) => {
      const command = str(args?.command);
      const end = command.indexOf('\n');
      return { kind: 'plain', text: (end === -1 ? command : command.slice(0, end)).replace(/\s+/g, ' ') + (end === -1 ? '' : '…') };
    },
    summarize: (input) => {
      if (input.isPartial) return { meta: undefined, preview: { ...tailLines(input.text, RUNNING_TAIL_LINES), tone: 'output' } };
      if (!input.isError) return summary('exit 0');
      const rawTail = input.text.slice(-200);
      const tail = rawTail.trimEnd();
      const exit = /Command exited with code (\d+)$/.exec(tail);
      const meta = exit ? `exit ${exit[1]}` : /Command timed out/.test(tail) ? 'timeout' : /Command aborted$/.test(tail) ? 'aborted' : 'failed';
      const status = /Command (?:exited with code \d+|timed out[^\n]*|aborted)$/.exec(tail);
      const text = status ? input.text.slice(0, input.text.length - rawTail.length + status.index).trimEnd() : input.text;
      return { meta, preview: { ...tailLines(text, ERROR_PREVIEW_LINES), tone: 'error' } };
    },
  },
  grep: {
    verb: 'grep',
    target: (args) => ({ kind: 'plain', text: str(args?.pattern) + (typeof args?.path === 'string' ? `  ${args.path}` : '') }),
    summarize: (input) => (input.text === 'No matches found' && !input.isError ? summary('no matches') : listing(input, 'matches', 'matchLimitReached', 'No matches found')),
  },
  find: {
    verb: 'find',
    target: (args) => ({ kind: 'plain', text: str(args?.pattern) }),
    summarize: (input) => listing(input, 'files', 'resultLimitReached', 'No files found'),
  },
  ls: {
    verb: 'ls',
    target: (args, cwd) => pathTarget({ path: args?.path ?? '.' }, cwd),
    summarize: (input) => listing(input, 'entries', 'entryLimitReached', '(empty directory)'),
  },
} satisfies Record<string, ToolSpec>;

export type CompactToolName = keyof typeof TOOL_SPECS;
export const VERB_COLUMN = Math.max(...Object.values(TOOL_SPECS).map((spec) => spec.verb.length));
export function isCompactTool(name: string): name is CompactToolName {
  return Object.hasOwn(TOOL_SPECS, name);
}
