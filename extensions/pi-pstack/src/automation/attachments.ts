// Report attachments for a case's worker. The worker has no Slack credential, so the parent downloads each file with its
// own and puts it under the worker's directory; the brief lists the local paths. Upstream's triage skill says to inspect
// every relevant attachment and to say so when one cannot be read (vendor triage SKILL.md:59-65). It states no size or
// type limit, so the limits below are this package's: a bound on what one report can write to disk. The files are the
// reporter's, so the worker is told to treat their content as data.
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AutomationEvent } from './model.ts';

export interface AttachmentLimits {
  files: number;
  fileBytes: number;
  totalBytes: number;
}

/** The safeguards a configuration that sets none gets. `attachments` in the Benny configuration overrides each. */
export const ATTACHMENT_LIMITS: AttachmentLimits = { files: 20, fileBytes: 50 * 1024 ** 2, totalBytes: 200 * 1024 ** 2 };

/** The attachments a case could not give its worker, one line each: what was left out and why. */
export const omittedOf = (attachments: readonly Attachment[]): { name: string; reason: string }[] => attachments.flatMap(({ name, skipped }) => (skipped === undefined ? [] : [{ name, reason: skipped }]));

/** Fetches one file, refusing to return more than `maxBytes`. Only the parent holds one: it carries the Slack credential. */
export type Download = (url: string, maxBytes: number) => Promise<Uint8Array>;

/** One attachment of the report: where it is now, or why it is not there. */
export interface Attachment {
  name: string;
  mimetype: string;
  size?: number;
  path?: string;
  skipped?: string;
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'file';
export const megabytes = (bytes: number) => `${bytes / 1024 ** 2} MiB`;

/**
 * Downloads `files` into `dir` as `<n>-<name>` (mode 0600, named by this function, never by the reporter's path). A file
 * already there is kept, so a rerun after a crash downloads nothing twice. One that cannot be fetched is listed with the
 * reason and never stops the case.
 */
export async function fetchAttachments(dir: string, files: AutomationEvent['files'], download: Download, limits: AttachmentLimits = ATTACHMENT_LIMITS): Promise<Attachment[]> {
  const results: Attachment[] = [];
  let total = 0;
  for (const [index, file] of files.entries()) {
    const { name, mimetype } = file;
    const base = { name, mimetype, ...(file.size === undefined ? {} : { size: file.size }) };
    const skip = (reason: string) => results.push({ ...base, skipped: reason });
    if (index >= limits.files) {
      skip(`more than ${limits.files} attachments, so this one was not downloaded`);
      continue;
    }
    if (file.downloadUrl === undefined || file.downloadUrl === '') {
      skip('has no download link');
      continue;
    }
    if (file.size !== undefined && file.size > limits.fileBytes) {
      skip(`larger than the ${megabytes(limits.fileBytes)} limit per file, so it was not downloaded`);
      continue;
    }
    const path = join(dir, `${index + 1}-${safeName(name)}`);
    if (existsSync(path)) {
      const kept = statSync(path).size;
      total += kept;
      results.push({ ...base, path, size: kept });
      continue;
    }
    if (total + (file.size ?? 0) > limits.totalBytes) {
      skip(`would take the report past the ${megabytes(limits.totalBytes)} limit for all its attachments`);
      continue;
    }
    try {
      const bytes = await download(file.downloadUrl, Math.min(limits.fileBytes, limits.totalBytes - total));
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const partial = `${path}.${process.pid}.part`;
      writeFileSync(partial, bytes, { mode: 0o600 });
      renameSync(partial, path);
      total += bytes.byteLength;
      results.push({ ...base, path, size: bytes.byteLength });
    } catch (error) {
      rmSync(`${path}.${process.pid}.part`, { force: true });
      skip(`could not be downloaded: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 200)}`);
    }
  }
  return results;
}
