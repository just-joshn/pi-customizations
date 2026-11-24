import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolBridgeCall } from './types.ts';

/** Arguments the CLI sent, after the boundary check that they are one object. */
type Fields = Readonly<Record<string, unknown>>;

const UNKNOWN_CALL_ID = 'unknown';

interface TextEdit {
  readonly oldText: string;
  readonly newText: string;
}

interface BridgeEntry {
  readonly agyTool: string;
  readonly piTool: string;
  readonly build: (fields: Fields) => Record<string, unknown> | undefined;
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !isList(value);
}

function nonEmpty(fields: Fields, key: string): string | undefined {
  const value = fields[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(fields: Fields, key: string): number | undefined {
  const value = fields[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(fields: Fields, key: string): boolean | undefined {
  const value = fields[key];
  return typeof value === 'boolean' ? value : undefined;
}

function withField(args: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  return value === undefined ? args : { ...args, [key]: value };
}

/**
 * `EndLine` is inclusive. Pi's `limit` is a count of lines, so a span becomes
 * `EndLine - StartLine + 1`. An end with no start reads from the first line.
 */
function readLimit(start: number | undefined, end: number | undefined): number | undefined {
  if (end === undefined) return undefined;
  if (start === undefined) return end;
  if (end < start) return undefined;
  return end - start + 1;
}

function buildRead(fields: Fields): Record<string, unknown> | undefined {
  const path = nonEmpty(fields, 'AbsolutePath');
  if (path === undefined) return undefined;
  const start = numberField(fields, 'StartLine');
  const end = numberField(fields, 'EndLine');
  const limit = readLimit(start, end);
  if (start !== undefined && end !== undefined && limit === undefined) return undefined;
  return withField(withField({ path }, 'offset', start), 'limit', limit);
}

function buildWrite(fields: Fields): Record<string, unknown> | undefined {
  const path = nonEmpty(fields, 'TargetFile');
  const content = fields['CodeContent'];
  // Appending would replace the file. Pi's write tool has no append mode.
  if (path === undefined || typeof content !== 'string' || booleanField(fields, 'Append') === true) return undefined;
  return { path, content };
}

function replacementEdit(value: unknown): TextEdit | undefined {
  if (!isFields(value)) return undefined;
  const oldText = nonEmpty(value, 'TargetContent');
  const newText = value['ReplacementContent'];
  if (oldText === undefined || typeof newText !== 'string') return undefined;
  return { oldText, newText };
}

function replacementEdits(value: unknown): readonly TextEdit[] | undefined {
  if (!isList(value) || value.length === 0) return undefined;
  const edits = value.flatMap((item) => {
    const edit = replacementEdit(item);
    return edit === undefined ? [] : [edit];
  });
  return edits.length === value.length ? edits : undefined;
}

function buildReplace(fields: Fields): Record<string, unknown> | undefined {
  const path = nonEmpty(fields, 'TargetFile');
  const edit = replacementEdit(fields);
  if (path === undefined || edit === undefined) return undefined;
  return { path, edits: [edit] };
}

function buildMultiReplace(fields: Fields): Record<string, unknown> | undefined {
  const path = nonEmpty(fields, 'TargetFile');
  const edits = replacementEdits(fields['ReplacementChunks']);
  if (path === undefined || edits === undefined) return undefined;
  return { path, edits: [...edits] };
}

/** Compare two directory paths the way the filesystem does, following symlinks when they exist. */
function sameDirectory(left: string, right: string): boolean {
  const canonical = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      // A path that does not exist yet is compared as written.
      return resolve(path);
    }
  };
  return canonical(left) === canonical(right);
}

function buildBash(fields: Fields): Record<string, unknown> | undefined {
  const command = nonEmpty(fields, 'CommandLine');
  if (command === undefined) return undefined;
  // Pi's bash tool has no working-directory argument, and rewriting `Cwd` into a
  // `cd` would change the command the model wrote. A command aimed somewhere else
  // is refused rather than run in the wrong directory.
  const cwd = nonEmpty(fields, 'Cwd');
  if (cwd !== undefined && !sameDirectory(cwd, process.cwd())) return undefined;
  return { command };
}

function singleGlob(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (!isList(value) || value.length !== 1) return undefined;
  const only = value[0];
  return typeof only === 'string' && only.length > 0 ? only : undefined;
}

function buildGrep(fields: Fields): Record<string, unknown> | undefined {
  const pattern = nonEmpty(fields, 'Query');
  if (pattern === undefined) return undefined;
  const withPath = withField({ pattern }, 'path', nonEmpty(fields, 'SearchPath'));
  const withCase = booleanField(fields, 'CaseInsensitive') === true ? { ...withPath, ignoreCase: true } : withPath;
  const withLiteral = booleanField(fields, 'IsRegex') === false ? { ...withCase, literal: true } : withCase;
  return withField(withLiteral, 'glob', singleGlob(fields['Includes']));
}

function buildFind(fields: Fields): Record<string, unknown> | undefined {
  const pattern = nonEmpty(fields, 'Pattern');
  if (pattern === undefined) return undefined;
  return withField({ pattern }, 'path', nonEmpty(fields, 'SearchDirectory'));
}

function buildList(fields: Fields): Record<string, unknown> | undefined {
  const path = nonEmpty(fields, 'DirectoryPath');
  return path === undefined ? undefined : { path };
}

/**
 * CLI tool name to the Pi tool that executes it.
 * The first entry for a Pi tool is the name `agyToolFor` tells the model to call.
 */
const BRIDGE: readonly BridgeEntry[] = [
  { agyTool: 'view_file', piTool: 'read', build: buildRead },
  { agyTool: 'write_to_file', piTool: 'write', build: buildWrite },
  { agyTool: 'replace_file_content', piTool: 'edit', build: buildReplace },
  { agyTool: 'multi_replace_file_content', piTool: 'edit', build: buildMultiReplace },
  // `sed_file` is deliberately absent: sed's global, addressed, and ordered
  // replacements do not collapse onto one unique old/new pair, and an
  // approximate edit could rewrite the wrong occurrence.
  { agyTool: 'run_command', piTool: 'bash', build: buildBash },
  { agyTool: 'grep_search', piTool: 'grep', build: buildGrep },
  { agyTool: 'find_by_name', piTool: 'find', build: buildFind },
  { agyTool: 'list_dir', piTool: 'ls', build: buildList },
];

const BRIDGE_BY_NAME = new Map(BRIDGE.map((entry) => [entry.agyTool, entry]));

export const BRIDGED_TOOLS: readonly string[] = BRIDGE.flatMap((entry, index) => (BRIDGE.findIndex((other) => other.piTool === entry.piTool) === index ? [entry.piTool] : []));

/** The CLI tool the model should call for this Pi tool. Undefined when this extension cannot serve it. */
export function agyToolFor(piToolName: string): string | undefined {
  return BRIDGE.find((entry) => entry.piTool === piToolName)?.agyTool;
}

/** Translate a CLI tool request into a Pi tool call. Returns undefined when no Pi tool can serve it. */
export function bridgeToolCall(input: BridgeInput, declared: ReadonlySet<string>): ToolBridgeCall | undefined {
  const entry = BRIDGE_BY_NAME.get(input.name);
  if (entry === undefined || !declared.has(entry.piTool) || !isFields(input.rawInput)) return undefined;
  const args = entry.build(input.rawInput);
  if (args === undefined) return undefined;
  return { piTool: entry.piTool, arguments: args, agyTool: entry.agyTool, callId: input.callId ?? UNKNOWN_CALL_ID };
}

export interface BridgeInput {
  /** The CLI's canonical tool name, for example `run_command`. */
  name: string;
  /** The arguments the model produced, in the CLI's own field names. */
  rawInput: unknown;
  /** The CLI-side call id, when it sent one. */
  callId: string | undefined;
}
