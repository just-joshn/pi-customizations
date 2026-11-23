import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Type } from 'typebox';
import { layerError } from '../core/errors.ts';
import { fileMetadata } from '../core/metadata.ts';
import { displayPath, fileIdentity, resolveToolPath } from '../core/paths.ts';
import { withFileQueue } from '../core/queue.ts';
import { PATH_ALIASES, prepareWith } from '../core/repair.ts';
import type { LayerContext } from '../core/session.ts';
import { guard, isProtectedIgnoreFile, type LayerSession, subjectsFor } from '../core/session.ts';
import { countLines, decodeBase64, looksBinary, sha256Hex } from '../core/text.ts';
import { guarded } from '../core/tool.ts';
import type { FileMetadata, ToolFailure, ToolOutcome } from '../types.ts';

export const writeParameters = Type.Object({
  path: Type.String({ description: 'Path to the file to write (relative or absolute). Parent directories are created.' }),
  content: Type.String({ description: 'Full file contents to write' }),
  encoding: Type.Optional(Type.Union([Type.Literal('utf8'), Type.Literal('base64')], { description: 'How to decode content (default: utf8)' })),
  returnContent: Type.Optional(Type.Boolean({ description: 'Include the written contents in the result details (default: false)' })),
});

interface WriteParams {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  returnContent?: boolean;
}

export interface WriteDetails {
  readonly metadata?: FileMetadata;
  readonly bytesWritten?: number;
  readonly linesWritten?: number;
  readonly content?: string;
  readonly verified?: boolean;
  readonly failure?: ToolFailure;
}

export interface WriteToolOptions {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
}

/**
 * The name a directory lists that differs from the requested one only by case, when the requested
 * spelling itself is absent. Writing it would replace that file on a case-insensitive volume.
 */
async function findCaseCollision(target: string): Promise<string | undefined> {
  const directory = path.dirname(target);
  const name = path.basename(target);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return undefined;
  }
  if (names.includes(name)) {
    return undefined;
  }
  const variant = names.find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  if (variant === undefined) {
    return undefined;
  }
  // The requested spelling exists on this volume even though the directory lists another one.
  const reachable = await stat(target).catch(() => undefined);
  return reachable === undefined ? undefined : variant;
}

function decodeContent(params: WriteParams): Buffer {
  if (params.encoding !== 'base64') {
    return Buffer.from(params.content, 'utf-8');
  }
  return decodeBase64(params.content);
}

export function createWriteLayerTool(options: WriteToolOptions) {
  return {
    name: 'write',
    label: 'write',
    description:
      'Write a full file, creating parent directories. Refuses to overwrite a file that changed on disk since this tool call read it, refuses case-folding collisions, and verifies the bytes on disk after writing. Use write for new files or complete rewrites; use edit for targeted changes.',
    promptSnippet: 'Create or overwrite a file, with stale-write detection and post-write verification',
    promptGuidelines: ['Use write only for new files or complete rewrites. Use edit for targeted changes.'],
    prepareArguments: prepareWith({ aliases: PATH_ALIASES, booleans: ['returnContent'], strings: ['content'] }),
    parameters: writeParameters,
    execute: guarded<WriteParams, WriteDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx }): Promise<ToolOutcome<WriteDetails>> => {
        const session = await options.session(ctx);
        const target = resolveToolPath(params.path, ctx.cwd, session.home);
        await guard(session, { kind: 'write', subjects: await subjectsFor(target), action: 'write file', ctx });
        const ignoreFile = await session.ignore.describe(target);
        if (ignoreFile !== undefined) {
          throw layerError('permission_denied', `Path ${displayPath(ctx.cwd, target)} is filtered out by ${path.basename(ignoreFile)}`, { path: target });
        }
        if (await isProtectedIgnoreFile(session, target)) {
          throw layerError('permission_denied', `Blocked: ${path.basename(target)} is protected and cannot be changed by the agent`, { path: target });
        }

        const buffer = decodeContent(params);
        const expected = sha256Hex(buffer);

        // The whole read-modify-write runs inside the per-file queue, so a concurrent call cannot slip
        // between the check, the write, and the verification.
        const written = await withFileQueue(target, async () => {
          const collision = await findCaseCollision(target);
          if (collision !== undefined) {
            throw layerError('error', `${displayPath(ctx.cwd, target)} names the existing file ${collision}: this volume does not tell names apart by case, so writing it would replace ${collision}. Nothing was written.`, {
              path: target,
              hint: `Write ${collision} to change that file, or choose a new name.`,
            });
          }
          const identity = await fileIdentity(target);
          const readRecord = session.fence.take(identity);
          if (readRecord !== undefined) {
            const current = await readFile(target).catch(() => undefined);
            const changed = readRecord.kind === 'absent' ? current !== undefined : current === undefined || sha256Hex(current) !== readRecord.fingerprint.sha256 || current.byteLength !== readRecord.fingerprint.bytes;
            if (changed) {
              session.fence.restore(identity, readRecord);
              throw layerError('stale', `${displayPath(ctx.cwd, target)} changed on disk after this tool call read it. Nothing was written. Read the file again and retry.`, { path: target });
            }
          }
          await writeFile(target, buffer);
          const after = await readFile(target);
          if (sha256Hex(after) !== expected) {
            throw layerError('error', `Write verification failed: ${displayPath(ctx.cwd, target)} does not contain the bytes that were written.`, { path: target });
          }
          // Record inside the same critical section, so a concurrent write cannot land between the
          // verification and the record and leave a fingerprint for bytes that are no longer on disk.
          session.fence.record(identity, { kind: 'content', fingerprint: { sha256: expected, bytes: after.byteLength } });
          return after;
        });

        const metadata = await fileMetadata(target);
        const linesWritten = countLines(buffer.toString('utf-8'));
        const notices = `\n\n[wrote ${linesWritten} ${linesWritten === 1 ? 'line' : 'lines'}, ${written.byteLength} ${written.byteLength === 1 ? 'byte' : 'bytes'}]`;
        return {
          content: [
            { type: 'text', text: `${params.encoding === 'base64' && looksBinary(buffer) ? `Wrote ${written.byteLength} bytes to ${displayPath(ctx.cwd, target)}` : `Successfully wrote to ${displayPath(ctx.cwd, target)}`}${notices}` },
          ],
          details: {
            metadata,
            bytesWritten: written.byteLength,
            linesWritten,
            verified: true,
            ...(params.returnContent === true ? { content: buffer.toString('utf-8') } : {}),
          },
          structuredContent: { path: target, bytes: written.byteLength, lines: linesWritten, verified: true },
        };
      },
      (params) => params.path,
    ),
  };
}
