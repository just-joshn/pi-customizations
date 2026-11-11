// Which extension error texts Pi's agent retries. Pi 1.5.2 retries these up to settings.retry.maxRetries (default 3) more times.
const { isRetryableAssistantError } = await import(`${process.env['PI_AI_DIST'] ?? `${process.env['HOME']}/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-ai/dist`}/utils/retry.js`);
for (const errorMessage of ['Cursor ask timed out.', 'Error', 'cursor-agent exited 1.', 'grok-build API error (402): 402 "Grok Build usage balance exhausted"']) {
  console.log(JSON.stringify(errorMessage), '->', isRetryableAssistantError({ stopReason: 'error', errorMessage }));
}
