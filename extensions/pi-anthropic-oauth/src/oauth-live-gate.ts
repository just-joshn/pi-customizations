import { readFile } from 'node:fs/promises';

import { CLAUDE_TOKEN_URL } from './oauth.ts';

export const LIVE_EXCHANGE_ENV = 'PI_ANTHROPIC_OAUTH_LIVE_EXCHANGE';

export const LIVE_EXCHANGE_GATE_ID = 'ANTH-LIVE-021';

export type LiveGateStatus = 'parked' | 'approved';

export type TokenResponseFieldShape = {
  readonly required: readonly string[];
  readonly optional: readonly string[];
};

export const AUTHORIZATION_CODE_RESPONSE_SHAPE: TokenResponseFieldShape = {
  required: ['access_token', 'expires_in', 'refresh_token'],
  optional: ['refresh_token_expires_in'],
};

export type TokenJson = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in?: number;
};

export type RedactedSecret = {
  present: true;
  length: number;
  redacted: '[redacted]';
};

export type LiveExchangeReceipt = {
  unit: typeof LIVE_EXCHANGE_GATE_ID;
  probed_at: string;
  token_url: string;
  http_status: number;
  grant_type: 'authorization_code';
  response: {
    keys: string[];
    access_token: RedactedSecret;
    expires_in: number;
    refresh_token: RedactedSecret;
    refresh_token_expires_in?: number;
  };
  shape_ok: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isLiveExchangeEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[LIVE_EXCHANGE_ENV];
  return value === '1' || value === 'true';
}

export function parseLiveExchangeGateStatus(gatesMarkdown: string): LiveGateStatus {
  const section = gatesMarkdown.match(/##\s+ANTH-LIVE-021\b([\s\S]*?)(?=\n##\s|\s*$)/);
  if (!section) throw new Error(`gates.md is missing section ## ${LIVE_EXCHANGE_GATE_ID}`);
  const status = section[1]?.match(/^\s*-\s*status:\s*(parked|approved)\s*$/m)?.[1];
  if (status !== 'parked' && status !== 'approved') {
    throw new Error(`gates.md ${LIVE_EXCHANGE_GATE_ID} needs "- status: parked|approved"`);
  }
  return status;
}

export function assertLiveExchangeAllowed(input: {
  env?: NodeJS.ProcessEnv;
  gatesMarkdown: string;
}): void {
  if (!isLiveExchangeEnvEnabled(input.env)) {
    throw new Error(`Set ${LIVE_EXCHANGE_ENV}=1 to run the live Anthropic authorize→exchange probe.`);
  }
  const status = parseLiveExchangeGateStatus(input.gatesMarkdown);
  if (status !== 'approved') {
    throw new Error(
      `gates.md ${LIVE_EXCHANGE_GATE_ID} status is "${status}". Set status to approved before a live probe.`,
    );
  }
}

export async function readLiveExchangeGateFile(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

export function assertTokenJsonShape(
  body: unknown,
  shape: TokenResponseFieldShape = AUTHORIZATION_CODE_RESPONSE_SHAPE,
): TokenJson {
  if (!isRecord(body)) throw new Error('Token endpoint response is not a JSON object');
  for (const key of shape.required) {
    if (!(key in body)) throw new Error(`Token JSON missing required field ${key}`);
  }
  if (typeof body['access_token'] !== 'string' || body['access_token'].length === 0) {
    throw new Error('Token JSON access_token must be a non-empty string');
  }
  if (typeof body['expires_in'] !== 'number' || !Number.isFinite(body['expires_in'])) {
    throw new Error('Token JSON expires_in must be a finite number');
  }
  if (typeof body['refresh_token'] !== 'string' || body['refresh_token'].length === 0) {
    throw new Error('Token JSON refresh_token must be a non-empty string');
  }
  if ('refresh_token_expires_in' in body && body['refresh_token_expires_in'] !== undefined) {
    if (typeof body['refresh_token_expires_in'] !== 'number' || !Number.isFinite(body['refresh_token_expires_in'])) {
      throw new Error('Token JSON refresh_token_expires_in must be a finite number when present');
    }
  }
  return body as TokenJson;
}

function redactSecret(value: string): RedactedSecret {
  return { present: true, length: value.length, redacted: '[redacted]' };
}

export function buildLiveExchangeReceipt(input: {
  body: TokenJson;
  httpStatus: number;
  probedAt?: string;
  tokenUrl?: string;
}): LiveExchangeReceipt {
  const response: LiveExchangeReceipt['response'] = {
    keys: Object.keys(input.body).sort(),
    access_token: redactSecret(input.body.access_token),
    expires_in: input.body.expires_in,
    refresh_token: redactSecret(input.body.refresh_token),
  };
  if (input.body.refresh_token_expires_in !== undefined) {
    response.refresh_token_expires_in = input.body.refresh_token_expires_in;
  }
  return {
    unit: LIVE_EXCHANGE_GATE_ID,
    probed_at: input.probedAt ?? new Date().toISOString(),
    token_url: input.tokenUrl ?? CLAUDE_TOKEN_URL,
    http_status: input.httpStatus,
    grant_type: 'authorization_code',
    response,
    shape_ok: true,
  };
}
