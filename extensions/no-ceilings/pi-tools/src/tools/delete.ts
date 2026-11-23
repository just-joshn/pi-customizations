import { readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { Type } from 'typebox';
import { MAX_SNAPSHOT_BYTES } from '../constants.ts';
import { layerError } from '../core/errors.ts';
import { displayPath, fileIdentity, resolveToolPath } from '../core/paths.ts';
import { withFileQueue } from '../core/queue.ts';
import { PATH_ALIASES, prepareWith } from '../core/repair.ts';
import type { LayerContext } from '../core/session.ts';
import { guard, isProtectedIgnoreFile, type LayerSession, subjectsFor } from '../core/session.ts';
import { guarded } from '../core/tool.ts';
import type { ToolFailure, ToolOutcome } from '../types.ts';

export const deleteParameters = Type.Object({
  path: Type.String({ description: 'Path to the file to delete (relative or absolute). Directories are refused.' }),
});

interface DeleteParams {
  path: string;
}

export interface DeleteDetails {
  readonly deletedBytes?: number;
  readonly previousContent?: string;
  readonly failure?: ToolFailure;
}

export interface DeleteToolOptions {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
}

export function createDeleteLayerTool(options: DeleteToolOptions) {
  return {
    name: 'delete',
    label: 'delete',
    description:
      'Delete a single file. Directories are refused. The result records the deleted size and keeps the previous contents when the file is small enough. Refuses files excluded by ignore files or the permission policy, and refuses a file that changed between the check and the unlink.',
    promptSnippet: 'Delete a file where the permission policy allows it',
    promptGuidelines: ['Use delete for a single file. Use bash with rm for directories or trees.'],
    prepareArguments: prepareWith({ aliases: PATH_ALIASES }),
    parameters: deleteParameters,
    execute: guarded<DeleteParams, DeleteDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx }): Promise<ToolOutcome<DeleteDetails>> => {
        const session = await options.session(ctx);
        const target = resolveToolPath(params.path, ctx.cwd, session.home);
        await guard(session, { kind: 'write', subjects: await subjectsFor(target), action: 'delete file', ctx });
        const ignoreFile = await session.ignore.describe(target);
        if (ignoreFile !== undefined) {
          throw layerError('permission_denied', `Path ${displayPath(ctx.cwd, target)} is filtered out by ${path.basename(ignoreFile)}`, { path: target });
        }
        if (await isProtectedIgnoreFile(session, target)) {
          throw layerError('permission_denied', `Blocked: ${path.basename(target)} is protected and cannot be changed by the agent`, { path: target });
        }

        let previousContent: string | undefined;
        const before = await withFileQueue(
          target,
          async () => {
            const snapshot = await stat(target).catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') {
                throw layerError('file_not_found', `File not found: ${displayPath(ctx.cwd, target)}`, { path: target });
              }
              throw error;
            });
            if (snapshot.isDirectory()) {
              throw layerError('not_file', `Not a file: ${displayPath(ctx.cwd, target)} is a directory`, { path: target });
            }
            if (!snapshot.isFile()) {
              throw layerError('not_file', `Not a file: ${displayPath(ctx.cwd, target)}`, { path: target });
            }

            previousContent = snapshot.size <= MAX_SNAPSHOT_BYTES ? (await readFile(target)).toString('utf-8') : undefined;

            const after = await stat(target);
            if (after.dev !== snapshot.dev || after.ino !== snapshot.ino) {
              throw layerError('stale', `File changed while deleting; nothing was removed: ${displayPath(ctx.cwd, target)}`, { path: target });
            }

            try {
              await unlink(target);
            } catch (error) {
              const code = (error as NodeJS.ErrnoException).code;
              if (code === 'EACCES' || code === 'EPERM') {
                throw layerError('permission_denied', `Permission denied: ${displayPath(ctx.cwd, target)}`, { path: target });
              }
              if (code === 'EBUSY') {
                throw layerError('file_busy', `File is busy: ${displayPath(ctx.cwd, target)}`, { path: target });
              }
              if (code === 'ENOENT') {
                throw layerError('file_not_found', `File not found: ${displayPath(ctx.cwd, target)}`, { path: target });
              }
              throw error;
            }
            return snapshot;
          },
          { createParent: false },
        );
        session.fence.record(await fileIdentity(target), { kind: 'absent' });

        return {
          content: [{ type: 'text', text: `Deleted ${displayPath(ctx.cwd, target)} (${before.size} ${before.size === 1 ? 'byte' : 'bytes'})` }],
          details: { deletedBytes: before.size, ...(previousContent === undefined ? {} : { previousContent }) },
          structuredContent: { path: target, bytes: before.size, deleted: true },
        };
      },
      (params) => params.path,
    ),
  };
}
