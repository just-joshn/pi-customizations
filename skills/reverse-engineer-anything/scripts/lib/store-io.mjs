import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Write JSON so that a reader sees either the previous file or the next one,
 * never a partial one: temp file, fsync, rename. Durable evidence is the whole
 * point of the store, so the write is synchronous to the filesystem before the
 * operation reports success.
 */
export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'w', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

export async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function readJsonOrNull(path) {
  try {
    return await readJsonFile(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}
