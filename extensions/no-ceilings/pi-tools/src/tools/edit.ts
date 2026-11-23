import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { generateDiffString, generateUnifiedPatch } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { layerError } from '../core/errors.ts';
import { fileMetadata } from '../core/metadata.ts';
import { displayPath, fileIdentity, multiLinkReason, resolveToolPath } from '../core/paths.ts';
import { withFileQueue } from '../core/queue.ts';
import { PATH_ALIASES, repairArguments } from '../core/repair.ts';
import type { LayerContext } from '../core/session.ts';
import { guard, guardReadDeny, type LayerSession, protectedFileReason, subjectsFor } from '../core/session.ts';
import { countLines, decodeUtf8, detectEol, normalizeEol, sha256Hex, stripBom } from '../core/text.ts';
import { guarded } from '../core/tool.ts';
import type { FileMetadata, ToolFailure, ToolOutcome } from '../types.ts';

export const editParameters = Type.Object({
  path: Type.String({ description: 'Path to the file to edit (relative or absolute)' }),
  edits: Type.Array(
    Type.Object({
      oldText: Type.String({ description: 'Exact text to find. Must be unique in the original file unless replaceAll is true.' }),
      newText: Type.String({ description: 'Replacement text' }),
      replaceAll: Type.Optional(Type.Boolean({ description: 'Replace every occurrence instead of requiring a unique match (default: false)' })),
    }),
    { description: 'One or more replacements. Every oldText is matched against the original file, not incrementally.' },
  ),
});

interface EditSpec {
  oldText: string;
  newText: string;
  replaceAll?: boolean;
}

interface EditParams {
  path: string;
  edits: EditSpec[];
}

export interface EditDetails {
  readonly diff?: string;
  readonly patch?: string;
  readonly firstChangedLine?: number;
  readonly metadata?: FileMetadata;
  readonly replaced?: number;
  readonly blocks?: number;
  readonly failure?: ToolFailure;
}

export interface EditToolOptions {
  readonly session: (ctx: LayerContext) => Promise<LayerSession>;
}

interface Range {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
  readonly editIndex: number;
}

export function prepareEditArguments(raw: unknown): unknown {
  const repaired = repairArguments(raw, {
    aliases: {
      ...PATH_ALIASES,
      old_string: 'oldText',
      new_string: 'newText',
      replace_all: 'replaceAll',
      allow_multiple_matches: 'replaceAll',
      allowMultipleMatches: 'replaceAll',
    },
    arrays: ['edits'],
    booleans: ['replaceAll'],
  });
  if (repaired === null || typeof repaired !== 'object' || Array.isArray(repaired)) {
    return repaired;
  }
  const input = repaired as Record<string, unknown>;
  const legacyOld = input['oldText'];
  const legacyNew = input['newText'];
  if (typeof legacyOld !== 'string' || typeof legacyNew !== 'string') {
    return input;
  }
  const edits = Array.isArray(input['edits']) ? [...(input['edits'] as unknown[])] : [];
  edits.push({ oldText: legacyOld, newText: legacyNew, ...(input['replaceAll'] === true ? { replaceAll: true } : {}) });
  const { oldText: _old, newText: _new, ...rest } = input;
  return { ...rest, edits };
}

