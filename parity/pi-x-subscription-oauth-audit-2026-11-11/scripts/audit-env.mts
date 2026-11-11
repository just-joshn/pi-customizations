import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Type } from '../../../extensions/pi-x-subscription-oauth/node_modules/typebox/build/index.mjs';
import { Check } from '../../../extensions/pi-x-subscription-oauth/node_modules/typebox/build/value/index.mjs';
import type { createGrokBuildProvider } from '../../../extensions/pi-x-subscription-oauth/src/index.ts';

function sameDirectory(left: string, right: string): boolean {
  try {
    const a = statSync(left);
    const b = statSync(right);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

function isolatedAuthDir(dir: string): string {
  if (sameDirectory(dir, join(homedir(), '.pi/agent'))) throw new Error('Refusing the real Pi agent dir. Seed an isolated PI_CODING_AGENT_DIR with borrowed access tokens.');
  return dir;
}

export const ISOLATED_AUTH_DIR = isolatedAuthDir(process.env['PI_CODING_AGENT_DIR'] ?? '/tmp/xaudit/piagent');

const StoredCredential = Type.Object({ type: Type.Literal('oauth'), access: Type.String({ minLength: 1 }), refresh: Type.String(), expires: Type.Number() });
const AuthFile = Type.Record(Type.String(), Type.Unknown());

type RefreshModelsContext = Parameters<NonNullable<ReturnType<typeof createGrokBuildProvider>['refreshModels']>>[0];
type OAuthCredential = Extract<NonNullable<RefreshModelsContext['credential']>, { type: 'oauth' }>;

export function storedCredential(provider: 'grok-build' | 'cursor'): OAuthCredential {
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

export function refreshContext(credential: OAuthCredential): RefreshModelsContext {
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
