import { readFileSync } from 'node:fs';

import type { OAuthCredential } from '../../../extensions/pi-x-subscription-oauth/node_modules/@earendil-works/pi-ai/dist/index.js';

/** The isolated Pi agent dir that holds borrowed access tokens. Never point this at ~/.pi/agent. */
export const AUTH_DIR = process.env['PI_CODING_AGENT_DIR'] ?? '/tmp/xaudit/piagent';
/** Where probes write raw output. Copy only redacted output into evidence/. */
export const OUT_DIR = process.env['XAUDIT_OUT'] ?? '/tmp/xaudit';

export function storedCredential(provider: 'grok-build' | 'cursor'): OAuthCredential {
  const stored = JSON.parse(readFileSync(`${AUTH_DIR}/auth.json`, 'utf8')) as Record<string, OAuthCredential | undefined>;
  const credential = stored[provider];
  if (!credential) throw new Error(`No ${provider} credential in ${AUTH_DIR}/auth.json. Seed it first (see report.md, method disclosure).`);
  return credential;
}

/** Stands in for Pi's models store so refreshModels fetches from the network and keeps the result. */
export function refreshContext(credential: OAuthCredential) {
  return {
    credential,
    allowNetwork: true,
    force: true,
    publish: async (publication: { update?: () => void }) => {
      publication.update?.();
      return true;
    },
    signal: AbortSignal.timeout(30_000),
  };
}
