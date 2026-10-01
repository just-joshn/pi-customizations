import { expect, test } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

function stoppedNotifications(session: Awaited<ReturnType<typeof workerFixture>>['session']) {
  return session.messages.filter((message) => message.role === 'custom' && message.customType === 'task_notification');
}

test('[G5-01] explicit TaskStop records one stopped notification without triggering a parent turn', async () => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('Agent', { description: 'stopped notification', prompt: 'WAIT_BLOCKED', name: 'notified-worker' });
    const { agentId } = started.details as { agentId: string };
    const before = fixture.session.messages.filter((message) => message.role === 'assistant').length;
    const stopped = await fixture.call('TaskStop', { task_id: 'notified-worker' });
    expect(stopped.details).toMatchObject({ task_id: agentId, task_type: 'local_agent', command: 'stopped notification', message: `Stopped task ${agentId}` });
    expect(stoppedNotifications(fixture.session)).toMatchObject([{ details: { task_id: agentId, status: 'stopped', task_type: 'local_agent' } }]);
    await fixture.call('TaskStop', { task_id: agentId });
    expect(stoppedNotifications(fixture.session)).toHaveLength(1);
    expect(fixture.session.messages.filter((message) => message.role === 'assistant')).toHaveLength(before);
  } finally {
    await fixture.close();
  }
});

test('concurrent stop requests publish only one notification for the same run', async () => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('Agent', { description: 'concurrent stop', prompt: 'WAIT_BLOCKED' });
    const { agentId } = started.details as { agentId: string };
    await Promise.all([fixture.call('TaskStop', { task_id: agentId }), fixture.call('TaskStop', { task_id: agentId })]);
    expect(stoppedNotifications(fixture.session)).toHaveLength(1);
  } finally {
    await fixture.close();
  }
});

test('stopping a resumed run publishes a new notification for the same agent ID', async () => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('Agent', { description: 'repeat run', prompt: 'WAIT_BLOCKED' });
    const { agentId } = started.details as { agentId: string };
    await fixture.call('TaskStop', { task_id: agentId });
    await fixture.command('resume-agent', `${agentId} WAIT_BLOCKED`);
    await fixture.call('TaskStop', { task_id: agentId });
    expect(stoppedNotifications(fixture.session)).toMatchObject([{ details: { task_id: agentId, status: 'stopped' } }, { details: { task_id: agentId, status: 'stopped' } }]);
  } finally {
    await fixture.close();
  }
});

test('a stop finishing across native session reload does not publish a stale notification', async () => {
  const fixture = await workerFixture();
  try {
    const started = await fixture.call('Agent', { description: 'reload stop', prompt: 'WAIT_BLOCKED' });
    const { agentId } = started.details as { agentId: string };
    const [stopped] = await Promise.all([fixture.call('TaskStop', { task_id: agentId }), fixture.session.extensionRunner.emit({ type: 'session_start', reason: 'reload' })]);
    expect(stopped.details).toMatchObject({ task_id: agentId, status: 'interrupted' });
    expect(stoppedNotifications(fixture.session)).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('unknown or already completed tasks do not emit stopped notifications', async () => {
  const fixture = await workerFixture();
  try {
    expect((await fixture.call('TaskStop', { task_id: 'missing' })).isError).toBe(true);
    const completed = await fixture.call('Agent', { description: 'already done', prompt: 'done', run_in_background: false });
    const { agentId } = completed.details as { agentId: string };
    await fixture.call('TaskStop', { task_id: agentId });
    expect(stoppedNotifications(fixture.session)).toEqual([]);
  } finally {
    await fixture.close();
  }
});
