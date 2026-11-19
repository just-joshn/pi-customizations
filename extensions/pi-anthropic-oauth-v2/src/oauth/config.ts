const SECONDS_TO_MS = 1000;
const MINUTES_TO_MS = 60 * SECONDS_TO_MS;

export const OAUTH_CONFIG = {
  name: 'Custom Anthropic (Claude Pro/Max)',
  // biome-ignore lint/security/noSecrets: Claude Code's public OAuth client ID, not a user credential.
  clientId: atob('OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl'),
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  redirectUri: 'https://console.anthropic.com/oauth/code/callback',
  scopes: 'org:create_api_key user:profile user:inference',
  codePrompt: 'Paste the authorization code:',
  codeStateSeparator: '#',
  pkceVerifierBytes: 32,
  pkceDigest: 'SHA-256',
  pkceMethod: 'S256',
  secondsToMs: SECONDS_TO_MS,
  expirySkewMs: 5 * MINUTES_TO_MS,
} as const;
