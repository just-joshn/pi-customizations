import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { CLAUDE_CODE_VERSION, isRequestId } from './identity.ts';
import { CLAUDE_API_BASE_URL } from './oauth.ts';

export const CLAUDE_ACCOUNT_USER_AGENT = `claude-code/${CLAUDE_CODE_VERSION}`;
const ACCOUNT_TIMEOUT_MS = 10_000;

const ClaudeOAuthProfile = Type.Object({
  account: Type.Object({ uuid: Type.String(), email: Type.String() }),
  organization: Type.Object({ uuid: Type.String() }),
});

export type ClaudeOAuthProfile = Static<typeof ClaudeOAuthProfile>;

export type ClaudeProfileResult = {
  profile: ClaudeOAuthProfile;
  hasRequestId: boolean;
};

const OptionalName = Type.Optional(Type.Union([Type.String(), Type.Null()]));

const ClaudeOAuthRoles = Type.Object({ organization_role: OptionalName, workspace_role: OptionalName, organization_name: OptionalName });

export type ClaudeOAuthRoles = Static<typeof ClaudeOAuthRoles>;

const CreatedApiKey = Type.Object({ raw_key: Type.String({ minLength: 1 }) });

export type ClaudeAccountOptions = { apiBaseUrl?: string; signal?: AbortSignal };

function signalFor(options: ClaudeAccountOptions): AbortSignal {
  const timeout = AbortSignal.timeout(ACCOUNT_TIMEOUT_MS);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

function baseOf(options: ClaudeAccountOptions): string {
  return options.apiBaseUrl ?? CLAUDE_API_BASE_URL;
}

export async function fetchOAuthProfile(access: string, options: ClaudeAccountOptions = {}): Promise<ClaudeProfileResult> {
  const response = await fetch(`${baseOf(options)}/api/oauth/profile`, {
    method: 'GET',
    headers: { 'User-Agent': CLAUDE_ACCOUNT_USER_AGENT, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    signal: signalFor(options),
  });
  if (!response.ok) throw new Error(`Failed to fetch oauth profile from OAuth token: ${response.status} ${response.statusText}`);
  const data: unknown = await response.json();
  if (!Check(ClaudeOAuthProfile, data)) throw new Error('OAuth profile: response body failed shape validation');
  return { profile: data, hasRequestId: isRequestId(response.headers.get('request-id')) };
}

export async function validateOAuthToken(access: string, options: ClaudeAccountOptions = {}): Promise<unknown> {
  const response = await fetch(`${baseOf(options)}/api/oauth/validate`, {
    method: 'POST',
    headers: { 'User-Agent': CLAUDE_ACCOUNT_USER_AGENT, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    signal: signalFor(options),
  });
  if (!response.ok) throw new Error(`Failed to validate OAuth token: ${response.status} ${response.statusText}`);
  return response.json();
}

export async function fetchOAuthRoles(access: string, options: ClaudeAccountOptions = {}): Promise<ClaudeOAuthRoles> {
  const response = await fetch(`${baseOf(options)}/api/oauth/claude_cli/roles`, {
    method: 'GET',
    headers: { 'User-Agent': CLAUDE_ACCOUNT_USER_AGENT, Authorization: `Bearer ${access}` },
    signal: signalFor(options),
  });
  if (response.status !== 200) throw new Error(`Failed to fetch user roles: ${response.statusText}`);
  const data: unknown = await response.json();
  if (!Check(ClaudeOAuthRoles, data)) throw new Error('Failed to fetch user roles: malformed body');
  return data;
}

export async function createOAuthApiKey(access: string, options: ClaudeAccountOptions = {}): Promise<string | null> {
  const response = await fetch(`${baseOf(options)}/api/oauth/claude_cli/create_api_key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'User-Agent': CLAUDE_ACCOUNT_USER_AGENT },
    signal: signalFor(options),
  });
  if (!response.ok) throw new Error(`Failed to create API key: ${response.status} ${response.statusText}`);
  const data: unknown = await response.json();
  return Check(CreatedApiKey, data) ? data.raw_key : null;
}
