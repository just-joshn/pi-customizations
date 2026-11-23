import { mkdir, readFile, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Type } from 'typebox';
import { LayerError, layerError } from '../core/errors.ts';
import { applyHunks, countHunkChanges, PatchError, type PatchFile, parsePatch, rebuildPatched, splitLines } from '../core/patch.ts';
import { displayPath, resolveToolPath } from '../core/paths.ts';
import { withFileQueues } from '../core/queue.ts';
import { PATH_ALIASES, prepareWith } from '../core/repair.ts';
import type { LayerContext } from '../core/session.ts';
import { guard, isProtectedIgnoreFile, type LayerSession, subjectsFor } from '../core/session.ts';
import { decodeUtf8 } from '../core/text.ts';
import { guarded } from '../core/tool.ts';
import type { ToolFailure, ToolOutcome } from '../types.ts';

export const applyPatchParameters = Type.Object({
  patch: Type.String({
    description: 'Patch text. Accepts the *** Begin Patch / *** Update File / *** Add File / *** Delete File format with @@ hunks, or a unified diff with --- / +++ / @@ headers, including git-style headers.',
  }),
  path: Type.Optional(Type.String({ description: 'Base directory for the paths named in the patch (default: current directory)' })),
});

interface ApplyPatchParams {
  patch: string;
  path?: string;
}

export interface AppliedPatchFile {
  readonly path: string;
  readonly kind: 'add' | 'update' | 'delete';
  readonly hunks: number;
  readonly added: number;
  readonly removed: number;
  readonly movedTo?: string;
}

export interface ApplyPatchDetails {
  readonly files?: readonly AppliedPatchFile[];
  readonly applied?: number;
  readonly failure?: ToolFailure;
}

export interface ApplyPatchToolOptions {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
}

interface PlannedFile {
  readonly file: PatchFile;
  readonly target: string;
  readonly destination: string;
  readonly added: number;
  readonly removed: number;
  readonly action: 'write' | 'delete';
  readonly content?: string;
  /** Exact bytes for a move that has no hunks. Absent when the patch rewrites text. */
  readonly bytes?: Buffer;
  readonly createsParent: boolean;
  /** Bytes of the target before the patch, for rollback. Undefined when the target did not exist. */
  readonly original?: Buffer;
  /** Bytes of the move destination before the patch, for rollback. Undefined when it did not exist. */
  readonly destinationOriginal?: Buffer;
}

async function verifyBytes(target: string, expected: Uint8Array, cwd: string): Promise<void> {
  const after = await readFile(target);
  if (!after.equals(expected)) {
    throw layerError('error', `Patch verification failed: ${displayPath(cwd, target)} does not contain the patched text.`, { path: target });
  }
}

