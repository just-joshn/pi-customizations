import type { Credential } from '@earendil-works/pi-ai';

export const CURSOR_CONFIG = {
  providerId: 'spacex-cursor',
  name: 'Cursor (X subscription)',
  api: 'cursor-sdk',
  // Agents run in-process through @cursor/sdk, so Pi never calls this URL. Pi requires one per provider.
  baseUrl: 'https://api.cursor.com',
  apiKeyEnv: 'CURSOR_API_KEY',
  apiKeyName: 'Pi (pi-spacex-oauth-v2)',
  // A Cursor run waits this long for Pi to answer a tool call before it is cancelled.
  toolWaitMs: 30 * 60_000,
  // Parallel tool calls in one model step reach execute() back to back; this gathers them into one Pi turn.
  toolBatchMs: 25,
  maxIdleAgents: 16,
} as const;

/** The API key Pi resolved for this provider: the minted key from /login, or CURSOR_API_KEY. */
export function cursorApiKey(credential: Credential | undefined): string | undefined {
  if (credential?.type === 'oauth') return credential.access;
  if (credential?.type === 'api_key' && credential.key) return credential.key;
  return process.env[CURSOR_CONFIG.apiKeyEnv] || undefined;
}
