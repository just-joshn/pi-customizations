import { CLAUDE_CODE_VERSION, isRequestId } from './identity.ts';
import { CLAUDE_API_BASE_URL } from './oauth.ts';

/** Claude `Xs()`: the user agent of the account calls, distinct from the Messages user agent. */
export const CLAUDE_ACCOUNT_USER_AGENT = `claude-code/${CLAUDE_CODE_VERSION}`;
const ACCOUNT_TIMEOUT_MS = 10_000;

export type ClaudeOAuthProfile = {
  account: { uuid: string; email: string; [key: string]: unknown };
  organization: { uuid: string; [key: string]: unknown };
  [key: string]: unknown;
};

export type ClaudeProfileResult = {
  profile: ClaudeOAuthProfile;
  /** Whether the response carried an Anthropic `request-id`, which Claude uses to stamp the profile's origin. */
  stamped: boolean;
};

export type ClaudeOAuthRoles = {
  organization_role?: string | null;
  workspace_role?: string | null;
  organization_name?: string | null;
  [key: string]: unknown;
};

export type ClaudeAccountOptions = { apiBaseUrl?: string; signal?: AbortSignal };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProfile(value: unknown): value is ClaudeOAuthProfile {
  if (!isRecord(value) || !isRecord(value['account']) || !isRecord(value['organization'])) return false;
  return typeof value['account']['uuid'] === 'string' && typeof value['account']['email'] === 'string' && typeof value['organization']['uuid'] === 'string';
}

function signalFor(options: ClaudeAccountOptions): AbortSignal {
  const timeout = AbortSignal.timeout(ACCOUNT_TIMEOUT_MS);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

function baseOf(options: ClaudeAccountOptions): string {
  return options.apiBaseUrl ?? CLAUDE_API_BASE_URL;
}

/** GET `/api/oauth/profile` with a Bearer token. */
export async function fetchOAuthProfile(access: string, options: ClaudeAccountOptions = {}): Promise<ClaudeProfileResult> {
  const response = await fetch(`${baseOf(options)}/api/oauth/profile`, {
    method: 'GET',
    headers: { 'User-Agent': CLAUDE_ACCOUNT_USER_AGENT, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    signal: signalFor(options),
  });
  if (!response.ok) throw new Error(`Failed to fetch oauth profile from OAuth token: ${response.status} ${response.statusText}`);
  const data: unknown = await response.json();
  if (!isProfile(data)) throw new Error('OAuth profile: response body failed shape validation');
  return { profile: data, stamped: isRequestId(response.headers.get('request-id')) };
}

/** POST `/api/oauth/validate`. Resolves the response body, rejects on any non-2xx. */
export async function validateOAuthToken(access: string, options: ClaudeAccountOptions = {}): Promise<unknown> {
  const response = await fetch(`${baseOf(options)}/api/oauth/validate`, {
    method: 'POST',
    headers: { 'User-Agent': CLAUDE_ACCOUNT_USER_AGENT, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    signal: signalFor(options),
  });
  if (!response.ok) throw new Error(`Failed to validate OAuth token: ${response.status} ${response.statusText}`);
  return response.json();
}

/** GET `/api/oauth/claude_cli/roles`. */
export async function fetchOAuthRoles(access: string, options: ClaudeAccountOptions = {}): Promise<ClaudeOAuthRoles> {
  const response = await fetch(`${baseOf(options)}/api/oauth/claude_cli/roles`, {
    method: 'GET',
    headers: { 'User-Agent': CLAUDE_ACCOUNT_USER_AGENT, Authorization: `Bearer ${access}` },
    signal: signalFor(options),
  });
  if (response.status !== 200) throw new Error(`Failed to fetch user roles: ${response.statusText}`);
  const data: unknown = await response.json();
  if (!isRecord(data)) throw new Error('Failed to fetch user roles: malformed body');
  return data;
}

/** POST `/api/oauth/claude_cli/create_api_key`, the call the `org:create_api_key` scope exists for. Null when the body carries no key. */
export async function createOAuthApiKey(access: string, options: ClaudeAccountOptions = {}): Promise<string | null> {
  const response = await fetch(`${baseOf(options)}/api/oauth/claude_cli/create_api_key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'User-Agent': CLAUDE_ACCOUNT_USER_AGENT },
    signal: signalFor(options),
  });
  if (!response.ok) throw new Error(`Failed to create API key: ${response.status} ${response.statusText}`);
  const data: unknown = await response.json();
  const key = isRecord(data) ? data['raw_key'] : undefined;
  return typeof key === 'string' && key.length > 0 ? key : null;
}
