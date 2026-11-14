import { createHash } from 'node:crypto';

import type { TranscriptContext } from '@earendil-works/pi-ai';
import { CCH_PLACEHOLDER } from './attestation.ts';

export const CLAUDE_CODE_VERSION = '2.1.316';
export const CLAUDE_USER_AGENT = `claude-cli/${CLAUDE_CODE_VERSION} (external, sdk-cli)`;
const FINGERPRINT_SALT = '59cf53e54c78';
const FINGERPRINT_INDICES = [4, 7, 20];

function fingerprintSample(context: TranscriptContext): string {
  // Pi's coding agent marks injected user messages `isMeta`; pi-ai's message type does not declare it.
  const firstUser = context.messages.find((message) => message.role === 'user' && !('isMeta' in message && message.isMeta === true));
  const content = firstUser?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content.find((block) => block.type === 'text');
    if (text?.type === 'text') return text.text;
  }
  return '';
}

export type RequestId = string & { readonly __brand: 'RequestId' };

export type BillingAttribution = {
  promptId: string;
  turnIndex: number;
  previousRequestId?: RequestId;
};

const REQUEST_ID_PATTERN = /^req_[A-Za-z0-9_-]{1,36}$/;
const TURN_ORIGIN = 'sdk';
const FIRST_PROMPT_INDEX = 0;

export function isRequestId(value: string | null | undefined): value is RequestId {
  return value !== null && value !== undefined && REQUEST_ID_PATTERN.test(value);
}

export function billingBlock(context: TranscriptContext, attribution: BillingAttribution): { type: 'text'; text: string } {
  const text = fingerprintSample(context);
  const sample = FINGERPRINT_INDICES.map((index) => text[index] || '0').join('');
  const fingerprint = createHash('sha256').update(`${FINGERPRINT_SALT}${sample}${CLAUDE_CODE_VERSION}`).digest('hex').slice(0, 3);
  const previous = attribution.previousRequestId === undefined ? '' : ` cc_prev_req=${attribution.previousRequestId};`;
  return {
    type: 'text',
    text: `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${fingerprint}; cc_entrypoint=sdk-cli; ${CCH_PLACEHOLDER};${previous} cc_prompt_id=${attribution.promptId}; cc_turn_origin=${TURN_ORIGIN}; cc_prompt_index=${FIRST_PROMPT_INDEX}; cc_turn_index=${attribution.turnIndex};`,
  };
}

const CLAUDE_BETA_ORDER = [
  'claude-code-20250219',
  'oauth-2025-04-20',
  'interleaved-thinking-2025-05-14',
  'context-management-2025-06-27',
  'prompt-caching-scope-2026-01-05',
  'thinking-token-count-2026-05-13',
  'advanced-tool-use-2025-11-20',
  'effort-2025-11-24',
  'thinking-binding-controls-2026-08-01',
  'extended-cache-ttl-2025-04-11',
  'cache-diagnosis-2026-04-07',
] as const;

/** Pi's provider decides these per model, so they join the header only when Pi sent them. */
const MODEL_DEPENDENT_BETAS: readonly string[] = ['interleaved-thinking-2025-05-14', 'thinking-binding-controls-2026-08-01'];

export function mergeBetas(existing: string | null): string {
  const present = (existing ?? '')
    .split(',')
    .map((beta) => beta.trim())
    .filter((beta) => beta.length > 0);
  const claude: readonly string[] = CLAUDE_BETA_ORDER;
  const ordered = claude.filter((beta) => !MODEL_DEPENDENT_BETAS.includes(beta) || present.includes(beta));
  return [...new Set([...ordered, ...present.filter((beta) => !claude.includes(beta))])].join(',');
}
