import type { Credential } from '@earendil-works/pi-ai';
import { z } from 'zod';

const CURSOR_BASE_URL = 'https://api.cursor.com';
const MS_PER_MINUTE = 60_000;
const TOOL_WAIT_MINUTES = 30;
const TOOL_BATCH_MS = 25;
const MAX_IDLE_AGENTS = 16;

export const CURSOR_CONFIG = {
  providerId: 'spacex-cursor',
  name: 'Cursor (X subscription)',
  api: 'cursor-sdk',
  // Agents run in-process through @cursor/sdk, so Pi never calls this URL. Pi requires one per provider.
  baseUrl: CURSOR_BASE_URL,
  apiKeyEnv: 'CURSOR_API_KEY',
  apiKeyName: 'Pi (pi-spacex-oauth-v2)',
  // A Cursor run waits this long for Pi to answer a tool call before it is cancelled.
  toolWaitMs: TOOL_WAIT_MINUTES * MS_PER_MINUTE,
  // Parallel tool calls in one model step reach execute() back to back; this gathers them into one Pi turn.
  toolBatchMs: TOOL_BATCH_MS,
  maxIdleAgents: MAX_IDLE_AGENTS,
} as const;

const Environment = z.object({ [CURSOR_CONFIG.apiKeyEnv]: z.string().optional() });

/** The API key Pi resolved for this provider: the minted key from /login, or CURSOR_API_KEY. */
export function cursorApiKey(credential: Credential | undefined): string | undefined {
  if (credential?.type === 'oauth') return credential.access;
  if (credential?.type === 'api_key' && credential.key) return credential.key;
  return Environment.parse(process.env)[CURSOR_CONFIG.apiKeyEnv] || undefined;
}
