export const ALLOWED_OAUTH_BASE_URLS = ['https://beacon.claude-ai.staging.ant.dev', 'https://claude.fedstart.com', 'https://claude-staging.fedstart.com'] as const;

export const CUSTOM_OAUTH_URL_ENV = 'CLAUDE_CODE_CUSTOM_OAUTH_URL';

export const CUSTOM_OAUTH_URL_UNAPPROVED = 'CLAUDE_CODE_CUSTOM_OAUTH_URL is not an approved endpoint.';

export type AllowedOAuthBase = (typeof ALLOWED_OAUTH_BASE_URLS)[number];

function isAllowedOAuthBase(value: string): value is AllowedOAuthBase {
  return ALLOWED_OAUTH_BASE_URLS.some((allowed) => allowed === value);
}

export function resolveCustomOAuthBase(raw: string | undefined): AllowedOAuthBase | undefined {
  if (!raw) return undefined;
  const base = raw.replace(/\/$/, '');
  if (isAllowedOAuthBase(base)) return base;
  throw new Error(CUSTOM_OAUTH_URL_UNAPPROVED);
}

export function readCustomOAuthBaseFromEnv(env: NodeJS.Dict<string> = process.env): AllowedOAuthBase | undefined {
  return resolveCustomOAuthBase(env[CUSTOM_OAUTH_URL_ENV]);
}
