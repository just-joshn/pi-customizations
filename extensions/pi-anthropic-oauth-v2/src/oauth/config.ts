const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const EXPIRY_SKEW_MINUTES = 5;
const EXPIRY_SKEW_MS = EXPIRY_SKEW_MINUTES * MS_PER_MINUTE;
const PKCE_VERIFIER_BYTES = 32;
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';

export const OAUTH_CONFIG = {
  name: 'Custom Anthropic (Claude Pro/Max)',
  // biome-ignore lint/security/noSecrets: Claude Code's public OAuth client ID, not a user credential.
  clientId: atob('OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl'),
  authorizeUrl: AUTHORIZE_URL,
  tokenUrl: TOKEN_URL,
  redirectUri: REDIRECT_URI,
  scopes: 'org:create_api_key user:profile user:inference',
  codePrompt: 'Paste the authorization code:',
  codeStateSeparator: '#',
  pkceVerifierBytes: PKCE_VERIFIER_BYTES,
  pkceDigest: 'SHA-256',
  pkceMethod: 'S256',
  secondsToMs: MS_PER_SECOND,
  expirySkewMs: EXPIRY_SKEW_MS,
} as const;
