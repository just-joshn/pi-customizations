import { Check } from 'typebox/value';
import { expect, test } from 'vitest';
import { parseRoutine } from '../scripts/routine-domain.mjs';
import { parseCi } from '../scripts/timer-ci.mjs';
import { CiSubscriptionOutput, RoutineEnableOutput, RoutineInspectOutput, SubscriptionListOutput } from '../src/timer-routine-output-schemas.ts';

const root = { subscriptionId: 'subscription', runId: 'root', sessionFile: '/session', rpcDirectory: '/rpc' };

test.for(['github', 'origin'] as const)('CI receipts include normalized internal fields for %s', (forge) => {
  const { pollSeconds, ...ci } = parseCi({ forge, pr: 1, cwd: '/work', ...(forge === 'origin' ? { command: ['/origin-ci'] } : {}) });
  const receipt = { ...ci, ...root, kind: 'ci', delaySeconds: pollSeconds };
  expect(Check(CiSubscriptionOutput, { ...receipt, execution: 'Dedicated root' })).toBe(true);
  expect(
    Check(SubscriptionListOutput, [
      { ...receipt, ci: {} },
      { ...receipt, ci: { state: 'failure', head: 'sha', error: 'failed poll' }, status: 'needs_reconciliation', error: 'ambiguous occurrence' },
    ]),
  ).toBe(true);
  expect(Check(CiSubscriptionOutput, { subscriptionId: 'missing-fields' })).toBe(false);
});

const definition = { ...parseRoutine({ name: 'routine', prompt: 'Read data', fields: ['action'] }), directory: '/routine' };
const ready = { ...definition, kind: 'ready', pid: 123, url: 'http://127.0.0.1:123/webhook', rpcDirectory: '/rpc', runId: 'root', sessionFile: '/session' };

test.for([
  { ...definition, kind: 'disabled' },
  { ...definition, kind: 'disabled', pid: 123, pending: 1 },
  { ...definition, kind: 'starting', pid: 123 },
  { ...definition, kind: 'failed', error: 'exited' },
  { ...definition, kind: 'failed', pid: 123, error: 'failed' },
  ready,
])('inspection represents the service status %j', (receipt) => {
  expect(Check(RoutineInspectOutput, receipt)).toBe(true);
});

test('activation accepts only denial or a complete ready receipt', () => {
  expect(Check(RoutineEnableOutput, { enabled: false, revision: definition.revision })).toBe(true);
  expect(Check(RoutineEnableOutput, ready)).toBe(true);
  expect(Check(RoutineEnableOutput, { enabled: true })).toBe(false);
  expect(Check(RoutineEnableOutput, { ...definition, kind: 'starting', pid: 123 })).toBe(false);
  expect(Check(RoutineEnableOutput, { ...definition, kind: 'ready' })).toBe(false);
});
