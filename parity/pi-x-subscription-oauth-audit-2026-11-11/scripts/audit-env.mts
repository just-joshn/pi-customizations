import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { Type } from '../../../extensions/pi-x-subscription-oauth/node_modules/typebox/build/index.mjs';
import { Check } from '../../../extensions/pi-x-subscription-oauth/node_modules/typebox/build/value/index.mjs';
import type { createCursorProvider } from '../../../extensions/pi-x-subscription-oauth/src/cursor/provider.ts';

function isolatedAuthDir(dir: string): string {
  if (resolve(dir) === resolve(homedir(), '.pi/agent')) throw new Error('Refusing the real Pi agent dir. Seed an isolated PI_CODING_AGENT_DIR with borrowed access tokens.');
  return dir;
}

export const ISOLATED_AUTH_DIR = isolatedAuthDir(process.env['PI_CODING_AGENT_DIR'] ?? '/tmp/xaudit/piagent');
export const RAW_OUT_DIR = process.env['XAUDIT_OUT'] ?? '/tmp/xaudit';

const StoredCredential = Type.Object({ type: Type.Literal('oauth'), access: Type.String({ minLength: 1 }), refresh: Type.String(), expires: Type.Number() });
const AuthFile = Type.Record(Type.String(), Type.Unknown());

type RefreshContext = Parameters<NonNullable<ReturnType<typeof createCursorProvider>['refreshModels']>>[0];
type StoredOAuth = Extract<NonNullable<RefreshContext['credential']>, { type: 'oauth' }>;

export function storedCredential(provider: 'grok-build' | 'cursor'): StoredOAuth {
  let file: unknown;
  try {
    file = JSON.parse(readFileSync(`${ISOLATED_AUTH_DIR}/auth.json`, 'utf8'));
  } catch (error) {
    throw new Error(`${ISOLATED_AUTH_DIR}/auth.json is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Check(AuthFile, file)) throw new Error(`${ISOLATED_AUTH_DIR}/auth.json is not a JSON object.`);
  const entry = file[provider];
  if (!Check(StoredCredential, entry)) throw new Error(`No valid ${provider} OAuth credential in ${ISOLATED_AUTH_DIR}/auth.json. Seed it first (see report.md, method disclosure).`);
  return entry;
}

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