function collectRanges(content: string, edits: readonly EditSpec[], display: string): { ranges: Range[]; replaced: number } {
  const ranges: Range[] = [];
  let replaced = 0;
  const normalizedEdits = edits.map((edit) => ({ ...edit, oldText: normalizeEol(stripBom(edit.oldText).text), newText: normalizeEol(stripBom(edit.newText).text) }));
  normalizedEdits.forEach((edit, editIndex) => {
    if (edit.oldText === '') {
      throw layerError('invalid_arguments', `Edit ${editIndex + 1} has an empty oldText`, { hint: 'oldText must contain the exact text to replace.' });
    }
    const positions: number[] = [];
    let scanIndex = content.indexOf(edit.oldText);
    while (scanIndex !== -1) {
      positions.push(scanIndex);
      scanIndex = content.indexOf(edit.oldText, scanIndex + edit.oldText.length);
    }
    if (positions.length === 0) {
      throw layerError('stale', `No match found for edit ${editIndex + 1} in ${display}. Nothing was written.`, {
        path: display,
        hint: 'Read the file again and copy oldText exactly, including whitespace and line breaks.',
      });
    }
    if (edit.replaceAll !== true && positions.length > 1) {
      throw layerError('invalid_arguments', `Edit ${editIndex + 1} matches ${positions.length} places in ${display}. Nothing was written.`, {
        path: display,
        hint: 'Add surrounding context to make oldText unique, or set replaceAll to true.',
      });
    }
    if (edit.replaceAll !== true) {
      const start = positions[0];
      if (start === undefined) {
        return;
      }
      ranges.push({ start, end: start + edit.oldText.length, newText: edit.newText, editIndex });
      replaced += 1;
      return;
    }
    for (const start of positions) {
      ranges.push({ start, end: start + edit.oldText.length, newText: edit.newText, editIndex });
      replaced += 1;
    }
  });

  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous !== undefined && current !== undefined && current.start < previous.end) {
      throw layerError('invalid_arguments', `Edits ${previous.editIndex + 1} and ${current.editIndex + 1} overlap in ${display}. Nothing was written.`, {
        path: display,
        hint: 'Merge overlapping edits into one, or make their oldText values disjoint.',
      });
    }
  }
  return { ranges: sorted, replaced };
}

/** Map each index of the LF-normalized text to its index in the original text. */
function originalIndexMap(original: string): number[] {
  const map: number[] = [];
  for (let index = 0; index < original.length; index++) {
    if (original[index] === '\r' && original[index + 1] === '\n') {
      // The normalized newline starts at the CR, so a range that ends before it leaves the CRLF intact.
      map.push(index);
      index++;
      continue;
    }
    map.push(index);
  }
  map.push(original.length);
  return map;
}

/** The line ending of the original line that contains `index`. */
function eolAt(original: string, index: number): '\r\n' | '\n' {
  const newline = original.indexOf('\n', index);
  if (newline === -1) {
    return detectEol(original);
  }
  return original[newline - 1] === '\r' ? '\r\n' : '\n';
}

/** Apply LF-space replacements to the original text, leaving untouched bytes exactly as they were. */
function spliceOriginal(original: string, ranges: readonly Range[]): string {
  const map = originalIndexMap(original);
  let next = original;
  for (const range of [...ranges].reverse()) {
    const start = map[range.start] ?? original.length;
    const end = map[range.end] ?? original.length;
    const eol = eolAt(original, start);
    const inserted = eol === '\r\n' ? range.newText.replaceAll('\n', '\r\n') : range.newText;
    next = `${next.slice(0, start)}${inserted}${next.slice(end)}`;
  }
  return next;
}

function applyRanges(content: string, ranges: readonly Range[]): string {
  let next = content;
  for (const range of [...ranges].reverse()) {
    next = `${next.slice(0, range.start)}${range.newText}${next.slice(range.end)}`;
  }
  return next;
}

