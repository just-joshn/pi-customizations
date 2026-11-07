import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { stateDir } from './paths.ts';

const CONNECTOR = /^[a-z0-9][a-z0-9-]{0,62}$/;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export const connectorsDir = (): string => join(stateDir(), 'connectors');
export const credentialPath = (connector: string): string => join(connectorsDir(), connector, 'credentials.json');

export function checkCredentialName(connector: string, field: string): void {
  if (!CONNECTOR.test(connector)) throw new Error(`connector must be lowercase letters, digits, and hyphens: "${connector}"`);
  if (!FIELD.test(field)) throw new Error(`field must be letters, digits, and underscores: "${field}"`);
}

/** One field of a connector's credentials, or undefined when it was never stored. */
export function readCredential(connector: string, field: string): string | undefined {
  const path = credentialPath(connector);
  if (!existsSync(path)) return undefined;
  const value = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Stores one field, keeping the connector's other fields; the file is readable by this user only. */
export function writeCredential(connector: string, field: string, value: string): string {
  checkCredentialName(connector, field);
  const path = credentialPath(connector);
  mkdirSync(join(connectorsDir(), connector), { recursive: true, mode: 0o700 });
  const current = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : {};
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...current, [field]: value }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return path;
}
