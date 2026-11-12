// The evidence files of a confirmed repro, staged for the one source reply. The worker names files in its result and
// the parent decides which of them leave the machine, because the worker is untrusted and the upload needs the Slack
// credential only the parent holds. Upstream (vendor reproduce SKILL.md:214) allows an attachment only inside the same
// source thread and only when the organization's retention policy allows it: `control.artifact_directory` is where the
// artifacts live and `control.artifact_retention_hours` is how long they may be kept. A screenshot, a recording and a
// short note are the artifacts the skill names (SKILL.md:190-192), so those are the types and the count (three). Upstream
// states no size limit, so the byte limits are the report attachments' (attachments.ts), this package's.
//
// Each accepted file is copied into the automation store once, so the bytes the parent uploads are the bytes it checked,
// whatever the worker does to its own file afterwards, and an upload retried after a restart does not depend on a
// directory the retention policy may have emptied.
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path';

import { ATTACHMENT_LIMITS } from './attachments.ts';

export const EVIDENCE_LIMITS = { files: 3, fileBytes: ATTACHMENT_LIMITS.fileBytes, totalBytes: ATTACHMENT_LIMITS.totalBytes } as const;

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

export interface EvidenceAttachment {
  /** The parent's own copy. */
  path: string;
  name: string;
  mimetype: string;
}
export interface StagedEvidence {
  files: EvidenceAttachment[];
  skipped: { requested: string; reason: string }[];
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'file';
const megabytes = (bytes: number) => `${bytes / 1024 ** 2} MiB`;

/** The directory a run's artifacts belong in: its own folder of the configured artifact directory, so two cases never share a file. */
export const artifactDirOf = (artifactDirectory: string, runId: string) => join(artifactDirectory, runId);

/** Reads exactly the file the descriptor names, refusing anything that is not a regular file of at most `maxBytes`. */
function readRegular(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) throw new Error('is not a regular file');
    if (info.size > maxBytes) throw new Error(`is larger than the ${megabytes(maxBytes)} limit per file`);
    const bytes = Buffer.alloc(info.size);
    let read = 0;
    while (read < bytes.length) {
      const count = readSync(fd, bytes, read, bytes.length - read, read);
      if (count === 0) break;
      read += count;
    }
    return bytes.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

export interface StageOptions {
  requested: readonly string[];
  /** `control.artifact_directory`, or undefined when the configuration names none: then nothing is attached. */
  artifactDirectory: string | undefined;
  retentionHours: number | undefined;
  runId: string;
  now: Date;
  /** Where the parent's copies go. */
  into: string;
}

/**
 * Accepts the requested files that are in the run's artifact directory (links and `..` resolved before the check), are
 * regular files of an allowed type and size, and are younger than the retention window. The rest are skipped with the
 * reason. Staging the same request twice leaves the same files.
 */
export function stageEvidence(options: StageOptions): StagedEvidence {
  const { requested, artifactDirectory, retentionHours, runId, now, into } = options;
  const staged: StagedEvidence = { files: [], skipped: [] };
  const skip = (path: string, reason: string) => staged.skipped.push({ requested: path.slice(0, 200), reason });
  if (artifactDirectory === undefined || retentionHours === undefined) {
    for (const path of requested) skip(path, 'the configuration names no artifact directory and retention, so nothing is attached');
    return staged;
  }
  const base = artifactDirOf(artifactDirectory, runId);
  let root: string;
  try {
    root = realpathSync(base);
  } catch {
    for (const path of requested) skip(path, `the run's artifact directory ${base} does not exist`);
    return staged;
  }
  let total = 0;
  const seen = new Set<string>();
  for (const path of requested) {
    if (staged.files.length >= EVIDENCE_LIMITS.files) {
      skip(path, `more than ${EVIDENCE_LIMITS.files} evidence files, so this one was not attached`);
      continue;
    }
    const type = TYPES[extname(path).toLowerCase()];
    if (type === undefined) {
      skip(path, 'is not a screenshot, a recording or a note (png, jpg, gif, webp, mp4, mov, webm, txt, md)');
      continue;
    }
    let real: string;
    try {
      real = realpathSync(isAbsolute(path) ? path : resolve(root, path));
    } catch {
      skip(path, 'does not exist');
      continue;
    }
    if (!real.startsWith(`${root}${sep}`)) {
      skip(path, `is not inside the run's artifact directory ${base}`);
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    const info = lstatSync(real);
    const age = now.getTime() - info.mtimeMs;
    if (age > retentionHours * 3_600_000) {
      skip(path, `is older than the ${retentionHours}-hour retention window`);
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = readRegular(real, Math.min(EVIDENCE_LIMITS.fileBytes, EVIDENCE_LIMITS.totalBytes - total));
    } catch (error) {
      skip(path, error instanceof Error ? error.message : String(error));
      continue;
    }
    const name = safeName(basename(real));
    const copy = join(into, `${staged.files.length + 1}-${name}`);
    mkdirSync(into, { recursive: true, mode: 0o700 });
    if (!existsSync(copy)) {
      const partial = `${copy}.${process.pid}.part`;
      try {
        writeFileSync(partial, bytes, { mode: 0o600 });
        renameSync(partial, copy);
      } catch (error) {
        rmSync(partial, { force: true });
        throw error;
      }
    }
    total += bytes.byteLength;
    staged.files.push({ path: copy, name, mimetype: type });
  }
  return staged;
}
