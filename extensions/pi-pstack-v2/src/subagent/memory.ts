/**
 * Per-agent persistent memory: a directory an agent keeps across runs, whose `MEMORY.md` is loaded into its system prompt.
 * The directory and the file are checked as real, so a link planted there cannot point the agent at another file.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';

export const SUBAGENT_MEMORY_DIR_ENV = 'PI_SUBAGENT_MEMORY_DIR';

export const MemoryScopeSchema = z.enum(['user', 'project', 'local']);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

const MEMORY_FILE = 'MEMORY.md';
const MEMORY_DIR_MODE = 0o700;
const MAX_MEMORY_BYTES = 1_048_576;
const MAX_MEMORY_LINES = 200;
const MAX_MEMORY_CHARS = 25_000;
const TRUNCATION_NOTE = `[${MEMORY_FILE} truncated: only the first ${MAX_MEMORY_LINES} lines or ${MAX_MEMORY_CHARS} characters are loaded. Move older notes into topic files.]`;

const SCOPE_NOTES: Readonly<Record<MemoryScope, string>> = {
  user: 'This memory is shared by every project you work in, so keep it general.',
  project: 'This memory lives in the project and is meant to be shared with the team, so keep it specific to this project.',
  local: 'This memory lives in the project but stays out of version control, so keep it specific to this project and this machine.',
};

export interface PreparedMemory {
  dir: string;
  promptSection: string;
}

const safeAgentName = (agentName: string): string => agentName.replace(/[^a-zA-Z0-9_-]/g, '-');

export function resolveAgentMemoryDir(scope: MemoryScope, agentName: string, cwd: string, agentDir: string): string {
  const name = safeAgentName(agentName);
  if (scope === 'user') return path.join(agentDir, 'agent-memory', name);
  return path.join(cwd, CONFIG_DIR_NAME, scope === 'project' ? 'agent-memory' : 'agent-memory-local', name);
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function ensureRealDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: MEMORY_DIR_MODE });
  if (!fs.lstatSync(dir).isDirectory()) throw new Error(`Agent memory path is not a real directory: ${dir}`);
}

/** The text of `MEMORY.md`, at most the byte cap of it, or undefined when there is none. A link in its place is an error. */
function readMemoryBytes(file: string): string | undefined {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (!stat.isFile()) throw new Error(`${MEMORY_FILE} must be a regular file, not a link: ${file}`);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(MAX_MEMORY_BYTES);
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, MAX_MEMORY_BYTES, 0)).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function truncateMemory(text: string): { text: string; truncated: boolean } {
  const lines = text.split('\n');
  const byLines = lines.slice(0, MAX_MEMORY_LINES).join('\n');
  const byChars = byLines.slice(0, MAX_MEMORY_CHARS);
  return { text: byChars, truncated: byChars.length < text.trimEnd().length };
}

function promptSection(scope: MemoryScope, dir: string, content: string | undefined): string {
  const loaded = content === undefined ? { text: '', truncated: false } : truncateMemory(content);
  const body = loaded.text.trim() === '' ? `${MEMORY_FILE} is currently empty.` : `Current ${MEMORY_FILE}:\n\n${loaded.text}${loaded.truncated ? `\n\n${TRUNCATION_NOTE}` : ''}`;
  return [
    `## Persistent agent memory (${scope})`,
    '',
    `You have a persistent memory directory at ${dir}. ${SCOPE_NOTES[scope]}`,
    `Keep durable lessons in ${path.join(dir, MEMORY_FILE)} with the read, write and edit tools, and keep that file short: it is loaded into your prompt at the start of every run.`,
    '',
    body,
  ].join('\n');
}

/** Creates the agent's memory directory and loads its `MEMORY.md`. Throws when the directory or file is not safe to use. */
export function prepareAgentMemory(scope: MemoryScope, agentName: string, cwd: string, agentDir: string): PreparedMemory {
  const dir = resolveAgentMemoryDir(scope, agentName, cwd, agentDir);
  if (scope !== 'user' && !isInside(cwd, dir)) throw new Error(`Agent memory directory escapes the project: ${dir}`);
  ensureRealDirectory(dir);
  return { dir, promptSection: promptSection(scope, dir, readMemoryBytes(path.join(dir, MEMORY_FILE))) };
}
