import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { createReadToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { MAX_FENCE_BYTES } from '../constants.ts';
import { layerError } from '../core/errors.ts';
import { fileMetadata, readHead } from '../core/metadata.ts';
import { displayPath, resolveToolPath } from '../core/paths.ts';
import { PATH_ALIASES, prepareWith } from '../core/repair.ts';
import type { LayerContext } from '../core/session.ts';
import { guard, type LayerSession, subjectsFor } from '../core/session.ts';
import { countLines, looksBinary } from '../core/text.ts';
import { guarded } from '../core/tool.ts';
import type { FileMetadata, ToolFailure, ToolOutcome } from '../types.ts';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

export const readParameters = Type.Object({
  path: Type.String({ description: 'Path to the file to read (relative or absolute)' }),
  offset: Type.Optional(Type.Number({ description: 'Line number to start reading from (1-indexed). A negative value reads the last N lines.' })),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to read' })),
});

interface ReadParams {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadRange {
  readonly offset?: number;
  readonly limit?: number;
}

export interface ReadDetails {
  readonly metadata?: FileMetadata;
  readonly range?: ReadRange;
  readonly truncation?: unknown;
  readonly imageUnsupportedByModel?: string;
  readonly failure?: ToolFailure;
}

function metadataFooter(metadata: FileMetadata, range: ReadRange, shownLines: number): string {
  const counts = `${metadata.lines} ${metadata.lines === 1 ? 'line' : 'lines'}, ${metadata.bytes} ${metadata.bytes === 1 ? 'byte' : 'bytes'}`;
  if (range.offset === undefined && range.limit === undefined) {
    return `[file: ${counts}]`;
  }
  if (shownLines === 0) {
    return `[file: ${counts} · 0 lines shown]`;
  }
  const start = Math.max(1, range.offset ?? 1);
  return `[file: ${counts} · lines ${start}-${start + shownLines - 1}]`;
}

async function countFileLines(target: string): Promise<number> {
  return countLines((await readFile(target)).toString('utf-8'));
}

/** Translate a negative offset into a positive window so the underlying reader stays 1-indexed. */
async function normalizeRange(target: string, offset: number | undefined, limit: number | undefined): Promise<{ offset: number | undefined; limit: number | undefined }> {
  if (offset === undefined || offset >= 0) {
    return { offset, limit };
  }
  const total = await countFileLines(target);
  const start = Math.max(1, total + offset + 1);
  const window = limit === undefined ? total - start + 1 : Math.min(limit, total - start + 1);
  return { offset: start, limit: Math.max(0, window) };
}

export interface ReadToolOptions {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
}

export function createReadLayerTool(options: ReadToolOptions) {
  return {
    name: 'read',
    label: 'read',
    description:
      'Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Use offset/limit for large files, and a negative offset to read the tail of a file. Rejects paths excluded by project ignore files and paths the permission policy denies. Every text result reports the file size, line count, and digest.',
    promptSnippet: 'Read file contents with line offsets, metadata, and permission checks',
    promptGuidelines: ['Use read to examine files instead of cat or sed.', 'read ends with a [file: ...] line; check it before reading a large file again.'],
    prepareArguments: prepareWith({ aliases: PATH_ALIASES, numbers: ['offset', 'limit'] }),
    parameters: readParameters,
    execute: guarded<ReadParams, ReadDetails>(
      (failure) => ({ failure }),
      async ({ toolCallId, params, ctx, signal }): Promise<ToolOutcome<ReadDetails>> => {
        const session = await options.session(ctx);
        const target = resolveToolPath(params.path, ctx.cwd, session.home);
        await guard(session, { kind: 'read', subjects: await subjectsFor(target), action: 'read file', ctx });
        const ignoreFile = await session.ignore.describe(target);
        if (ignoreFile !== undefined) {
          throw layerError('permission_denied', `Path ${displayPath(ctx.cwd, target)} is filtered out by ${path.basename(ignoreFile)}`, { path: target });
        }

        let stats;
        try {
          stats = await stat(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw layerError('file_not_found', 'File not found', { path: target });
          }
          throw error;
        }
        if (stats.isDirectory()) {
          throw layerError('invalid_file', `Path is a directory, not a file: ${displayPath(ctx.cwd, target)}`, { path: target });
        }
        if (!stats.isFile()) {
          throw layerError('invalid_file', `Path is neither a file nor a directory: ${displayPath(ctx.cwd, target)}`, { path: target });
        }
        const extension = path.extname(target).toLowerCase();
        const isImage = IMAGE_EXTENSIONS.has(extension);
        if (!isImage && stats.size > 0 && looksBinary(await readHead(target, 8000))) {
          throw layerError('invalid_file', `File content is binary data, not text: ${displayPath(ctx.cwd, target)}`, { path: target });
        }

        const range = await normalizeRange(target, params.offset, params.limit);
        const definition = createReadToolDefinition(ctx.cwd);
        const result = await definition.execute(toolCallId, { path: target, ...(range.offset === undefined ? {} : { offset: range.offset }), ...(range.limit === undefined ? {} : { limit: range.limit }) }, signal, undefined, ctx as never);

        const metadata = await fileMetadata(target, { digest: stats.size <= MAX_FENCE_BYTES });
        if (params.offset === undefined && params.limit === undefined && metadata.sha256 !== undefined) {
          session.fence.record(target, { kind: 'content', fingerprint: { sha256: metadata.sha256, bytes: metadata.bytes } });
        } else {
          session.fence.forget(target);
        }

        const readRange: ReadRange = { ...(range.offset === undefined ? {} : { offset: range.offset }), ...(range.limit === undefined ? {} : { limit: range.limit }) };
        // Use what the reader actually returned: Pi truncates long reads and has its own negative-limit
        // slicing, so the requested limit alone does not describe the shown lines.
        const body = result.content.find((block) => block.type === 'text')?.text ?? '';
        const noticeStart = body.indexOf('\n\n[');
        const bodyWithoutNotice = noticeStart === -1 ? body : body.slice(0, noticeStart);
        const shownLines = countLines(bodyWithoutNotice);
        const content = isImage
          ? result.content
          : result.content.map((block, index) => (index === 0 && block.type === 'text' ? { type: 'text' as const, text: `${block.text}\n\n${metadataFooter(metadata, readRange, shownLines)}` } : block));
        const details: ReadDetails = {
          metadata,
          ...(range.offset === undefined && range.limit === undefined ? {} : { range: readRange }),
          ...(result.details === undefined
            ? {}
            : {
                ...(result.details.truncation === undefined ? {} : { truncation: result.details.truncation }),
                ...(result.details.imageUnsupportedByModel === undefined ? {} : { imageUnsupportedByModel: result.details.imageUnsupportedByModel }),
              }),
        };
        return { content, details, ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }) };
      },
      (params) => params.path,
    ),
  };
}
