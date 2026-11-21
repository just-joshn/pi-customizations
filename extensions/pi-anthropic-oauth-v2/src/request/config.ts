const CLAUDE_CODE_VERSION = '2.1.322';
const MAX_TOKENS_DIVISOR = 3;
const BUDGET_MINIMAL = 1024;
const BUDGET_LOW = 4096;
const BUDGET_MEDIUM = 10240;
const BUDGET_HIGH = 20480;

export const REQUEST_CONFIG = {
  oauthTokenMarker: 'sk-ant-oat',
  oauthBetas: ['claude-code-20250219', 'oauth-2025-04-20'],
  interleavedThinkingBeta: 'interleaved-thinking-2025-05-14',
  oauthHeaders: {
    'anthropic-dangerous-direct-browser-access': 'true',
    'user-agent': `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
    'x-app': 'cli',
  },
  claudeCodeIdentity: "You are Claude Code, Anthropic's official CLI for Claude.",
  maxTokensDivisor: MAX_TOKENS_DIVISOR,
  thinkingDisplay: 'summarized',
  thinkingBudgets: { minimal: BUDGET_MINIMAL, low: BUDGET_LOW, medium: BUDGET_MEDIUM, high: BUDGET_HIGH },
  fallbackThinkingBudget: BUDGET_MEDIUM,
  effortByLevel: { minimal: 'low', low: 'low', medium: 'medium', high: 'high' },
  fallbackEffort: 'high',
} as const;
