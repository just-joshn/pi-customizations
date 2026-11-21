export const ANTHROPIC_URL = 'https://api.anthropic.com';
export const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
export const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
export const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
export const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const PROVIDER_ID = 'custom-anthropic';
export const DEFAULT_MODEL_ID = 'claude-sonnet-4-5';
export const ADAPTIVE_MODEL_ID = 'claude-sonnet-5-5';
export const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
export const EPHEMERAL = { type: 'ephemeral' } as const;

// Model catalog entry for claude-sonnet-4-5.
export const COST_INPUT_PER_MILLION = 3;
export const COST_OUTPUT_PER_MILLION = 15;
export const COST_CACHE_READ_PER_MILLION = 0.3;
export const COST_CACHE_WRITE_PER_MILLION = 3.75;
export const CONTEXT_WINDOW = 200000;
export const MODEL_MAX_TOKENS = 64000;

// Request limits derived from the model's maxTokens.
export const DEFAULT_MAX_TOKENS = 21333;
export const ADAPTIVE_DEFAULT_MAX_TOKENS = 42666;
export const CUSTOM_MAX_TOKENS = 100;
export const BUDGET_HIGH = 20480;
export const BUDGET_FALLBACK = 10240;
export const BUDGET_CUSTOM_LOW = 7;

// OAuth timing.
export const TOKEN_LIFETIME_SECONDS = 3600;
export const SHORT_LIFETIME_SECONDS = 60;
export const MS_PER_SECOND = 1000;
export const EXPIRY_SKEW_MS = 300_000;

// Streamed usage.
export const BLOCK_TEXT = 1;
export const BLOCK_TOOL = 2;
export const BLOCK_UNKNOWN = 9;
export const INPUT_TOKENS = 10;
export const OUTPUT_TOKENS_START = 1;
export const OUTPUT_TOKENS_FINAL = 20;
export const CACHE_READ_TOKENS = 2;
export const CACHE_WRITE_TOKENS = 3;
export const TOTAL_TOKENS = 35;
export const COST_PRECISION = 12;
export const COST_INPUT = 0.00003;
export const COST_OUTPUT = 0.0003;
export const COST_CACHE_READ = 6e-7;
export const COST_CACHE_WRITE = 0.00001125;
export const COST_TOTAL = 0.00034185;
export const STATUS_RATE_LIMITED = 429;

// Thinking budgets next to the output limit.
export const BUDGET_ABOVE_DEFAULT_MAX = 30000;
