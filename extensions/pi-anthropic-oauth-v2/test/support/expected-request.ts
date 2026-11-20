import { ANTHROPIC_URL, BUDGET_HIGH, CLAUDE_CODE_IDENTITY, DEFAULT_MAX_TOKENS, DEFAULT_MODEL_ID, EPHEMERAL } from './constants.ts';

const PNG_SOURCE = { type: 'base64', media_type: 'image/png', data: 'AAA' };
const JPEG_SOURCE = { type: 'base64', media_type: 'image/jpeg', data: 'BBB' };
const TOOL_RESULT_IMAGE = [
  { type: 'text', text: '(see attached image)' },
  { type: 'image', source: JPEG_SOURCE },
];

const EXPECTED_MESSAGES = [
  { role: 'user', content: 'hello' },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'look \uFFFD' },
      { type: 'image', source: PNG_SOURCE },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'text', text: 'ok' },
      { type: 'thinking', thinking: 'signed', signature: 'sig' },
      { type: 'text', text: 'unsigned' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a' } },
      { type: 'tool_use', id: 't2', name: 'my_tool', input: {} },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'file', is_error: false },
      { type: 'tool_result', tool_use_id: 't2', content: TOOL_RESULT_IMAGE, is_error: true, cache_control: EPHEMERAL },
    ],
  },
];

export const OAUTH_API_KEY = 'sk-ant-oat01-x';

export const EXPECTED_OAUTH_OPTIONS = {
  baseURL: ANTHROPIC_URL,
  authToken: OAUTH_API_KEY,
  defaultHeaders: {
    'anthropic-dangerous-direct-browser-access': 'true',
    'user-agent': 'claude-cli/2.1.322 (external, cli)',
    'x-app': 'cli',
  },
};

export const EXPECTED_OAUTH_PARAMS = {
  model: DEFAULT_MODEL_ID,
  max_tokens: DEFAULT_MAX_TOKENS,
  stream: true,
  system: [
    { type: 'text', text: CLAUDE_CODE_IDENTITY, cache_control: EPHEMERAL },
    { type: 'text', text: 'Be brief.', cache_control: EPHEMERAL },
  ],
  betas: ['claude-code-20250219', 'oauth-2025-04-20', 'interleaved-thinking-2025-05-14'],
  tools: [
    { name: 'Read', description: 'Read a file', eager_input_streaming: true, input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'my_tool', description: 'Custom', eager_input_streaming: true, input_schema: { type: 'object', properties: {}, required: [] } },
  ],
  thinking: { type: 'enabled', budget_tokens: BUDGET_HIGH, display: 'summarized' },
  messages: EXPECTED_MESSAGES,
};
