import type { AssistantMessage } from '@earendil-works/pi-ai';
import { isRetryableAssistantError } from '@earendil-works/pi-ai';
import { expect, it } from 'vitest';
import { API_ID, PROVIDER_ID } from '../src/constants.ts';
import { POLICY_ALLOW_ENV, policyRejection, transportFailure } from '../src/errors.ts';

const ACCOUNT_URL = 'https://antigravity.google';
const TOS = 'This service has been disabled in this account for violation of Terms of Service. Please submit an appeal to continue using this product.';
const INTERNAL = 'blocked by Google internal policy';
const ENTERPRISE = 'Gateway authentication is disabled by enterprise policy';

function errorMessage(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: API_ID,
    provider: PROVIDER_ID,
    model: 'gemini-3.8-flash',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'error',
    errorMessage: text,
    timestamp: 1,
  };
}

/**
 * The contract is the classifier: Pi must never retry an account block, because a
 * block is deterministic and a retry only spends quota.
 */
function expectAccountBlock(message: string | undefined): void {
  if (message === undefined) throw new Error('expected a policy error');
  expect(message).toContain('policy');
  expect(isRetryableAssistantError(errorMessage(message))).toBe(false);
}

it('names the account URL for each observed Antigravity block', () => {
  const block = policyRejection(`\n\u26a0 ${TOS}\n`);
  expectAccountBlock(block);
  // An appeal starts from the account page, so the block must name it.
  expect(block).toContain(ACCOUNT_URL);
  expectAccountBlock(policyRejection(`notice: ${INTERNAL}`));
  expectAccountBlock(policyRejection(ENTERPRISE));
  expect(policyRejection('hello world')).toBeUndefined();
  expect(policyRejection('')).toBeUndefined();
});

it('exports the operator override that leaves a block as ordinary text', () => {
  expect(POLICY_ALLOW_ENV).toBe('PI_AGY_ALLOW_POLICY');
});

it('keeps the transport message, stderr, and a process exit', () => {
  expect(transportFailure(new Error('connection reset'), '')).toBe('connection reset');
  expect(transportFailure(new Error('request failed'), 'stderr line')).toBe('request failed\nstderr line');
  expect(transportFailure(new Error('agy exited with code 1'), 'tail')).toContain('exit');
  expect(transportFailure({ message: 'gone', exitCode: 2 }, '')).toContain('process exit 2');
  expect(transportFailure({ message: 'killed', signal: 'SIGKILL' }, '')).toContain('process exit signal SIGKILL');
  expect(transportFailure('plain', '')).toBe('plain');
  expect(transportFailure(1, '')).toBe('Antigravity CLI request failed');
});
