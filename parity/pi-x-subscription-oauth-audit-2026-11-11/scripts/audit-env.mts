import { readFileSync } from 'node:fs';

import { Type } from '../../../extensions/pi-x-subscription-oauth/node_modules/typebox/build/index.mjs';
import { Check } from '../../../extensions/pi-x-subscription-oauth/node_modules/typebox/build/value/index.mjs';
import type { createCursorProvider } from '../../../extensions/pi-x-subscription-oauth/src/cursor/provider.ts';

/** The isolated Pi agent dir that holds borrowed access tokens. Never point this at ~/.pi/agent. */
export const AUTH_DIR = process.env['PI_CODING_AGENT_DIR'] ?? '/tmp/xaudit/piagent';
/** Where probes write raw output. Copy only redacted output into evidence/. */
export const OUT_DIR = process.env['XAUDIT_OUT'] ?? '/tmp/xaudit';

const StoredCredential = Type.Object({ type: Type.Literal('oauth'), access: Type.String({ minLength: 1 }), refresh: Type.String(), expires: Type.Number() });
const AuthFile = Type.Record(Type.String(), Type.Unknown());

type RefreshContext = Parameters<NonNullable<ReturnType<typeof createCursorProvider>['refreshModels']>>[0];
type StoredOAuth = Extract<NonNullable<RefreshContext['credential']>, { type: 'oauth' }>;

/** Parses one provider's entry from auth.json, so a hand-seeded file with a wrong shape fails here, not mid-request. */
export function storedCredential(provider: 'grok-build' | 'cursor'): StoredOAuth {
  const file: unknown = JSON.parse(readFileSync(`${AUTH_DIR}/auth.json`, 'utf8'));
  if (!Check(AuthFile, file)) throw new Error(`${AUTH_DIR}/auth.json is not a JSON object.`);
  const entry = file[provider];
  if (!Check(StoredCredential, entry)) throw new Error(`No valid ${provider} OAuth credential in ${AUTH_DIR}/auth.json. Seed it first (see report.md, method disclosure).`);
  return entry;
}

/** Stands in for Pi's models store so refreshModels fetches from the network and keeps the result. */
export function refreshContext(credential: StoredOAuth): RefreshContext {
  return {
    credential,
    allowNetwork: true,
    force: true,
    publish: async (publication) => {
      publication.update?.();
      return true;
    },
    signal: AbortSignal.timeout(30_000),
  };
}
