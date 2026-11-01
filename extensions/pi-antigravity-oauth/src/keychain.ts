import { spawn } from 'node:child_process';

// Measured gemini/antigravity item from parity fixtures/keychain-credential.schema.json.
export const AGY_KEYCHAIN = {
  service: 'gemini',
  account: 'antigravity',
} as const;

export const GO_KEYRING_PREFIX = 'go-keyring-base64:';

export interface AgyKeychainToken {
  access_token: string;
  refresh_token: string;
  token_type?: string | undefined;
  expiry?: string | undefined;
  expires_in?: number | undefined;
}

export interface AgyKeychainPayload {
  token: AgyKeychainToken;
  auth_method?: string | undefined;
  id_token_email?: string | undefined;
}

export interface ImportedAgyTokens {
  access: string;
  refresh: string;
  expires: number;
  email?: string | undefined;
}

const EXPIRY_DELTA_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeGoKeyringPassword(password: string): unknown {
  const raw = password.trim();
  if (!raw.startsWith(GO_KEYRING_PREFIX)) {
    throw new Error('Antigravity keychain password is not go-keyring-base64 encoded');
  }
  const encoded = raw.slice(GO_KEYRING_PREFIX.length);
  let json: string;
  try {
    json = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    throw new Error('Antigravity keychain password is not valid base64');
  }
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new Error('Antigravity keychain password is not valid JSON');
  }
}

function expiresFromToken(token: AgyKeychainToken, now: number): number {
  if (typeof token.expiry === 'string' && token.expiry) {
    const at = Date.parse(token.expiry);
    if (!Number.isNaN(at)) return at - EXPIRY_DELTA_MS;
  }
  if (typeof token.expires_in === 'number' && Number.isFinite(token.expires_in)) {
    return now + token.expires_in * 1000 - EXPIRY_DELTA_MS;
  }
  throw new Error('Antigravity keychain token lacks expiry or expires_in');
}

export function parseAgyKeychainPayload(data: unknown, now = Date.now()): ImportedAgyTokens {
  if (!isRecord(data)) throw new Error('Antigravity keychain payload is not an object');
  const tokenRaw = data['token'];
  if (!isRecord(tokenRaw)) throw new Error('Antigravity keychain payload lacks a token object');
  const access = tokenRaw['access_token'];
  const refresh = tokenRaw['refresh_token'];
  if (typeof access !== 'string' || !access) throw new Error('Antigravity keychain token lacks access_token');
  if (typeof refresh !== 'string' || !refresh) throw new Error('Antigravity keychain token lacks refresh_token');
  const tokenType = tokenRaw['token_type'];
  if (tokenType !== undefined && tokenType !== 'Bearer') {
    throw new Error('Antigravity keychain token_type is not Bearer');
  }
  const authMethod = data['auth_method'];
  if (authMethod !== undefined && authMethod !== 'consumer') {
    throw new Error('Antigravity keychain auth_method is not consumer');
  }
  const emailRaw = data['id_token_email'];
  const email = typeof emailRaw === 'string' && emailRaw ? emailRaw : undefined;
  const expiry = tokenRaw['expiry'];
  const expiresIn = tokenRaw['expires_in'];
  return {
    access,
    refresh,
    expires: expiresFromToken(
      {
        access_token: access,
        refresh_token: refresh,
        token_type: typeof tokenType === 'string' ? tokenType : undefined,
        expiry: typeof expiry === 'string' ? expiry : undefined,
        expires_in: typeof expiresIn === 'number' ? expiresIn : undefined,
      },
      now,
    ),
    ...(email && { email }),
  };
}

export function tokensFromGoKeyringPassword(password: string, now = Date.now()): ImportedAgyTokens {
  return parseAgyKeychainPayload(decodeGoKeyringPassword(password), now);
}

export function readAgyKeychainPassword(
  spawnImpl: typeof spawn = spawn,
  item: { service: string; account: string } = AGY_KEYCHAIN,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('security', ['find-generic-password', '-s', item.service, '-a', item.account, '-w'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim() || `exit ${code ?? 'unknown'}`;
        reject(new Error(`Could not read Antigravity keychain item (${item.service}/${item.account}): ${detail}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8').replace(/\n$/, ''));
    });
  });
}

export function keychainImportAvailable(platform = process.platform): boolean {
  return platform === 'darwin';
}
