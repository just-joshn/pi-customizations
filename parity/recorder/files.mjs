import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const sha256 = async (path) =>
  `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;

export async function allocateDir(root, attemptId) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Recorder root must be a real directory: ${root}`);
  const dir = join(root, attemptId);
  await mkdir(dir);
  return dir;
}

export const createExclusive = (path) => open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);

export async function resolveExecutable(file, cwd, env) {
  const candidates = file.includes('/')
    ? [resolve(cwd, file)]
    : (env.PATH ?? '')
        .split(':')
        .filter(Boolean)
        .map((dir) => join(dir, file));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}
