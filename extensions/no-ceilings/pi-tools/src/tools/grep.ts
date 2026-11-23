import { stat } from 'node:fs/promises';
import path from 'node:path';

import { Type } from 'typebox';
import { GREP_TIMEOUT_MS, MAX_GREP_OUTPUT_BYTES, MAX_GREP_OUTPUT_LINES, MAX_GREP_RESULT_LINES, MAX_GREP_RESULT_WINDOW_LINES } from '../constants.ts';
import { layerError } from '../core/errors.ts';
import { displayPath, isInside, relativeTo, resolveToolPath, toPosix } from '../core/paths.ts';
import { streamLines } from '../core/proc.ts';
import { PATH_ALIASES, prepareWith } from '../core/repair.ts';
import { allowedPaths, assertSearchable, BASE_RG_ARGS, ensureRipgrep, truncateMatchedLine } from '../core/search.ts';
import type { LayerContext } from '../core/session.ts';
import { guardSearch, type LayerSession, subjectsFor } from '../core/session.ts';
import { guarded } from '../core/tool.ts';
import type { ToolFailure, ToolOutcome } from '../types.ts';

export const grepParameters = Type.Object({
  pattern: Type.String({ description: 'Search pattern (regular expression unless literal is true)' }),
  path: Type.Optional(Type.String({ description: 'File or directory to search (default: current directory). Absolute paths may point outside the workspace.' })),
  glob: Type.Optional(Type.String({ description: "Restrict the search to files matching this glob, e.g. '*.ts'. Prefix with ! to exclude." })),
  outputMode: Type.Optional(Type.Union([Type.Literal('content'), Type.Literal('files'), Type.Literal('count')], { description: 'content lists matching lines (default), files lists paths, count lists per-file counts' })),
  ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive search (default: false)' })),
  literal: Type.Optional(Type.Boolean({ description: 'Treat the pattern as a literal string (default: false)' })),
  context: Type.Optional(Type.Number({ description: 'Lines of context before and after each match (default: 0)' })),
  contextBefore: Type.Optional(Type.Number({ description: 'Lines of context before each match' })),
  contextAfter: Type.Optional(Type.Number({ description: 'Lines of context after each match' })),
  limit: Type.Optional(Type.Number({ description: `Maximum number of results to return (default: ${MAX_GREP_RESULT_LINES})` })),
  offset: Type.Optional(Type.Number({ description: 'Results to skip before returning any' })),
  multiline: Type.Optional(Type.Boolean({ description: 'Let the pattern match across line boundaries (default: false)' })),
  type: Type.Optional(Type.String({ description: "Restrict to a ripgrep file type, e.g. 'ts'" })),
  timeoutMs: Type.Optional(Type.Number({ description: `Search budget in milliseconds (default: ${GREP_TIMEOUT_MS}). Partial results are returned when it expires.` })),
});

interface GrepParams {
  pattern: string;
  path?: string;
  glob?: string;
  outputMode?: 'content' | 'files' | 'count';
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  contextBefore?: number;
  contextAfter?: number;
  limit?: number;
  offset?: number;
  multiline?: boolean;
  type?: string;
  timeoutMs?: number;
}

export interface GrepLineMatch {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly isContext: boolean;
  readonly truncated: boolean;
}

export interface GrepFileCount {
  readonly file: string;
  readonly count: number;
}

export type GrepMode = 'content' | 'files' | 'count';

export interface GrepDetails {
  readonly mode?: GrepMode;
  readonly matches?: readonly GrepLineMatch[];
  readonly files?: readonly string[];
  readonly counts?: readonly GrepFileCount[];
  readonly total?: number;
  readonly truncated?: boolean;
  readonly limitReached?: boolean;
  readonly timedOut?: boolean;
  readonly offsetApplied?: number;
  readonly linesTruncated?: boolean;
  readonly failure?: ToolFailure;
}

export interface GrepToolOptions {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
  /** Runner override, used by tests to simulate caps and timeouts. */
  readonly run?: typeof streamLines;
}

/** One `rg --json` record. Path and line text may arrive as base64 bytes for non-UTF-8 data. */
interface RgEvent {
  readonly type?: string;
  readonly data?: {
    readonly path?: { readonly text?: string; readonly bytes?: string };
    readonly line_number?: number;
    readonly lines?: { readonly text?: string; readonly bytes?: string };
  };
}

