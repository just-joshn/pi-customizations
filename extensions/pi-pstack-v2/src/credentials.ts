import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

/**
 * Jobs never write your real `auth.json`. Pi runs a credential whose key starts with `!` as a shell command, so a job able
 * to write that file could plant a command for your next unsandboxed Pi to run. Instead each top-level job, and every job
 * it starts, uses its own Pi agent directory through Pi's `PI_CODING_AGENT_DIR`. It links to your real configuration and
 * holds a copy of your credentials without commands. Only refreshed OAuth tokens move between the copy and the real file.
 */

type Credentials = Record<string, Record<string, unknown>>;
/** Any JSON object is accepted, as Pi's own reader does. Entries are checked where they are used. */
const CredentialsSchema = z.record(z.string(), z.any());

export const jobAgentDir = (top: string): string => join(top, 'agent');

const PRIVATE = new Set(['auth.json', 'auth.json.lock', 'models-store.json', 'models-store.json.lock', 'pstack-v2', 'sessions', 'settings.json', 'settings.json.lock']);

/** A settings path as it resolves from your real agent directory: local ones made absolute, sources and names kept. */
function anchored(realAgentDir: string, entry: string): string {
  const [, prefix = '', path = ''] = /^([!+-]?)(.*)$/s.exec(entry) ?? [];
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || isAbsolute(path) || path.startsWith('~')) return entry;
  return `${prefix}${resolve(realAgentDir, path)}`;
}

function anchoredSettings(realAgentDir: string, settings: Record<string, unknown>): Record<string, unknown> {
  const listed = Object.fromEntries(
    ['extensions', 'skills', 'prompts', 'themes'].flatMap((key) => {
      const list = settings[key];
      return Array.isArray(list)
        ? [[key, list.map((entry) => (typeof entry === 'string' ? anchored(realAgentDir, entry) : entry))]]
        : [];
    }),
  );
  const copy = { ...settings, ...listed };
  if (Array.isArray(copy['packages'])) {
    return { ...copy, packages: copy['packages'].map((entry: unknown) => {
      if (typeof entry === 'string') return anchored(realAgentDir, entry);
      if (entry && typeof entry === 'object' && typeof (entry as { source?: unknown }).source === 'string') {
        return { ...entry, source: anchored(realAgentDir, (entry as { source: string }).source) };
      }
      return entry;
    }) };
  }
  return copy;
}

function parse(text: string | undefined): Credentials | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed = CredentialsSchema.safeParse(JSON.parse(text.replace(/^﻿/, '')));
    return parsed.success ? parsed.data : undefined;
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
  const catalog = join(realAgentDir, 'models-store.json');
  if (existsSync(catalog)) copyFileSync(catalog, join(dir, 'models-store.json'));
  const settings = join(realAgentDir, 'settings.json');
  const parsed = existsSync(settings) ? parse(readFileSync(settings, 'utf8')) : undefined;
  if (parsed) writeFileSync(join(dir, 'settings.json'), `${JSON.stringify(anchoredSettings(realAgentDir, parsed), null, 2)}\n`);
  const copy: Credentials = Object.fromEntries(
    Object.entries(readCredentials(realAgentDir) ?? {}).flatMap(([provider, entry]) => {
      if (!isCommand(entry)) return [[provider, entry]];
      return resolved[provider] !== undefined ? [[provider, { ...entry, key: resolved[provider] }]] : [];
    }),
  );
  writeFileSync(join(dir, 'auth.json'), `${JSON.stringify(copy, null, 2)}\n`, { mode: 0o600 });
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// Pi guards auth.json with a lock directory beside the file, resolved through links as proper-lockfile does, so a symlinked
// auth.json shares one lock. Both files are locked before either is written, and a busy lock means waiting for the next
// sync rather than writing over a refresh in progress.
const resolved = (file: string): string => (existsSync(file) ? realpathSync(file) : file);

export function withLocks(files: string[], fn: () => void): boolean {
  let held: readonly string[] = [];
  try {
    for (const file of files) {
      const lock = `${resolved(file)}.lock`;
      mkdirSync(lock);
      held = [...held, lock];
    }
    fn();
    return true;
  } catch {
    return false;
  } finally {
    // A job that shares a lock directory may have removed it already, which force tolerates.
    for (const lock of held) rmSync(lock, { recursive: true, force: true });
  }
}

// Pi rejects the whole file when an OAuth entry lacks string tokens or a finite expiry.
const validOauth = (entry: Record<string, unknown> | undefined): entry is Record<string, unknown> =>
  entry?.['type'] === 'oauth' && typeof entry['access'] === 'string' && entry['access'] !== '' && typeof entry['refresh'] === 'string' && entry['refresh'] !== '' && typeof entry['expires'] === 'number' && Number.isFinite(entry['expires']);

const expiry = (entry: Record<string, unknown> | undefined): number => (validOauth(entry) ? (entry['expires'] as number) : -1);

/**
 * Carries refreshed OAuth tokens both ways between the real auth.json and a job's copy, the later expiry winning. Only OAuth
 * entries move, so nothing a job writes as a key or command ever reaches the real file. Returns false when a lock was busy.
 */
export function syncTokens(realAgentDir: string, jobDir: string): boolean {
  return withLocks([join(realAgentDir, 'auth.json'), join(jobDir, 'auth.json')], () => {
    const real = readCredentials(realAgentDir);
    const copy = readCredentials(jobDir);
    if (!real || !copy) return;
    const providers = [...new Set([...Object.keys(real), ...Object.keys(copy)])];
    const realUpdates = providers.flatMap((provider) => {
      const [mine, theirs] = [real[provider], copy[provider]];
      // A provider you logged out of, or switched to a key, is never brought back from a job's copy.
      return expiry(theirs) > expiry(mine) && mine?.['type'] === 'oauth' ? [[provider, theirs as Record<string, unknown>] as const] : [];
    });
    const copyUpdates = providers.flatMap((provider) => {
      const [mine, theirs] = [real[provider], copy[provider]];
      const toReal = expiry(theirs) > expiry(mine) && mine?.['type'] === 'oauth';
      return !toReal && expiry(mine) > expiry(theirs) && (theirs === undefined || theirs['type'] === 'oauth')
        ? [[provider, mine as Record<string, unknown>] as const]
        : [];
    });
    const realChanged = realUpdates.length > 0;
    const copyChanged = copyUpdates.length > 0;
    const newReal = { ...real, ...Object.fromEntries(realUpdates) };
    const newCopy = { ...copy, ...Object.fromEntries(copyUpdates) };
    if (realChanged) {
      // Renamed into place so Pi never reads a half-written file. The job's copy is written in place instead, since the
      // job may have that file bound to its own view, and a new file would leave it holding the old one.
      const path = resolved(join(realAgentDir, 'auth.json'));
      writeFileSync(`${path}.pstack-tmp`, `${JSON.stringify(newReal, null, 2)}\n`, { mode: 0o600 });
      renameSync(`${path}.pstack-tmp`, path);
    }
    if (copyChanged) writeFileSync(join(jobDir, 'auth.json'), `${JSON.stringify(newCopy, null, 2)}\n`, { mode: 0o600 });
  });
}
