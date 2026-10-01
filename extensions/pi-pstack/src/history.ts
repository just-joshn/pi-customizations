import { constants } from 'node:fs';
import { type FileHandle, open, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

type History = { id: string; path: string; name?: string };
type Header = { id: string; cwd: string; timestamp?: string };
const headerLimit = 65536;
const discoveryConcurrency = 10;

function object(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function workspace(cwd: string): string {
  const expanded = cwd === '~' ? homedir() : cwd.replace(/^~(?=\/)/, homedir());
  return resolve(expanded.startsWith('file://') ? fileURLToPath(expanded) : expanded);
}

async function ownership(handle: FileHandle, signal?: AbortSignal): Promise<Header | undefined> {
  const buffer = Buffer.alloc(headerLimit);
  let start = 0;
  for (let offset = 0; offset < headerLimit; offset++) {
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, offset, 1, offset);
    if (bytesRead && buffer[offset] !== 10) continue;
    const line = buffer.subarray(start, offset).toString('utf8').trim();
    if (line) {
      const value = object(line);
      if (value?.type !== 'session' || typeof value.id !== 'string' || typeof value.cwd !== 'string' || !value.cwd) return undefined;
      return { id: value.id, cwd: value.cwd, timestamp: typeof value.timestamp === 'string' ? value.timestamp : undefined };
    }
    if (!bytesRead) return undefined;
    start = offset + 1;
  }
  return undefined;
}

async function metadata(handle: FileHandle, header: Header, path: string, signal?: AbortSignal) {
  const stream = handle.createReadStream({ start: 0, autoClose: false, signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let name: string | undefined;
  let activity: number | undefined;
  try {
    for await (const line of lines) {
      signal?.throwIfAborted();
      const entry = object(line);
      if (entry?.type === 'session_info') name = typeof entry.name === 'string' ? entry.name.trim() || undefined : undefined;
      if (entry?.type !== 'message' || !entry.message || typeof entry.message !== 'object') continue;
      const message = entry.message as Record<string, unknown>;
      if (!['user', 'assistant'].includes(String(message.role)) || !('content' in message)) continue;
      const time = typeof message.timestamp === 'number' ? message.timestamp : typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
      if (Number.isFinite(time)) activity = Math.max(activity ?? time, time);
    }
    const headerTime = header.timestamp ? Date.parse(header.timestamp) : NaN;
    const modified = activity ?? (Number.isFinite(headerTime) ? headerTime : (await handle.stat()).mtimeMs);
    return { value: { id: header.id, path, name } satisfies History, modified };
  } finally {
    lines.close();
    stream.destroy();
  }
}

async function candidate(cwd: string, path: string, signal?: AbortSignal) {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) return undefined;
      const header = await ownership(handle, signal);
      return header && workspace(header.cwd) === cwd ? await metadata(handle, header, path, signal) : undefined;
    } finally {
      await handle.close();
    }
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
}

export async function workspaceHistory(cwd: string, directory: string, signal?: AbortSignal): Promise<History[]> {
  signal?.throwIfAborted();
  let files: string[];
  try {
    files = (await readdir(directory, { withFileTypes: true })).filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.jsonl')).map((entry) => join(directory, entry.name));
  } catch {
    signal?.throwIfAborted();
    return [];
  }
  const groups = Array.from({ length: Math.ceil(files.length / discoveryConcurrency) }, (_, index) => files.slice(index * discoveryConcurrency, (index + 1) * discoveryConcurrency));
  const results = [];
  for (const group of groups) results.push(...(await Promise.all(group.map((path) => candidate(workspace(cwd), path, signal)))));
  return results
    .filter((value) => value !== undefined)
    .toSorted((a, b) => b.modified - a.modified)
    .map(({ value }) => value);
}