function decodeText(value: { readonly text?: string; readonly bytes?: string } | undefined): string {
  if (typeof value?.text === 'string') {
    return value.text;
  }
  if (typeof value?.bytes === 'string') {
    return Buffer.from(value.bytes, 'base64').toString('utf-8');
  }
  return '';
}

function clampCount(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(max, Math.floor(value)));
}

function buildArgs(params: GrepParams, mode: GrepMode, root: string): string[] {
  const args: string[] = [...BASE_RG_ARGS, '--follow'];
  if (mode === 'content') {
    args.push('--json');
    const before = params.contextBefore ?? params.context ?? 0;
    const after = params.contextAfter ?? params.context ?? 0;
    if (before > 0) {
      args.push('--before-context', String(clampCount(before, 0, 1000)));
    }
    if (after > 0) {
      args.push('--after-context', String(clampCount(after, 0, 1000)));
    }
  } else if (mode === 'files') {
    args.push('--files-with-matches');
  } else {
    args.push('--count', '--with-filename');
  }
  args.push(params.ignoreCase === true ? '--ignore-case' : '--case-sensitive');
  if (params.literal === true) {
    args.push('--fixed-strings');
  }
  if (params.multiline === true) {
    args.push('--multiline', '--multiline-dotall');
  }
  if (params.glob !== undefined && params.glob.trim() !== '') {
    args.push('--iglob', params.glob.trim());
  }
  if (params.type !== undefined && params.type.trim() !== '') {
    args.push('--type', params.type.trim());
  }
  args.push('--regexp', params.pattern, '--', root);
  return args;
}

async function requireSearchRoot(root: string, cwd: string): Promise<void> {
  try {
    await stat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw layerError('file_not_found', `Path does not exist: ${displayPath(cwd, root)}`, { path: root });
    }
    throw error;
  }
}

function absoluteFor(root: string, contextCwd: string, raw: string): string {
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(contextCwd, raw.startsWith('./') ? raw : path.join(root, raw));
}

function displayFor(root: string, absolute: string): string {
  if (path.resolve(root) === path.resolve(absolute)) {
    return toPosix(path.basename(absolute));
  }
  return isInside(root, absolute) ? relativeTo(root, absolute) : toPosix(absolute);
}

interface RawMatch {
  readonly absolute: string;
  readonly line: number;
  readonly text: string;
  readonly isContext: boolean;
  readonly truncated: boolean;
}

