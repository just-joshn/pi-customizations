import { stat } from 'node:fs/promises';
import path from 'node:path';

import { Type } from 'typebox';
import { GLOB_DEFAULT_LIMIT, GLOB_MAX_LIMIT, GREP_TIMEOUT_MS } from '../constants.ts';
import { layerError } from '../core/errors.ts';
import { displayPath, isInside, relativeTo, resolveToolPath, toPosix } from '../core/paths.ts';
import { streamLines } from '../core/proc.ts';
import { PATH_ALIASES, prepareWith } from '../core/repair.ts';
import { allowedPaths, assertSearchable, BASE_RG_ARGS, ensureRipgrep } from '../core/search.ts';
import type { LayerContext } from '../core/session.ts';
import { guardSearch, type LayerSession, subjectsFor } from '../core/session.ts';
import { guarded } from '../core/tool.ts';
import type { ToolFailure, ToolOutcome } from '../types.ts';

export const globParameters = Type.Object({
  pattern: Type.String({ description: "Glob pattern, e.g. 'src/**/*.ts'. A pattern without '/' matches file names at any depth." }),
  path: Type.Optional(Type.String({ description: 'Directory to search in (default: current directory)' })),
  limit: Type.Optional(Type.Number({ description: `Maximum number of files to return (default: ${GLOB_DEFAULT_LIMIT}, maximum: ${GLOB_MAX_LIMIT})` })),
  timeoutMs: Type.Optional(Type.Number({ description: `Search budget in milliseconds (default: ${GREP_TIMEOUT_MS}). Partial results are returned when it expires.` })),
});

interface GlobParams {
  pattern: string;
  path?: string;
  limit?: number;
  timeoutMs?: number;
}

export interface GlobDetails {
  readonly files?: readonly string[];
  readonly count?: number;
  readonly truncated?: boolean;
  readonly limitReached?: boolean;
  readonly timedOut?: boolean;
  readonly failure?: ToolFailure;
}

export interface GlobToolOptions {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
  /** Runner override, used by tests to simulate caps and timeouts. */
  readonly run?: typeof streamLines;
}

/** Search root that is definitely a directory or a regular file. */
async function requireExistingSearchRoot(root: string, cwd: string): Promise<void> {
  try {
    await stat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw layerError('file_not_found', `Path does not exist: ${displayPath(cwd, root)}`, { path: root });
    }
    throw error;
  }
}

export function createGlobLayerTool(options: GlobToolOptions) {
  return {
    name: 'find',
    label: 'find',
    description:
      'Find files by glob pattern (the glob tool). Respects .gitignore, .ignore, .piignore, and nested ignore files, and drops paths the permission policy denies, including paths reached through a symlink. Returns paths relative to the search directory. A search that exceeds its time budget returns partial results.',
    promptSnippet: 'Find files by glob pattern with ignore and permission filtering',
    promptGuidelines: ['Use find to locate files by name or path pattern; use grep to search file contents.'],
    prepareArguments: prepareWith({ aliases: { ...PATH_ALIASES, glob_pattern: 'pattern', globPattern: 'pattern' }, numbers: ['limit', 'timeoutMs'] }),
    parameters: globParameters,
    execute: guarded<GlobParams, GlobDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx, signal }): Promise<ToolOutcome<GlobDetails>> => {
        const session = await options.session(ctx);
        const root = resolveToolPath(params.path ?? '.', ctx.cwd, session.home);
        const subjects = await subjectsFor(root);
        await guardSearch(session, subjects);
        await requireExistingSearchRoot(root, ctx.cwd);
        await assertSearchable(session, subjects, ctx.cwd);

        const limit = Math.max(1, Math.min(GLOB_MAX_LIMIT, Math.floor(params.limit ?? GLOB_DEFAULT_LIMIT)));
        const timeoutMs = Math.max(100, Math.min(120_000, Math.floor(params.timeoutMs ?? GREP_TIMEOUT_MS)));
        const pattern = params.pattern.trim();
        if (pattern === '') {
          throw layerError('invalid_arguments', 'pattern must not be empty', { hint: 'Pass a glob such as "**/*.ts".' });
        }
        const binary = ensureRipgrep(session.agentDir);
        const args = [...BASE_RG_ARGS, '--follow', '--files', '--iglob', pattern, '--iglob', '!**/.git/**', '--', root];
        const runner = options.run ?? streamLines;
        const run = await runner(binary, args, {
          cwd: ctx.cwd,
          ...(signal === undefined ? {} : { signal }),
          timeoutMs,
          maxLines: GLOB_MAX_LIMIT,
          keepLines: GLOB_MAX_LIMIT,
        });

        if (!run.timedOut && run.exitCode !== 0 && run.exitCode !== 1 && run.stderr !== '') {
          throw layerError('error', run.stderr.split('\n')[0] ?? `ripgrep exited with code ${run.exitCode}`);
        }

        const candidates: { readonly absolute: string; readonly display: string }[] = [];
        const seen = new Set<string>();
        for (const line of run.lines) {
          const absolute = path.isAbsolute(line) ? path.resolve(line) : path.resolve(root, line);
          const display = isInside(root, absolute) ? relativeTo(root, absolute) : toPosix(absolute);
          if (seen.has(display)) {
            continue;
          }
          seen.add(display);
          candidates.push({ absolute, display });
        }
        const allowed = await allowedPaths(
          session,
          candidates.map((candidate) => candidate.absolute),
          root,
        );
        const files = candidates
          .filter((candidate) => allowed.has(candidate.absolute))
          .map((candidate) => candidate.display)
          .sort((left, right) => left.localeCompare(right));

        const limitReached = files.length > limit || run.limitReached;
        const shown = files.slice(0, limit);
        const truncated = limitReached || run.timedOut || run.truncated;
        if (shown.length === 0 && !run.timedOut) {
          return { content: [{ type: 'text', text: 'No files found matching pattern' }], details: { files: [], count: 0 } };
        }
        const notices: string[] = [];
        if (limitReached) {
          notices.push(`${limit} results limit reached. Refine the pattern or raise limit`);
        }
        if (run.timedOut) {
          notices.push(`search timed out after ${timeoutMs}ms; results are partial`);
        }
        const body = shown.length === 0 ? '' : shown.join('\n');
        const text = notices.length === 0 ? body : `${body}${body === '' ? '' : '\n\n'}[${notices.join('. ')}]`;
        return {
          content: [{ type: 'text', text }],
          details: {
            files: shown,
            count: shown.length,
            ...(truncated ? { truncated: true } : {}),
            ...(limitReached ? { limitReached: true } : {}),
            ...(run.timedOut ? { timedOut: true } : {}),
          },
          structuredContent: { files: shown, total: shown.length, truncated },
        };
      },
      (params) => params.path,
    ),
  };
}
