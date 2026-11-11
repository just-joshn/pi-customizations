import { createCursorStreams, readAgentResult, runCursorAgent } from '../../../extensions/pi-x-subscription-oauth/src/cursor/stream.ts';

// Run with fakebin first on PATH: a cursor-agent that answers successfully after 130 s.
const started = Date.now();
const run = await runCursorAgent(['--print', '--', 'hi'], undefined);
console.log('after', Math.round((Date.now() - started) / 1000), 's code', run.code, 'stdout', JSON.stringify(run.stdout), 'parsed', JSON.stringify(readAgentResult(run.stdout)));

// The same run result through the adapter's error path shows the text a Pi user sees.
const stream = createCursorStreams(async () => run).streamSimple(
  { id: 'composer-2.5', api: 'cursor-agent', provider: 'cursor', name: 'Composer 2.5', baseUrl: '', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1, maxTokens: 1 },
  { messages: [{ role: 'user', content: 'hi', timestamp: 0 }] },
  { apiKey: 'audit' },
);
for await (const event of stream) if (event.type === 'error') console.log('Pi error:', event.error.errorMessage);
