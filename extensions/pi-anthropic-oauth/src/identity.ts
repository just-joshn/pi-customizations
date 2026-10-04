import { createHash } from 'node:crypto';

import type { TranscriptContext } from '@earendil-works/pi-ai';

export const CLAUDE_CODE_VERSION = '2.1.288';
export const CLAUDE_USER_AGENT = `claude-cli/${CLAUDE_CODE_VERSION} (external, sdk-cli)`;
const FINGERPRINT_SALT = '59cf53e54c78';
const FINGERPRINT_INDICES = [4, 7, 20];

export function billingBlock(context: TranscriptContext): { type: 'text'; text: string } {
  const firstUser = context.messages.find((message) => message.role === 'user');
  const content = firstUser?.content;
  const text = typeof content === 'string' ? content : (content?.find((block) => block.type === 'text')?.text ?? '');
  const sample = FINGERPRINT_INDICES.map((index) => text[index] || '0').join('');
  const fingerprint = createHash('sha256').update(`${FINGERPRINT_SALT}${sample}${CLAUDE_CODE_VERSION}`).digest('hex').slice(0, 3);
  return { type: 'text', text: `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${fingerprint}; cc_entrypoint=sdk-cli;` };
}