export function createGrepLayerTool(options: GrepToolOptions) {
  return {
    name: 'grep',
    label: 'grep',
    description:
      'Search file contents for a pattern. Returns matching lines with file paths and line numbers, or file paths, or per-file counts. Respects .gitignore, .ignore, .piignore, and nested ignore files; drops paths the permission policy denies, including paths reached through a symlink. Result count, output bytes, line width, and time are all capped, and an expired time budget returns partial results.',
    promptSnippet: 'Search file contents by regex with capped results and partial results on timeout',
    promptGuidelines: ['Use grep to search contents; set literal when the pattern contains regex metacharacters.'],
    prepareArguments: prepareWith({
      aliases: { ...PATH_ALIASES, query: 'pattern', search_pattern: 'pattern' },
      numbers: ['limit', 'offset', 'context', 'contextBefore', 'contextAfter', 'timeoutMs'],
      booleans: ['ignoreCase', 'literal', 'multiline'],
      strings: ['pattern'],
    }),
    parameters: grepParameters,
    execute: guarded<GrepParams, GrepDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx, signal }): Promise<ToolOutcome<GrepDetails>> => {
        const session = await options.session(ctx);
        const mode: GrepMode = params.outputMode ?? 'content';
        const root = resolveToolPath(params.path ?? '.', ctx.cwd, session.home);
        const subjects = await subjectsFor(root);
        await guardSearch(session, subjects);
        await requireSearchRoot(root, ctx.cwd);
        await assertSearchable(session, subjects, ctx.cwd);
        if (params.pattern === '') {
          throw layerError('invalid_arguments', 'pattern must not be empty', { hint: 'Pass a regex or set literal with a non-empty string.' });
        }

        const limit = Math.max(1, Math.min(MAX_GREP_RESULT_LINES, Math.floor(params.limit ?? MAX_GREP_RESULT_LINES)));
        const requestedOffset = Math.floor(params.offset ?? 0);
        if (requestedOffset > MAX_GREP_RESULT_LINES) {
          throw layerError('invalid_arguments', `offset ${requestedOffset} is beyond the ${MAX_GREP_RESULT_LINES} result window`, {
            hint: 'Refine the pattern or the path instead of paginating past the window.',
          });
        }
        const offset = clampCount(params.offset, 0, MAX_GREP_RESULT_LINES);
        const timeoutMs = Math.max(100, Math.min(120_000, Math.floor(params.timeoutMs ?? GREP_TIMEOUT_MS)));
        const binary = ensureRipgrep(session.agentDir);
        const args = buildArgs(params, mode, root);
        const runner = options.run ?? streamLines;
        const contextLines = Math.max(params.contextBefore ?? params.context ?? 0, params.contextAfter ?? params.context ?? 0);
        const keepLines = Math.min(MAX_GREP_RESULT_WINDOW_LINES, (limit + offset + 1) * (mode === 'content' ? (contextLines > 0 ? 6 : 4) : 1));
        const run = await runner(binary, args, {
          cwd: ctx.cwd,
          ...(signal === undefined ? {} : { signal }),
          timeoutMs,
          maxLines: Math.max(MAX_GREP_OUTPUT_LINES, keepLines),
          keepLines,
          maxBytes: MAX_GREP_OUTPUT_BYTES,
        });

        const fatal = !run.timedOut && run.exitCode !== 0 && run.exitCode !== 1 && run.stderr !== '';
        if (fatal) {
          const firstLine = run.stderr.split('\n').find((line) => line.trim() !== '') ?? `ripgrep exited with code ${run.exitCode}`;
          throw layerError('error', firstLine, {
            ...(params.pattern.includes('(') || params.pattern.includes('[') ? { hint: 'The pattern is a regular expression; check its syntax or set literal to true.' } : {}),
          });
        }

        let linesTruncated = false;
        const rawMatches: RawMatch[] = [];
        const rawFiles: string[] = [];
        const rawCounts: { readonly absolute: string; readonly count: number }[] = [];

        for (const line of run.lines) {
          if (line.trim() === '') {
            continue;
          }
          if (mode === 'content') {
            let event: RgEvent;
            try {
              event = JSON.parse(line) as RgEvent;
            } catch {
              continue;
            }
            if (event.type !== 'match' && event.type !== 'context') {
              continue;
            }
            const rawPath = decodeText(event.data?.path);
            const lineNumber = event.data?.line_number;
            if (rawPath === '' || typeof lineNumber !== 'number') {
              continue;
            }
            const text = decodeText(event.data?.lines).replace(/\r?\n$/, '');
            const cut = truncateMatchedLine(text);
            linesTruncated ||= cut.truncated;
            rawMatches.push({ absolute: absoluteFor(root, ctx.cwd, rawPath), line: lineNumber, text: cut.text, isContext: event.type === 'context', truncated: cut.truncated });
          } else if (mode === 'files') {
            rawFiles.push(absoluteFor(root, ctx.cwd, line.trim()));
          } else {
            const index = line.lastIndexOf(':');
            if (index <= 0) {
              continue;
            }
            const count = Number(line.slice(index + 1));
            if (!Number.isFinite(count)) {
              continue;
            }
            rawCounts.push({ absolute: absoluteFor(root, ctx.cwd, line.slice(0, index)), count });
          }
        }

        const allowed = await allowedPaths(session, [...rawMatches.map((match) => match.absolute), ...rawFiles, ...rawCounts.map((entry) => entry.absolute)], root);
        const matches = rawMatches.filter((match) => allowed.has(match.absolute)).map((match) => ({ file: displayFor(root, match.absolute), line: match.line, text: match.text, isContext: match.isContext, truncated: match.truncated }));
        const files = rawFiles.filter((file) => allowed.has(file)).map((file) => displayFor(root, file));
        const counts = rawCounts.filter((entry) => allowed.has(entry.absolute)).map((entry) => ({ file: displayFor(root, entry.absolute), count: entry.count }));

        const noticesFor = (limitReached: boolean, keptCount: number): string[] => {
          const notices: string[] = [];
          if (limitReached) {
            notices.push(`${limit} results limit reached. Refine the pattern, raise limit, or continue with offset=${offset + keptCount}`);
          }
          if (run.timedOut) {
            notices.push(`search timed out after ${timeoutMs}ms; results are partial`);
          }
          if (run.truncated && !run.timedOut && !run.limitReached) {
            notices.push('output truncated at the search output cap');
          }
          if (linesTruncated) {
            notices.push('some lines truncated; use read on the file to see them in full');
          }
          if (run.truncated || run.limitReached) {
            notices.push('counts cover matches seen before the output cap');
          }
          return notices;
        };
        const withNotices = (body: string, notices: readonly string[]): string => (notices.length === 0 ? body : `${body}\n\n[${notices.join('. ')}]`);
        const truncatedFlags = (limitReached: boolean): Omit<GrepDetails, 'mode' | 'total'> => ({
          ...(limitReached || run.timedOut || run.truncated ? { truncated: true } : {}),
          ...(limitReached ? { limitReached: true } : {}),
          ...(run.timedOut ? { timedOut: true } : {}),
          ...(offset > 0 ? { offsetApplied: offset } : {}),
          ...(linesTruncated ? { linesTruncated: true } : {}),
        });
        const emptyOutcome = (): ToolOutcome<GrepDetails> => {
          const notices: string[] = [];
          if (run.limitReached) {
            notices.push(`output limit reached after ${run.totalLines} lines`);
          }
          if (run.timedOut) {
            notices.push(`search timed out after ${timeoutMs}ms before finding a match`);
          }
          if (run.truncated && !run.timedOut && !run.limitReached) {
            notices.push('output truncated at the search output cap');
          }
          const text = notices.length === 0 ? 'No matches found' : `No matches found\n\n[${notices.join('. ')}]`;
          return { content: [{ type: 'text', text }], details: { mode, total: 0, ...truncatedFlags(false) } };
        };

        if (mode === 'content') {
          const sliced = matches.slice(offset);
          const kept = sliced.slice(0, limit);
          const limitReached = sliced.length > kept.length;
          if (matches.length === 0 || matches.slice(offset).length === 0) {
            return emptyOutcome();
          }
          const body = kept.map((match) => `${match.file}${match.isContext ? '-' : ':'}${match.line}${match.isContext ? '-' : ':'} ${match.text}`).join('\n');
          return {
            content: [{ type: 'text', text: withNotices(body, noticesFor(limitReached, kept.length)) }],
            details: { mode: 'content', matches: kept, total: matches.length, ...truncatedFlags(limitReached) },
            structuredContent: {
              mode: 'content',
              total: matches.length,
              truncated: limitReached || run.timedOut || run.truncated,
              matches: kept.map((match) => ({ file: match.file, line: match.line, text: match.text, context: match.isContext })),
            },
          };
        }

        if (mode === 'files') {
          const sliced = files.slice(offset);
          const kept = sliced.slice(0, limit);
          const limitReached = sliced.length > kept.length;
          if (files.length === 0) {
            return emptyOutcome();
          }
          if (sliced.length === 0) {
            return emptyOutcome();
          }
          return {
            content: [{ type: 'text', text: withNotices(kept.join('\n'), noticesFor(limitReached, kept.length)) }],
            details: { mode: 'files', files: kept, total: files.length, ...truncatedFlags(limitReached) },
            structuredContent: { mode: 'files', total: files.length, truncated: limitReached || run.timedOut || run.truncated, files: [...kept] },
          };
        }

        const sliced = counts.slice(offset);
        const kept = sliced.slice(0, limit);
        const limitReached = sliced.length > kept.length;
        if (counts.length === 0 || counts.slice(offset).length === 0) {
          return emptyOutcome();
        }
        const matchesTotal = kept.reduce((sum, entry) => sum + entry.count, 0);
        const body = `${kept.map((entry) => `${entry.file}:${entry.count}`).join('\n')}\n\n[${matchesTotal} matches in ${kept.length} files]`;
        return {
          content: [{ type: 'text', text: withNotices(body, noticesFor(limitReached, kept.length)) }],
          details: { mode: 'count', counts: kept, total: counts.length, ...truncatedFlags(limitReached) },
          structuredContent: { mode: 'count', total: counts.length, truncated: limitReached || run.timedOut || run.truncated, counts: kept.map((entry) => ({ file: entry.file, count: entry.count })), matches: matchesTotal },
        };
      },
      (params) => params.path,
    ),
  };
}
