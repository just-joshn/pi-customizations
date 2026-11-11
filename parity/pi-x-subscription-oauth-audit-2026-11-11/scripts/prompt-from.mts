const { promptFrom } = await import('/Users/josh-desktop/src/personal/pi-x-subscription-oauth-audit/extensions/pi-x-subscription-oauth/src/cursor/stream.ts');
const messages = [
  { role: 'user', content: 'What is 2+2?' },
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret chain of thought' }, { type: 'text', text: '4' }] },
  { role: 'user', content: [{ type: 'text', text: 'Now read file.txt' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }] },
  { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'FILE CONTENTS' }] },
];
console.log(JSON.stringify(promptFrom(messages as any)));
