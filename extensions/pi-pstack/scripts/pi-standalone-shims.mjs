// Build-time stand-ins for the host packages the two standalone CLI bundles import.
//
// dist/routine-setup.js and dist/automation-serve.js run as plain `node <pkg>/dist/...` from an installed package,
// where Pi does not install its host packages as siblings, so those bundles must not import them. The pieces those
// bundles execute through the redirected specifiers are two small, pure pi-ai functions (pi-ai/providers/all is not redirected and is inlined whole, see build-helpers.mjs); the pi-coding-agent symbols they import are never
// called outside a Pi extension (their only callers run inside pstack_worker, which the CLI bundles do not register).
// scripts/build-helpers.mjs redirects the three host-package imports here for these two entries only. The rest of the
// package keeps the real host packages (external, resolved by Pi at runtime), and typebox is bundled directly.

// Exact copy of pi-ai's StringEnum (packages/ai/src/utils/string-enum.ts), a JSON-schema string enum.
export function StringEnum(values, options) {
  return {
    type: 'string',
    enum: values,
    ...(options?.description && { description: options.description }),
    ...(options?.default && { default: options.default }),
  };
}

// The provider env-key table and findEnvKeys logic from pi-ai (packages/ai/src/env-api-keys.ts, pinned 1.5.0).
// findEnvKeys(provider) reports which of a provider's credential variables are set, so a minimal worker environment
// keeps exactly those. The Bun-sandbox /proc/self/environ fallback is dropped: these bundles run under Node, where it
// is a no-op.
const ANTHROPIC_AUTH_TOKEN_ENV = 'ANTHROPIC_AUTH_TOKEN';
const ANTHROPIC_OAUTH_TOKEN_ENV = 'ANTHROPIC_OAUTH_TOKEN';
const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY';

const API_KEY_ENV = {
  'ant-ling': 'ANT_LING_API_KEY',
  'qwen-token-plan': 'QWEN_TOKEN_PLAN_API_KEY',
  'qwen-token-plan-cn': 'QWEN_TOKEN_PLAN_CN_API_KEY',
  'qwen-token-plan-individual': 'QWEN_TOKEN_PLAN_API_KEY',
  'qwen-token-plan-individual-cn': 'QWEN_TOKEN_PLAN_CN_API_KEY',
  openai: 'OPENAI_API_KEY',
  azure: 'AZURE_OPENAI_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  google: 'GEMINI_API_KEY',
  'google-vertex': 'GOOGLE_CLOUD_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  xai: 'XAI_API_KEY',
  typesafe: 'TYPESAFE_API_KEY',
  radius: 'RADIUS_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'vercel-ai-gateway': 'AI_GATEWAY_API_KEY',
  zai: 'ZAI_API_KEY',
  'zai-coding-cn': 'ZAI_CODING_CN_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  'minimax-cn': 'MINIMAX_CN_API_KEY',
  moonshotai: 'MOONSHOT_API_KEY',
  'moonshotai-cn': 'MOONSHOT_API_KEY',
  huggingface: 'HF_TOKEN',
  fireworks: 'FIREWORKS_API_KEY',
  together: 'TOGETHER_API_KEY',
  baseten: 'BASETEN_API_KEY',
  opencode: 'OPENCODE_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
  'kimi-coding': 'KIMI_API_KEY',
  meta: 'META_API_KEY',
  'cloudflare-workers-ai': 'CLOUDFLARE_API_KEY',
  'cloudflare-ai-gateway': 'CLOUDFLARE_API_KEY',
  xiaomi: 'XIAOMI_API_KEY',
  'xiaomi-token-plan-cn': 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
  'xiaomi-token-plan-ams': 'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
  'xiaomi-token-plan-sgp': 'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
};

function getProviderEnvValue(name, env) {
  return env?.[name] || (typeof process !== 'undefined' ? process.env[name] : undefined);
}

function getApiKeyEnvVars(provider) {
  if (provider === 'github-copilot') return ['COPILOT_GITHUB_TOKEN'];
  if (provider === 'anthropic') return [ANTHROPIC_AUTH_TOKEN_ENV, ANTHROPIC_OAUTH_TOKEN_ENV, ANTHROPIC_API_KEY_ENV];
  const envVar = API_KEY_ENV[provider];
  return envVar === undefined ? undefined : [envVar];
}

export function findEnvKeys(provider, env) {
  const envVars = getApiKeyEnvVars(provider);
  if (!envVars) return undefined;
  const found = envVars.filter((envVar) => !!getProviderEnvValue(envVar, env));
  return found.length > 0 ? found : undefined;
}

// pi-coding-agent symbols the standalone bundles import but never call. A throw makes a latent call fail loudly
// rather than as `undefined is not a function`.
const outsidePi = (name) => () => {
  throw new Error(`${name} is only available inside a Pi extension; the standalone automation bundles do not call it`);
};
export const createBashTool = outsidePi('createBashTool');
export const createLocalBashOperations = outsidePi('createLocalBashOperations');
export const createBashToolDefinition = outsidePi('createBashToolDefinition');
export const getShellConfig = outsidePi('getShellConfig');
