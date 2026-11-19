const CLAUDE_CODE_VERSION = '2.1.322';

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
  maxTokensDivisor: 3,
  thinkingDisplay: 'summarized',
  thinkingBudgets: { minimal: 1024, low: 4096, medium: 10240, high: 20480 } as Readonly<Record<string, number>>,
  fallbackThinkingBudget: 10240,
  effortByLevel: { minimal: 'low', low: 'low', medium: 'medium', high: 'high' } as Readonly<Record<string, string>>,
  fallbackEffort: 'high',
  imageOnlyPlaceholder: '(see attached image)',
  claudeCodeTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'AskUserQuestion', 'TodoWrite', 'WebFetch', 'WebSearch'],
} as const;

export const EPHEMERAL_CACHE = { type: 'ephemeral' } as const;
