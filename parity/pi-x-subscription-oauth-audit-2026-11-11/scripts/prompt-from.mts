import type { TranscriptContext } from '../../../extensions/pi-x-subscription-oauth/node_modules/@earendil-works/pi-ai/dist/index.js';
import { promptFrom } from '../../../extensions/pi-x-subscription-oauth/src/cursor/stream.ts';

// A four-message Pi transcript, flattened the way the Cursor adapter sends it.
const messages = [
  { role: 'user', content: 'What is 2+2?' },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'secret chain of thought' },
      { type: 'text', text: '4' },
    ],
  },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Now read file.txt' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
    ],
  },
  { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'FILE CONTENTS' }] },
] as unknown as TranscriptContext['messages'];
console.log(JSON.stringify(promptFrom(messages)));
