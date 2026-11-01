import { createHash } from 'node:crypto';

import type { TranscriptContext } from '@earendil-works/pi-ai';

export const CLAUDE_CODE_VERSION = '2.1.316';
export const CLAUDE_USER_AGENT = `claude-cli/${CLAUDE_CODE_VERSION} (external, sdk-cli)`;
const FINGERPRINT_SALT = '59cf53e54c78';
const FINGERPRINT_INDICES = [4, 7, 20];

type FingerprintFlags = {
  isMeta?: boolean;
};

function fingerprintSample(context: TranscriptContext): string {
  const firstUser = context.messages.find((message) => {
    if (message.role !== 'user') return false;
    const flags = message as FingerprintFlags;
    return flags.isMeta !== true;
  });
  const content = firstUser?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content.find((block) => block.type === 'text');
    if (text?.type === 'text') return text.text;
  }
  return '';
}

export function billingBlock(context: TranscriptContext): { type: 'text'; text: string } {
  const text = fingerprintSample(context);
  const sample = FINGERPRINT_INDICES.map((index) => text[index] || '0').join('');
  const fingerprint = createHash('sha256').update(`${FINGERPRINT_SALT}${sample}${CLAUDE_CODE_VERSION}`).digest('hex').slice(0, 3);
  return { type: 'text', text: `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${fingerprint}; cc_entrypoint=sdk-cli;` };
}
