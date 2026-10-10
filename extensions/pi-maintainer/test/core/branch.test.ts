import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { BRANDING } from '../../src/branding.ts';
import { restore } from '../../src/core/branch.ts';

const intent = { schema: 1, kind: 'operation-intent', reply: 'reply', ordinal: 0, operation: 'write', path: '/project/file' };
const observation = { schema: 1, kind: 'operation-observed', reply: 'reply', ordinal: 0, outcome: 'succeeded', error: null };
const session = () => SessionManager.inMemory('/project');

test('unobserved operations remain pending even when a reply is finished', () => {
  const manager = session();
  manager.appendCustomEntry(BRANDING.stateEntry, intent);
  manager.appendCustomEntry(BRANDING.stateEntry, { schema: 1, kind: 'reply-finished', reply: 'reply' });
  const restored = restore(manager.getBranch());
  expect(restored.pendingOperations).toEqual([intent]);
  expect([...restored.finishedReplies]).toEqual(['reply']);
});

test('successful observations resolve their matching intent', () => {
  const manager = session();
  manager.appendCustomEntry(BRANDING.stateEntry, intent);
  manager.appendCustomEntry(BRANDING.stateEntry, observation);
  expect(restore(manager.getBranch()).pendingOperations.length).toBe(0);
});

test('unrecognized record versions require reconciliation', () => {
  const manager = session();
  const id = manager.appendCustomEntry(BRANDING.stateEntry, { schema: 2, kind: 'notice', level: 'info', text: 'future schema' });
  expect(restore(manager.getBranch()).invalidRecords).toEqual([id]);
});

test('orphan observations cannot certify an unrecorded operation', () => {
  const manager = session();
  const id = manager.appendCustomEntry(BRANDING.stateEntry, observation);
  expect(restore(manager.getBranch()).invalidRecords).toEqual([id]);
});

test('duplicate operation identities require reconciliation', () => {
  const manager = session();
  manager.appendCustomEntry(BRANDING.stateEntry, intent);
  manager.appendCustomEntry(BRANDING.stateEntry, observation);
  const id = manager.appendCustomEntry(BRANDING.stateEntry, { ...intent, path: '/project/other' });
  expect(restore(manager.getBranch()).invalidRecords).toEqual([id]);
});

test('the active branch excludes receipts on an abandoned branch', () => {
  const manager = session();
  const root = manager.appendCustomEntry('foreign', {});
  manager.appendCustomEntry(BRANDING.stateEntry, intent);
  manager.branch(root);
  manager.appendCustomEntry('foreign', { branch: 'second' });
  expect(restore(manager.getBranch()).pendingOperations).toEqual([]);
  expect(manager.getEntries()).toHaveLength(3);
});
