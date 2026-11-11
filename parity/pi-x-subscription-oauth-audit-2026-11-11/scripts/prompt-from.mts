import { promptFrom } from '../../../extensions/pi-x-subscription-oauth/src/cursor/stream.ts';

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const messages = [
  { role: 'user', content: 'What is 2+2?', timestamp: 1 },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'secret chain of thought' },
      { type: 'text', text: '4' },
    ],
    api: 'cursor-agent',
    provider: 'cursor',
    model: 'composer-2.5',
    usage,
    stopReason: 'stop',
    timestamp: 2,
  },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Now read file.txt' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ],
    timestamp: 3,
  },
  { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'FILE CONTENTS' }], isError: false, timestamp: 4 },
] satisfies Parameters<typeof promptFrom>[0];
console.log(JSON.stringify(promptFrom(messages)));
