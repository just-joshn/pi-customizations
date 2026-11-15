import { copyFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pi runs an `auth.json` key that starts with `!` as a shell command whenever it needs that credential. Jobs must be able
 * to write `auth.json` so Pi can persist rotated OAuth tokens, which would otherwise log you out, so a job could also
 * plant such a command for an unsandboxed Pi to run. This guard keeps the command keys exactly as you approved them.
 * Approval lives in a file no job can write, so no job, and no process a job leaves behind, can approve its own command.
 */

type Commands = Record<string, string>;

const authPath = (agentDir: string): string => join(agentDir, 'auth.json');
const stateDir = (agentDir: string): string => join(agentDir, 'pstack-v2');
const approvedPath = (agentDir: string): string => join(stateDir(agentDir), 'auth-approved.json');
const backupPath = (agentDir: string): string => join(stateDir(agentDir), 'auth-backup.json');
const removedPath = (agentDir: string): string => join(stateDir(agentDir), 'auth-removed.json');

function parse(text: string): Record<string, unknown> | undefined {
  try {
    const data: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function commandKeys(data: Record<string, unknown> | undefined): Commands {
  if (!data) return {};
  return Object.fromEntries(
    Object.entries(data).flatMap(([provider, entry]) => {
      const { type, key } = (entry ?? {}) as { type?: unknown; key?: unknown };
      return type === 'api_key' && typeof key === 'string' && key.startsWith('!') ? [[provider, key]] : [];
    }),
  );
}

const readJson = <T>(path: string): T | undefined => (existsSync(path) ? (parse(readFileSync(path, 'utf8')) as T | undefined) : undefined);

// Pi guards auth.json with a lock directory beside it, so this takes the same lock before rewriting the file. A job can
// hold that lock, and a planted command is worse than a lost refresh, so a held lock never delays the guard.
function withAuthLock<T>(agentDir: string, fn: () => T): T {
  let held = false;
  try {
    mkdirSync(`${authPath(agentDir)}.lock`);
    held = true;
  } catch {
    // Held by Pi or by a job.
  }
  try {
    return fn();
  } finally {
    if (held) rmdirSync(`${authPath(agentDir)}.lock`);
  }
}

/** Approves the command keys auth.json holds now, and returns them. Runs once on first use, and through `/pstack-approve-credentials`. */
export function approveCredentials(agentDir: string): Commands {
  mkdirSync(stateDir(agentDir), { recursive: true });
  const text = existsSync(authPath(agentDir)) ? readFileSync(authPath(agentDir), 'utf8') : '{}';
  const commands = commandKeys(parse(text));
  writeFileSync(approvedPath(agentDir), JSON.stringify(commands), { mode: 0o600 });
  return commands;
}

export interface GuardResult {
  /** auth.json did not parse, and was restored from the last good copy. */
  restored: boolean;
  /** Providers whose unapproved command was reverted to the approved one or removed. */
  reverted: string[];
}

/**
 * Restores auth.json if it no longer parses, then reverts every command key that is not one you approved. A command a job
 * changed goes back to the approved one, and an unapproved one is removed, each noted in `auth-removed.json`. Only command
 * keys are touched, so logging in or out of a provider sticks. The last good file is copied on every check, so a restore
 * keeps Pi's latest token refresh.
 */
export function guardCredentials(agentDir: string): GuardResult {
  const path = authPath(agentDir);
  if (!existsSync(approvedPath(agentDir))) approveCredentials(agentDir);
  const approved = readJson<Commands>(approvedPath(agentDir)) ?? {};
  return withAuthLock(agentDir, () => {
    let restored = false;
    let data = existsSync(path) ? parse(readFileSync(path, 'utf8')) : undefined;
    if (existsSync(path) && !data && existsSync(backupPath(agentDir))) {
      rmSync(path, { force: true });
      copyFileSync(backupPath(agentDir), path);
      data = parse(readFileSync(path, 'utf8'));
      restored = true;
    }
    if (!data) return { restored, reverted: [] };
    const current = commandKeys(data);
    const reverted = Object.keys(current).filter((provider) => current[provider] !== approved[provider]);
    if (reverted.length) {
      let removed: unknown[] = [];
      try {
        removed = JSON.parse(readFileSync(removedPath(agentDir), 'utf8')) as unknown[];
      } catch {
        // No history yet.
      }
      const at = new Date().toISOString();
      // Bounded, since a job could plant huge or endless commands to fill the disk.
      const noted = reverted.map((provider) => ({ provider, key: (current[provider] ?? '').slice(0, 300), at }));
      writeFileSync(removedPath(agentDir), JSON.stringify([...removed, ...noted].slice(-100), null, 2), { mode: 0o600 });
      for (const provider of reverted) {
        const approvedKey = approved[provider];
        if (approvedKey === undefined) delete data[provider];
        else data[provider] = { ...(data[provider] as object), key: approvedKey };
      }
      writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
    }
    copyFileSync(path, backupPath(agentDir));
    return { restored, reverted };
  });
}