async function readExisting(target: string): Promise<Buffer | undefined> {
  try {
    return await readFile(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function utf8Text(bytes: Buffer, target: string, cwd: string): string {
  const text = decodeUtf8(bytes);
  if (text === undefined) {
    throw layerError('invalid_file', `File content is not valid UTF-8 text: ${displayPath(cwd, target)}. Nothing was written.`, { path: target });
  }
  return text;
}

export function createApplyPatchLayerTool(options: ApplyPatchToolOptions) {
  return {
    name: 'apply_patch',
    label: 'apply_patch',
    description:
      'Apply a patch to one or more files. Accepts the *** Begin Patch format or a unified diff. Every file is read and every hunk is validated before anything is written, all touched files are locked for the whole operation, and a malformed patch, a hunk that does not match, or a delete that leaves lines behind writes nothing.',
    promptSnippet: 'Apply a multi-file patch with strict validation',
    promptGuidelines: ['Use apply_patch for multi-file or hunk-based changes; use edit for a single targeted replacement.'],
    prepareArguments: prepareWith({ aliases: { ...PATH_ALIASES, diff: 'patch' }, strings: ['patch'] }),
    parameters: applyPatchParameters,
    execute: guarded<ApplyPatchParams, ApplyPatchDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx }): Promise<ToolOutcome<ApplyPatchDetails>> => {
        const session = await options.session(ctx);
        const base = params.path === undefined ? ctx.cwd : resolveToolPath(params.path, ctx.cwd, session.home);

        let parsed;
        try {
          parsed = parsePatch(params.patch, base);
        } catch (error) {
          if (error instanceof PatchError) {
            throw layerError('invalid_arguments', `Invalid patch: ${error.message}. Nothing was written.`, { hint: 'Fix the patch header or hunk markers and retry.' });
          }
          throw error;
        }
        if (parsed.files.length === 0) {
          throw layerError('error', 'Patch made no changes. Nothing was written.');
        }

        // Policy and ignore checks first, so no prompt runs while a file queue is held.
        interface GuardedFile {
          readonly file: PatchFile;
          readonly target: string;
          readonly destination: string;
        }
        const mergedFiles = parsed.files.reduce<PatchFile[]>((acc, file) => {
          const existing = acc.find((candidate) => candidate.path === file.path && candidate.kind === file.kind);
          if (existing) {
            const addedLines = existing.kind === 'add' ? [...(existing.addedLines ?? []), ...(file.addedLines ?? [])] : undefined;
            acc[acc.indexOf(existing)] = { ...existing, hunks: [...existing.hunks, ...file.hunks], ...(addedLines === undefined ? {} : { addedLines }) };
          } else {
            acc.push(file);
          }
          return acc;
        }, []);

        const guarded: GuardedFile[] = [];
        for (const file of mergedFiles) {
          const target = path.resolve(base, file.path);
          const destination = file.moveTo === undefined ? target : path.resolve(base, file.moveTo);
          for (const candidate of new Set([target, destination])) {
            await guard(session, { kind: 'write', subjects: await subjectsFor(candidate), action: 'apply patch', ctx });
            const ignoreFile = await session.ignore.describe(candidate);
            if (ignoreFile !== undefined) {
              throw layerError('permission_denied', `Path ${displayPath(ctx.cwd, candidate)} is filtered out by ${path.basename(ignoreFile)}`, { path: candidate });
            }
            if (await isProtectedIgnoreFile(session, candidate)) {
              throw layerError('permission_denied', `Blocked: ${path.basename(candidate)} is protected and cannot be changed by the agent`, { path: candidate });
            }
          }
          guarded.push({ file, target, destination });
        }

        // One critical section for every touched path. Inside it, every file is read and every hunk is
        // validated before the first write, so a later failure still writes nothing and no update is
        // computed from content the lock has not protected.
        const planned = await withFileQueues(
          guarded.flatMap((item) => [item.target, item.destination]),
          async () => {
            const actions: PlannedFile[] = [];
            for (const item of guarded) {
              const { file, target, destination } = item;
              const { added, removed } = countHunkChanges(file.hunks);
              const original = await readExisting(target);

              if (file.kind === 'delete') {
                if (original === undefined) {
                  throw layerError('file_not_found', `Cannot delete ${displayPath(ctx.cwd, target)}: it does not exist. Nothing was written.`, { path: target });
                }
                if (file.hunks.length > 0) {
                  const text = utf8Text(original, target, ctx.cwd);
                  let remaining: string[];
                  try {
                    remaining = applyHunks(splitLines(text), file.hunks, displayPath(ctx.cwd, target));
                  } catch (error) {
                    throw staleOrError(error, target, ctx.cwd);
                  }
                  if (remaining.length !== 0) {
                    throw layerError('error', `Delete hunk for ${displayPath(ctx.cwd, target)} leaves ${remaining.length} line(s) behind. Nothing was written.`, { path: target });
                  }
                }
                actions.push({ file, target, destination, added, removed, action: 'delete', createsParent: false, original });
                continue;
              }

              if (file.kind === 'add') {
                if (original !== undefined) {
                  throw layerError('error', `Cannot add ${displayPath(ctx.cwd, target)}: it already exists. Nothing was written.`, { path: target });
                }
                const lines = file.addedLines ?? [];
                actions.push({ file, target, destination, added, removed, action: 'write', content: rebuildPatched('', lines, file.noNewlineAtEnd === true), createsParent: true });
                continue;
              }

              if (original === undefined) {
                throw layerError('file_not_found', `Cannot update ${displayPath(ctx.cwd, target)}: it does not exist. Nothing was written.`, { path: target });
              }
              // A move with no hunks never decodes the file. The bytes at the destination must match the source.
              if (file.hunks.length === 0) {
                if (destination === target) {
                  throw layerError('error', `Patch made no changes to ${displayPath(ctx.cwd, target)}. Nothing was written.`, { path: target });
                }
                const destinationOriginal = await readExisting(destination);
                actions.push({ file, target, destination, added, removed, action: 'write', bytes: original, createsParent: true, original, ...(destinationOriginal === undefined ? {} : { destinationOriginal }) });
                continue;
              }
              const text = utf8Text(original, target, ctx.cwd);
              let lines: string[];
              try {
                lines = applyHunks(splitLines(text), file.hunks, displayPath(ctx.cwd, target));
              } catch (error) {
                throw staleOrError(error, target, ctx.cwd);
              }
              const content = rebuildPatched(text, lines, file.noNewlineAtEnd === true);
              if (destination === target && content === text) {
                throw layerError('error', `Patch made no changes to ${displayPath(ctx.cwd, target)}. Nothing was written.`, { path: target });
              }
              const destinationOriginal = destination === target ? original : await readExisting(destination);
              actions.push({ file, target, destination, added, removed, action: 'write', content, createsParent: destination !== target, original, ...(destinationOriginal === undefined ? {} : { destinationOriginal }) });
            }

            const created: string[] = [];
            try {
              for (const action of actions) {
                if (action.action === 'delete') {
                  await unlink(action.target);
                  continue;
                }
                if (action.createsParent) {
                  await createMissingParents(path.dirname(action.destination), created);
                }
                const payload = action.bytes ?? Buffer.from(action.content ?? '', 'utf8');
                await writeFile(action.destination, payload);
                await verifyBytes(action.destination, payload, ctx.cwd);
                if (action.destination !== action.target) {
                  await unlink(action.target);
                }
              }
            } catch (error) {
              await rollback(actions, created);
              throw annotateFailedWrite(error);
            }
            return actions;
          },
          { createParent: false },
        );

        const appliedFiles: AppliedPatchFile[] = planned.map((item) => ({
          path: item.target,
          kind: item.file.kind,
          hunks: item.file.hunks.length,
          added: item.added,
          removed: item.removed,
          ...(item.destination === item.target ? {} : { movedTo: item.destination }),
        }));
        const summary = appliedFiles
          .map((file) => `${file.kind === 'add' ? '+' : file.kind === 'delete' ? '-' : '~'} ${displayPath(ctx.cwd, file.movedTo ?? file.path)}${file.kind === 'update' ? ` (${file.hunks} hunks, +${file.added}/-${file.removed})` : ''}`)
          .join('\n');
        return {
          content: [{ type: 'text', text: `Applied patch to ${appliedFiles.length} file(s):\n${summary}` }],
          details: { files: appliedFiles, applied: appliedFiles.length },
          structuredContent: { applied: appliedFiles.length, files: appliedFiles.map((file) => ({ path: file.movedTo ?? file.path, kind: file.kind, hunks: file.hunks, added: file.added, removed: file.removed })) },
        };
      },
      (params) => params.path,
    ),
  };
}