export function createEditLayerTool(options: EditToolOptions) {
  return {
    name: 'edit',
    label: 'edit',
    description:
      'Edit a file with exact text replacement. Every oldText is matched against the original file; a match must be unique unless replaceAll is true. Rejects overlapping edits, no-op edits, stale files, and paths excluded by ignore files or the permission policy. Reports a diff and the changed line.',
    promptSnippet: 'Make precise file edits with exact text replacement, including multiple disjoint edits and replace-all in one call',
    promptGuidelines: ['Use edit for targeted changes. Batch changes to one file in a single call.', 'Each edits[].oldText must match the original file. Keep matches short and unique; set replaceAll to change every occurrence.'],
    parameters: editParameters,
    prepareArguments: prepareEditArguments,
    execute: guarded<EditParams, EditDetails>(
      (failure) => ({ failure }),
      async ({ params, ctx }): Promise<ToolOutcome<EditDetails>> => {
        const session = await options.session(ctx);
        const target = resolveToolPath(params.path, ctx.cwd, session.home);
        const subjects = await subjectsFor(target);
        // A read deny wins: the diff reports the file's text, so a denied body must not reach it.
        guardReadDeny(session, subjects);
        await guard(session, { kind: 'write', subjects, action: 'edit file', ctx });
        const ignoreFile = await session.ignore.describe(target);
        if (ignoreFile !== undefined) {
          throw layerError('permission_denied', `Path ${displayPath(ctx.cwd, target)} is filtered out by ${path.basename(ignoreFile)}`, { path: target });
        }
        const protectedReason = await protectedFileReason(session, target);
        if (protectedReason !== undefined) {
          throw layerError('permission_denied', `Blocked: ${protectedReason}`, { path: target, hint: 'The permission policy marks this path as protected, so no tool can change it.' });
        }
        if (!Array.isArray(params.edits) || params.edits.length === 0) {
          throw layerError('invalid_arguments', 'edits must contain at least one replacement', { hint: 'Pass edits: [{ oldText, newText }].' });
        }
        const editResult = await withFileQueue(
          target,
          async () => {
            // Read, match, write, and verify all happen under the per-file lock, so a concurrent call
            // cannot invalidate the fence check or land between the write and its verification.
            const info = await stat(target).catch(() => undefined);
            if (info === undefined || !info.isFile()) {
              throw layerError('file_not_found', `Cannot edit file: ${displayPath(ctx.cwd, target)} does not exist or is not a file.`, { path: target });
            }
            const linked = multiLinkReason(info);
            if (linked !== undefined) {
              throw layerError('permission_denied', `Cannot edit ${displayPath(ctx.cwd, target)}: ${linked}. Nothing was written.`, { path: target });
            }
            const identity = await fileIdentity(target);
            const readRecord = session.fence.take(identity);
            let kept = false;
            try {
              const before = await readFile(target);
              if (readRecord !== undefined) {
                const changed = readRecord.kind === 'absent' ? true : sha256Hex(before) !== readRecord.fingerprint.sha256 || before.byteLength !== readRecord.fingerprint.bytes;
                if (changed) {
                  throw layerError('stale', `${displayPath(ctx.cwd, target)} changed on disk after this tool call read it. Nothing was written. Read the file again and retry.`, { path: target });
                }
              }

              const decoded = decodeUtf8(before);
              if (decoded === undefined) {
                throw layerError('invalid_file', `File content is not valid UTF-8 text: ${displayPath(ctx.cwd, target)}. Nothing was written.`, { path: target });
              }
              const { bom, text: original } = stripBom(decoded);
              const normalized = normalizeEol(original);
              const { ranges, replaced } = collectRanges(normalized, params.edits, displayPath(ctx.cwd, target));
              const updated = applyRanges(normalized, ranges);
              if (updated === normalized) {
                throw layerError('error', `Edit made no changes to ${displayPath(ctx.cwd, target)}. Nothing was written.`, { path: target });
              }
              const finalContent = bom + spliceOriginal(original, ranges);
              await writeFile(target, finalContent, 'utf-8');
              const written = await readFile(target);
              if (sha256Hex(written) !== sha256Hex(Buffer.from(finalContent, 'utf-8'))) {
                throw layerError('error', `Edit verification failed: ${displayPath(ctx.cwd, target)} does not contain the edited text.`, { path: target });
              }
              const metadata = await fileMetadata(target);
              const digest = sha256Hex(written);
              session.fence.record(identity, { kind: 'content', fingerprint: { sha256: digest, bytes: written.byteLength } });
              kept = true;
              return {
                normalized,
                updated,
                replaced,
                diff: generateDiffString(normalized, updated),
                metadata,
              };
            } finally {
              if (!kept && readRecord !== undefined) {
                session.fence.restore(identity, readRecord);
              }
            }
          },
          { createParent: false },
        );
        const diff = editResult.diff;
        const blockCount = params.edits.length;
        const added = countLines(editResult.updated) - countLines(editResult.normalized);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully replaced ${editResult.replaced} ${editResult.replaced === 1 ? 'occurrence' : 'occurrences'} in ${displayPath(ctx.cwd, target)}.\n\n${diff.diff}`,
            },
          ],
          details: {
            diff: diff.diff,
            patch: generateUnifiedPatch(target, editResult.normalized, editResult.updated),
            ...(diff.firstChangedLine === undefined ? {} : { firstChangedLine: diff.firstChangedLine }),
            metadata: editResult.metadata,
            replaced: editResult.replaced,
            blocks: blockCount,
          },
          structuredContent: { path: target, replaced: editResult.replaced, blocks: blockCount, added, firstChangedLine: diff.firstChangedLine ?? null },
        };
      },
      (params) => params.path,
    ),
  };
}
