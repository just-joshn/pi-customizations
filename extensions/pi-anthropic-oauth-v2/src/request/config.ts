const BETA_FEATURES = ['fine-grained-tool-streaming-2025-05-14', 'interleaved-thinking-2025-05-14'] as const;
const OAUTH_BETA_FEATURES = ['claude-code-20250219', 'oauth-2025-04-20', ...BETA_FEATURES] as const;

const BASE_HEADERS = {
  accept: 'application/json',
  'anthropic-dangerous-direct-browser-access': 'true',
} as const;

export const REQUEST_CONFIG = {
  oauthTokenMarker: 'sk-ant-oat',
  apiKeyHeaders: { ...BASE_HEADERS, 'anthropic-beta': BETA_FEATURES.join(',') },
  oauthHeaders: {
    ...BASE_HEADERS,
    'anthropic-beta': OAUTH_BETA_FEATURES.join(','),
    'user-agent': 'claude-cli/2.1.2 (external, cli)',
    'x-app': 'cli',
  },
  claudeCodeIdentity: "You are Claude Code, Anthropic's official CLI for Claude.",
  maxTokensDivisor: 3,
  thinkingBudgets: { minimal: 1024, low: 4096, medium: 10240, high: 20480 } as Readonly<Record<string, number>>,
  fallbackThinkingBudget: 10240,
  imageOnlyPlaceholder: '(see attached image)',
  claudeCodeTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'AskUserQuestion', 'TodoWrite', 'WebFetch', 'WebSearch'],
} as const;

export const EPHEMERAL_CACHE = { type: 'ephemeral' } as const;
