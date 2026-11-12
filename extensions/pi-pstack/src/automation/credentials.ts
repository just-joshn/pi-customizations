import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const credentialsDir = () => join(homedir(), '.pi', 'agent', 'pstack', 'credentials');
export const defaultCredentialFile = (connector: string) => join(credentialsDir(), `${connector}.json`);

export type CredentialStatus = { ok: true; value: string } | { ok: false; reason: 'missing' | 'not-0600' | 'malformed' };

/** A string field of a 0600 credential file. A file other users can read is refused rather than trusted. */
export function readCredential(file: string, field: string): CredentialStatus {
  let mode: number;
  try {
    mode = statSync(file).mode;
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if ((mode & 0o077) !== 0) return { ok: false, reason: 'not-0600' };
  try {
    const value = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> | null)?.[field];
    return typeof value === 'string' && value.length >= 16 ? { ok: true, value } : { ok: false, reason: 'malformed' };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

export const SAME_UID_LIMIT =
  'Workers run as your uid. The tool and env boundary keeps them from posting through Pi, but a process running as you can still read your 0600 credential files. That is not an OS boundary; full isolation needs the container environment.';
