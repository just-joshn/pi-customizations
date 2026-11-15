import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * Jobs never write your real `auth.json`. Pi runs a credential whose key starts with `!` as a shell command, so a job able
 * to write that file could plant a command for your next unsandboxed Pi to run. Instead each top-level job, and every job
 * it starts, uses its own Pi agent directory through Pi's `PI_CODING_AGENT_DIR`. It links to your real configuration and
 * holds a copy of your credentials without commands. Only refreshed OAuth tokens move between the copy and the real file.
 */

type Credentials = Record<string, Record<string, unknown>>;

export const jobAgentDir = (top: string): string => join(top, 'agent');

// Entries a job's Pi must not share: your credentials, its lock, pstack's own state, and your saved sessions. Settings are
// copied with their paths rewritten, since Pi resolves them from the agent directory, which is a different one in a job.
const PRIVATE = new Set(['auth.json', 'auth.json.lock', 'pstack-v2', 'sessions', 'settings.json', 'settings.json.lock']);

/** A settings path as it resolves from your real agent directory: local ones made absolute, sources and names kept. */
function anchored(realAgentDir: string, entry: string): string {
  const [, prefix = '', path = ''] = /^([!+-]?)(.*)$/s.exec(entry) ?? [];
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || isAbsolute(path) || path.startsWith('~')) return entry;
  return `${prefix}${resolve(realAgentDir, path)}`;
}

function anchoredSettings(realAgentDir: string, settings: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...settings };
  for (const key of ['extensions', 'skills', 'prompts', 'themes']) {
    const list = copy[key];
    if (Array.isArray(list)) copy[key] = list.map((entry) => (typeof entry === 'string' ? anchored(realAgentDir, entry) : entry));
  }
  if (Array.isArray(copy['packages'])) {
    copy['packages'] = copy['packages'].map((entry: unknown) => {
      if (typeof entry === 'string') return anchored(realAgentDir, entry);
      if (entry && typeof entry === 'object' && typeof (entry as { source?: unknown }).source === 'string') {
        return { ...entry, source: anchored(realAgentDir, (entry as { source: string }).source) };
      }
      return entry;
    });
  }
  return copy;
}

function parse(text: string | undefined): Credentials | undefined {
  if (text === undefined) return undefined;
  try {
    const data: unknown = JSON.parse(text.replace(/^﻿/, ''));
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Credentials) : undefined;
  } catch {
    return undefined;
  }
}

const readCredentials = (dir: string): Credentials | undefined => {
  const path = join(dir, 'auth.json');
  return existsSync(path) ? parse(readFileSync(path, 'utf8')) : undefined;
};

const isCommand = (entry: Record<string, unknown> | undefined): boolean => entry?.['type'] === 'api_key' && typeof entry['key'] === 'string' && entry['key'].startsWith('!');

/** Providers whose credential in the real auth.json is a command, which the root resolves before handing it to a job. */
export const commandProviders = (realAgentDir: string): string[] =>
  Object.entries(readCredentials(realAgentDir) ?? {})
    .filter(([, entry]) => isCommand(entry))
    .map(([provider]) => provider);

/**
 * Creates the job's agent directory: links to each real entry Pi reads, and a credentials copy in which each command is
 * replaced by its resolved key when given, and dropped otherwise.
 */
export function makeJobAgentDir(realAgentDir: string, dir: string, resolved: Record<string, string> = {}): void {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(realAgentDir)) {
    const link = join(dir, name);
    if (!PRIVATE.has(name) && !existsSync(link) && !isLink(link)) symlinkSync(join(realAgentDir, name), link);
  }
  const settings = join(realAgentDir, 'settings.json');
  const parsed = existsSync(settings) ? parse(readFileSync(settings, 'utf8')) : undefined;
  if (parsed) writeFileSync(join(dir, 'settings.json'), `${JSON.stringify(anchoredSettings(realAgentDir, parsed), null, 2)}\n`);
  const copy: Credentials = {};
  for (const [provider, entry] of Object.entries(readCredentials(realAgentDir) ?? {})) {
    if (!isCommand(entry)) copy[provider] = entry;
    else if (resolved[provider] !== undefined) copy[provider] = { ...entry, key: resolved[provider] };
  }
  writeFileSync(join(dir, 'auth.json'), `${JSON.stringify(copy, null, 2)}\n`, { mode: 0o600 });
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// Pi guards auth.json with a lock directory beside it. Both files are locked before either is written, and a busy lock
// means waiting for the next sync rather than writing over a refresh in progress.
function withLocks(dirs: string[], fn: () => void): boolean {
  const held: string[] = [];
  try {
    for (const dir of dirs) {
      mkdirSync(join(dir, 'auth.json.lock'));
      held.push(dir);
    }
    fn();
    return true;
  } catch {
    return false;
  } finally {
    for (const dir of held) rmdirSync(join(dir, 'auth.json.lock'));
  }
}

const expiry = (entry: Record<string, unknown> | undefined): number => (entry?.['type'] === 'oauth' && typeof entry['expires'] === 'number' ? entry['expires'] : -1);

/**
 * Carries refreshed OAuth tokens both ways between the real auth.json and a job's copy, the later expiry winning. Only OAuth
 * entries move, so nothing a job writes as a key or command ever reaches the real file. Returns false when a lock was busy.
 */
export function syncTokens(realAgentDir: string, jobDir: string): boolean {
  return withLocks([realAgentDir, jobDir], () => {
    const real = readCredentials(realAgentDir);
    const copy = readCredentials(jobDir);
    if (!real || !copy) return;
    let realChanged = false;
    let copyChanged = false;
    for (const provider of new Set([...Object.keys(real), ...Object.keys(copy)])) {
      const [mine, theirs] = [real[provider], copy[provider]];
      // A provider you logged out of, or switched to a key, is never brought back from a job's copy.
      if (expiry(theirs) > expiry(mine) && mine?.['type'] === 'oauth') {
        real[provider] = theirs as Record<string, unknown>;
        realChanged = true;
      } else if (expiry(mine) > expiry(theirs) && (theirs === undefined || theirs['type'] === 'oauth')) {
        copy[provider] = mine as Record<string, unknown>;
        copyChanged = true;
      }
    }
    if (realChanged) writeFileSync(join(realAgentDir, 'auth.json'), `${JSON.stringify(real, null, 2)}\n`, { mode: 0o600 });
    if (copyChanged) writeFileSync(join(jobDir, 'auth.json'), `${JSON.stringify(copy, null, 2)}\n`, { mode: 0o600 });
  });
}
