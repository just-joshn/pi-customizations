import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pi runs an `auth.json` key that starts with `!` as a shell command whenever it needs that credential. Jobs must be able
 * to write `auth.json` so Pi can persist rotated OAuth tokens, which would otherwise log the user out, so a job could
 * also plant such a command for the user's next unsandboxed Pi. This guard removes any command key that appeared while
 * a job could write, before Pi uses it.
 */

type Commands = Record<string, string>;

const SNAPSHOT = 'auth-commands.json';

function commandKeys(text: string | undefined): Commands {
  if (!text) return {};
  try {
    const data = JSON.parse(text) as Record<string, { type?: unknown; key?: unknown }>;
    return Object.fromEntries(Object.entries(data).flatMap(([provider, entry]) => (entry?.type === 'api_key' && typeof entry.key === 'string' && entry.key.startsWith('!') ? [[provider, entry.key]] : [])));
  } catch {
    return {};
  }
}

const authPath = (agentDir: string): string => join(agentDir, 'auth.json');
const readAuth = (agentDir: string): string | undefined => (existsSync(authPath(agentDir)) ? readFileSync(authPath(agentDir), 'utf8') : undefined);

/** Records the command keys present when a job starts, in a directory only the root can write. */
export function snapshotAuthCommands(agentDir: string, out: string): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, SNAPSHOT), JSON.stringify(commandKeys(readAuth(agentDir))));
}

export const readSnapshot = (out: string): Commands | undefined => {
  try {
    return JSON.parse(readFileSync(join(out, SNAPSHOT), 'utf8')) as Commands;
  } catch {
    return undefined;
  }
};

// Pi guards auth.json with a lock directory beside it, so this takes the same lock before rewriting the file.
function withAuthLock<T>(agentDir: string, fn: () => T): T {
  const lock = `${authPath(agentDir)}.lock`;
  const deadline = Date.now() + 10_000;
  let held = false;
  while (!held) {
    try {
      mkdirSync(lock);
      held = true;
    } catch {
      // A planted command is worse than a lost refresh, so a lock held past the deadline does not stop the removal.
      if (Date.now() > deadline) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    if (held) rmdirSync(lock);
  }
}

/**
 * Removes every command key that is not in the snapshot, with the same value. Removed entries are kept in
 * `pstack-v2/auth-removed.json` so a command the user added on purpose while a job ran can be restored.
 */
export function removeNewAuthCommands(agentDir: string, snapshot: Commands): string[] {
  const current = commandKeys(readAuth(agentDir));
  if (Object.entries(current).every(([provider, key]) => snapshot[provider] === key)) return [];
  return withAuthLock(agentDir, () => {
    const text = readAuth(agentDir);
    if (!text) return [];
    const data = JSON.parse(text) as Record<string, unknown>;
    const planted = Object.entries(commandKeys(text)).filter(([provider, key]) => snapshot[provider] !== key);
    if (planted.length === 0) return [];
    for (const [provider] of planted) delete data[provider];
    const kept = join(agentDir, 'pstack-v2', 'auth-removed.json');
    mkdirSync(join(agentDir, 'pstack-v2'), { recursive: true });
    const previous = existsSync(kept) ? (JSON.parse(readFileSync(kept, 'utf8')) as unknown[]) : [];
    writeFileSync(kept, JSON.stringify([...previous, ...planted.map(([provider, key]) => ({ provider, key, removedAt: new Date().toISOString() }))], null, 2), { mode: 0o600 });
    writeFileSync(authPath(agentDir), JSON.stringify(data, null, 2), { mode: 0o600 });
    return planted.map(([provider]) => provider);
  });
}
