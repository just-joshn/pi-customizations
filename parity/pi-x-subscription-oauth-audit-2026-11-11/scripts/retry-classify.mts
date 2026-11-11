import { isRetryableAssistantError } from '../../../extensions/pi-x-subscription-oauth/node_modules/@earendil-works/pi-ai/dist/utils/retry.js';

// Which extension error texts Pi's agent retries; Pi retries them up to settings.retry.maxRetries (default 3) more times.
// This is pi-ai 1.5.0 from the package's devDependencies. Pi 1.5.2's retry.js differs only by one added pattern,
// "cut short after the reply had begun", which none of these messages contains (decisions.tsv).
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
for (const errorMessage of ['Cursor ask timed out.', 'Error', 'cursor-agent exited 1.', 'grok-build API error (402): 402 "Grok Build usage balance exhausted"']) {
  const retryable = isRetryableAssistantError({ role: 'assistant', content: [], api: 'cursor-agent', provider: 'cursor', model: 'composer-2.5', usage, stopReason: 'error', errorMessage, timestamp: 0 });
  console.log(JSON.stringify(errorMessage), '->', retryable);
}
