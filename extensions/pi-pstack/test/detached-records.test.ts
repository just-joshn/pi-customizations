import { expect, test } from 'vitest';
import { restoreTaskRecords } from '../src/worker-records.ts';

const record = { id: 'one', persona: 'generalPurpose', cwd: '/tmp', readonly: false, sessionFile: '/tmp/one', outputFile: '/tmp/out', status: 'running', output: '' };
const entry = (data: unknown) => ({ type: 'custom', customType: 'pstack-task', data });

test('restoration preserves a detached invocation for reconnection', () => {
  const detached = { directory: '/tmp/rpc-one', invocation: 'invocation-one', entryCursor: null };
  expect(restoreTaskRecords([entry({ ...record, detached })]).get('one')).toEqual({ ...record, detached });
});

test('restoration still interrupts a parent-owned invocation', () => {
  expect(restoreTaskRecords([entry(record)]).get('one')).toEqual({ ...record, status: 'interrupted', output: 'Parent session ended before completion. Resume this task to continue.' });
});

test.each([-1, 0.5, {}, ''])('restoration rejects an invalid detached entry reference', (entryCursor) => {
  expect(restoreTaskRecords([entry({ ...record, detached: { directory: '/tmp/rpc-one', invocation: 'invocation-one', entryCursor } })]).size).toBe(0);
});
