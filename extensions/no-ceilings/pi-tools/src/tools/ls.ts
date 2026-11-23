import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { minimatch } from 'minimatch';
import { Type } from 'typebox';
import { LS_NAME_BUDGET, LS_TIMEOUT_MS } from '../constants.ts';
import { layerError } from '../core/errors.ts';
import { canonicalPath, displayPath, isInside, relativeTo, resolveToolPath, toPosix } from '../core/paths.ts';
import { isInsideWorkspace } from '../core/policy.ts';
import { PATH_ALIASES, prepareWith } from '../core/repair.ts';
import { allowedPaths, assertSearchable } from '../core/search.ts';
import type { LayerContext } from '../core/session.ts';
import { guardSearch, type LayerSession, subjectsFor } from '../core/session.ts';
import { guarded } from '../core/tool.ts';
import type { ToolFailure, ToolOutcome } from '../types.ts';

export const lsParameters = Type.Object({
  path: Type.Optional(Type.String({ description: 'Directory to list (default: current directory)' })),
  depth: Type.Optional(Type.Number({ description: 'How many directory levels to walk (default: 1, maximum: 8)' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of entries to return (default: 500)' })),
  ignore: Type.Optional(Type.Array(Type.String(), { description: 'Extra glob patterns to exclude, matched against entry names' })),
});

interface LsParams {
  path?: string;
  depth?: number;
  limit?: number;
  ignore?: string[];
}

export interface LsEntry {
  readonly path: string;
  readonly type: 'file' | 'directory';
}

export interface LsDetails {
  readonly entries?: readonly LsEntry[];
  readonly truncated?: boolean;
  readonly limitReached?: boolean;
  readonly timedOut?: boolean;
  readonly failure?: ToolFailure;
}

const DEFAULT_LIMIT = 500;
const MAX_DEPTH = 8;
const MAX_COLLECTED = 20_000;

export interface LsToolOptions {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
}

export function createLsLayerTool(options: LsToolOptions) {
  return {
    name: 'ls',
    label: 'ls',
    description:
      'List directory contents. Entries are sorted alphabetically, directories carry a trailing slash, and dotfiles are included. Excludes paths matched by .gitignore, .ignore, .piignore, nested ignore files, extra globs, or the permission policy. Output is truncated at a name budget, an entry limit, or five seconds.',
    promptSnippet: 'List directory contents with ignore and permission filtering',
    prepareArguments: prepareWith({ aliases: PATH_ALIASES, numbers: ['depth', 'limit'], arrays: ['ignore'] }),
    parameters: lsParameters,
    execute: guarded<LsParams, LsDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx, signal }): Promise<ToolOutcome<LsDetails>> => {
        const session = await options.session(ctx);
        const root = resolveToolPath(params.path ?? '.', ctx.cwd, session.home);
        await guardSearch(session, await subjectsFor(root));
        await assertSearchable(session, await subjectsFor(root), ctx.cwd);

        let stats;
        try {
          stats = await stat(root);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw layerError('file_not_found', `Path does not exist: ${displayPath(ctx.cwd, root)}`, { path: root });
          }
          throw error;
        }
        if (!stats.isDirectory()) {
          throw layerError('not_directory', `Path is not a directory: ${displayPath(ctx.cwd, root)}`, { path: root });
        }

        const depth = Math.max(1, Math.min(MAX_DEPTH, Math.floor(params.depth ?? 1)));
        const limit = Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT));
        const extraIgnores = params.ignore ?? [];
        const startedAt = Date.now();
        let timedOut = false;
        let collected = 0;

        interface Candidate {
          readonly absolute: string;
          readonly display: string;
          readonly isDirectory: boolean;
        }
        const candidates: Candidate[] = [];

        const walk = async (directory: string, level: number): Promise<void> => {
          if (signal?.aborted === true) {
            throw layerError('rejected', 'Operation aborted');
          }
          if (Date.now() - startedAt > LS_TIMEOUT_MS) {
            timedOut = true;
            return;
          }
          let names;
          try {
            names = await readdir(directory, { withFileTypes: true });
          } catch (error) {
            if (level === 1) {
              throw error;
            }
            return;
          }
          const sorted = [...names].sort((left, right) => left.name.localeCompare(right.name));
          for (const entry of sorted) {
            if (timedOut || collected >= MAX_COLLECTED) {
              timedOut ||= collected >= MAX_COLLECTED;
              return;
            }
            const absolute = path.join(directory, entry.name);
            const info = await stat(absolute).catch(() => undefined);
            const isDirectory = info?.isDirectory() === true;
            if (isDirectory) {
              const canonical = await canonicalPath(absolute);
              const contained = isInsideWorkspace(session.policy, canonical) || isInside(root, canonical);
              if (!contained) {
                continue;
              }
            }
            if (extraIgnores.some((pattern) => minimatch(entry.name, pattern, { dot: true }))) {
              continue;
            }
            collected++;
            candidates.push({ absolute, display: `${relativeTo(root, absolute)}${isDirectory ? '/' : ''}`, isDirectory });
            if (isDirectory && level < depth) {
              await walk(absolute, level + 1);
            }
          }
        };

        await walk(root, 1);

        const allowed = await allowedPaths(
          session,
          candidates.map((candidate) => ({ path: candidate.absolute, isDirectory: candidate.isDirectory })),
          root,
        );
        const entries: LsEntry[] = [];
        const lines: string[] = [];
        let budgetUsed = root.length;
        let charactersExhausted = false;
        let limitReached = false;
        for (const candidate of candidates) {
          if (!allowed.has(candidate.absolute)) {
            continue;
          }
          if (entries.length >= limit) {
            limitReached = true;
            break;
          }
          if (charactersExhausted || budgetUsed + candidate.display.length > LS_NAME_BUDGET) {
            charactersExhausted = true;
            continue;
          }
          budgetUsed += candidate.display.length;
          entries.push({ path: toPosix(candidate.absolute), type: candidate.isDirectory ? 'directory' : 'file' });
          lines.push(candidate.display);
        }

        const truncated = charactersExhausted || limitReached || timedOut;
        const notices: string[] = [];
        if (limitReached) {
          notices.push(`${limit} entries limit reached`);
        }
        if (charactersExhausted) {
          notices.push(`listing capped at ${LS_NAME_BUDGET} characters`);
        }
        if (timedOut) {
          notices.push(`listing stopped after ${LS_TIMEOUT_MS / 1000}s with partial results`);
        }
        const text = lines.length === 0 && notices.length === 0 ? '(empty directory)' : lines.join('\n');
        const body = notices.length === 0 ? text : `${text}\n\n[${notices.join('. ')}]`;
        return {
          content: [{ type: 'text', text: body }],
          details: {
            entries,
            ...(truncated ? { truncated: true } : {}),
            ...(limitReached ? { limitReached: true } : {}),
            ...(timedOut ? { timedOut: true } : {}),
          },
          structuredContent: { entries: entries.map((entry) => ({ path: entry.path, type: entry.type })), truncated },
        };
      },
      (params) => params.path,
    ),
  };
}
