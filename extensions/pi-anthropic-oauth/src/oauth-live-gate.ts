import { readFile } from 'node:fs/promises';

import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { CLAUDE_TOKEN_URL } from './oauth.ts';
import { invalidFields } from './schema.ts';

export const LIVE_EXCHANGE_ENV = 'PI_ANTHROPIC_OAUTH_LIVE_EXCHANGE';

export const LIVE_EXCHANGE_GATE_ID = 'ANTH-LIVE-021';

export type LiveGateStatus = 'parked' | 'approved';

export type TokenResponseFieldShape = {
  readonly required: readonly string[];
  readonly optional: readonly string[];
};

const TokenJson = Type.Object({
  access_token: Type.String({ minLength: 1 }),
  expires_in: Type.Number(),
  refresh_token: Type.String({ minLength: 1 }),
  refresh_token_expires_in: Type.Optional(Type.Number()),
});

export type TokenJson = Static<typeof TokenJson>;

export const AUTHORIZATION_CODE_RESPONSE_SHAPE: TokenResponseFieldShape = {
  required: TokenJson.required,
  optional: Object.keys(TokenJson.properties).filter((key) => !TokenJson.required.some((required) => required === key)),
};

const TOKEN_FIELD_ERRORS: readonly (readonly [field: string, message: string])[] = [
  ['', 'Token endpoint response is not a JSON object'],
  ['access_token', 'Token JSON access_token must be a non-empty string'],
  ['expires_in', 'Token JSON expires_in must be a finite number'],
  ['refresh_token', 'Token JSON refresh_token must be a non-empty string'],
  ['refresh_token_expires_in', 'Token JSON refresh_token_expires_in must be a finite number when present'],
];

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

export function isLiveExchangeEnvEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[LIVE_EXCHANGE_ENV];
  return value === '1' || value === 'true';
}

export function parseLiveExchangeGateStatus(gatesMarkdown: string): LiveGateStatus {
  const heading = new RegExp(`^## ${LIVE_EXCHANGE_GATE_ID}[ \\t]*$`, 'm').exec(gatesMarkdown);
  if (!heading) throw new Error(`gates.md is missing section ## ${LIVE_EXCHANGE_GATE_ID}`);
  const rest = gatesMarkdown.slice(heading.index + heading[0].length);
  const nextHeading = rest.search(/\n## /);
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const status = section.match(/^\s*-\s*status:\s*(parked|approved)\s*$/m)?.[1];
  if (status !== 'parked' && status !== 'approved') {
    throw new Error(`gates.md ${LIVE_EXCHANGE_GATE_ID} needs "- status: parked|approved"`);
  }
  return status;
}

export function assertLiveExchangeAllowed(input: { env?: NodeJS.ProcessEnv; gatesMarkdown: string }): void {
  if (!isLiveExchangeEnvEnabled(input.env)) {
    throw new Error(`Set ${LIVE_EXCHANGE_ENV}=1 to run the live Anthropic authorize→exchange probe.`);
  }
  const status = parseLiveExchangeGateStatus(input.gatesMarkdown);
  if (status !== 'approved') {
    throw new Error(`gates.md ${LIVE_EXCHANGE_GATE_ID} status is "${status}". Set status to approved before a live probe.`);
  }
}

export async function readLiveExchangeGateFile(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

export function assertTokenJsonShape(body: unknown): TokenJson {
  if (Check(TokenJson, body)) return body;
  const invalid = invalidFields(TokenJson, body);
  const missing = TokenJson.required.find((key) => typeof body === 'object' && body !== null && !(key in body));
  if (missing !== undefined) throw new Error(`Token JSON missing required field ${missing}`);
  const [, message] = TOKEN_FIELD_ERRORS.find(([field]) => invalid.has(field)) ?? ['', 'Token JSON is malformed'];
  throw new Error(message);
}

function redactSecret(value: string): RedactedSecret {
  return { present: true, length: value.length, redacted: '[redacted]' };
}

export function buildLiveExchangeReceipt(input: { body: TokenJson; httpStatus: number; probedAt?: string; tokenUrl?: string }): LiveExchangeReceipt {
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