/**
 * Put every touched path back the way it was. Validation happens before any write, so a failure here
 * is a filesystem error during the write itself; undoing the files already written keeps the call's
 * "nothing was written" contract true.
 */
async function rollback(actions: readonly PlannedFile[], created: readonly string[]): Promise<void> {
  for (const action of [...actions].reverse()) {
    const paths = action.destination === action.target ? [action.target] : [action.destination, action.target];
    for (const target of paths) {
      const original = target === action.target ? action.original : action.destinationOriginal;
      try {
        if (original === undefined) {
          await rm(target, { force: true });
        } else {
          await writeFile(target, original);
        }
      } catch {
        // Best effort: the original error is what the caller needs to see.
      }
    }
  }
  const directories = [...created].sort((left, right) => pathDepth(right) - pathDepth(left));
  for (const directory of directories) {
    await rmdir(directory).catch(() => undefined);
  }
}

/** Parents that did not exist before this call, leaf first. */
async function createMissingParents(directory: string, created: string[]): Promise<void> {
  const missing: string[] = [];
  let current = directory;
  while (!created.includes(current) && !missing.includes(current)) {
    try {
      const info = await stat(current);
      if (info.isDirectory()) {
        break;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      missing.push(current);
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  if (missing.length === 0) {
    return;
  }
  await mkdir(directory, { recursive: true });
  created.push(...missing);
}

function pathDepth(target: string): number {
  return target.split(path.sep).filter((part) => part !== '').length;
}

function annotateFailedWrite(error: unknown): Error {
  if (error instanceof LayerError) {
    if (error.message.includes('Nothing was written')) {
      return error;
    }
    return layerError(error.failure.kind, `${error.message} Nothing was written.`, {
      ...(error.failure.path === undefined ? {} : { path: error.failure.path }),
      ...(error.failure.hint === undefined ? {} : { hint: error.failure.hint }),
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Nothing was written')) {
    return error instanceof Error ? error : new Error(message);
  }
  return layerError('error', `${message} Nothing was written.`);
}

function staleOrError(error: unknown, target: string, cwd: string): Error {
  if (error instanceof PatchError) {
    return layerError('stale', `${error.message}. Nothing was written.`, { path: target, hint: `Read ${displayPath(cwd, target)} again and regenerate the patch against its current contents.` });
  }
  return error instanceof Error ? error : new Error(String(error));
}
