import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AgentSession } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { clearAgentCache } from '../src/subagents/definitions.ts';
import { workerFixture } from './worker-fixture.ts';
import { workerTiming } from './worker-timing.ts';

type Fixture = Awaited<ReturnType<typeof workerFixture>>;
type Launched = { agentId: string };

async function requestCount(fixture: Fixture): Promise<number> {
  const text = await readFile(join(fixture.dir, 'provider-inputs.jsonl'), 'utf8').catch(() => '');
  return text.trim().split('\n').filter(Boolean).length;
}

async function finished(fixture: Fixture, prompt = 'done'): Promise<TaskRecordShape> {
  const started = await fixture.call('Agent', { description: 'finished agent', prompt, run_in_background: false });
  const { agentId } = started.details as Launched;
  return (await fixture.call('TaskOutput', { task_id: agentId })).details as TaskRecordShape;
}

type TaskRecordShape = { id: string; status: string; output: string; sessionFile: string };

async function stoppedAgent(fixture: Fixture): Promise<string> {
  const started = await fixture.call('Agent', { description: 'stopped agent', prompt: 'WAIT_BLOCKED' });
  const { agentId } = started.details as Launched;
  await fixture.call('TaskStop', { task_id: agentId });
  return agentId;
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function until(check: () => Promise<boolean>): Promise<void> {
  await vi.waitFor(async () => expect(await check()).toBe(true), { timeout: workerTiming.settlementDeadlineMs, interval: workerTiming.pollIntervalMs });
}

test('a model SendMessage does not restart an agent the user stopped', async () => {
  const fixture = await workerFixture();
  try {
    const agentId = await stoppedAgent(fixture);
    const before = await requestCount(fixture);
    await expect(fixture.call('SendMessage', { to: agentId, message: 'carry on' })).rejects.toMatchObject({
      name: 'AgentStoppedByUserError',
      code: 'user_stopped',
      message: `Agent ${agentId} was stopped by the user and won't be resumed. Treat its work as cancelled; only launch a new agent if the user explicitly asks.`,
    });
    expect(await requestCount(fixture)).toBe(before);
    expect((await fixture.call('TaskOutput', { task_id: agentId })).details).toMatchObject({ status: 'interrupted' });
  } finally {
    await fixture.close();
  }
});

test('the user resume command restarts a user-stopped agent', async () => {
  const fixture = await workerFixture();
  try {
    const agentId = await stoppedAgent(fixture);
    expect(await fixture.command('resume-agent', `${agentId} pick it back up`)).toEqual([{ message: `Agent ${agentId} resumed in the background`, level: 'info' }]);
    expect((await fixture.call('TaskOutput', { task_id: agentId, block: true })).details).toMatchObject({ status: 'settled', output: 'users=2' });
  } finally {
    await fixture.close();
  }
});

test('resuming an agent whose transcript is gone is a state error, not a fresh session', async () => {
  const fixture = await workerFixture();
  try {
    const record = await finished(fixture);
    await rm(record.sessionFile);
    await expect(fixture.call('SendMessage', { to: record.id, message: 'again' })).rejects.toMatchObject({ name: 'ResumeAgentStateError', code: 'state', message: `No transcript found for agent ID: ${record.id}` });
    await expect(readFile(record.sessionFile)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await fixture.close();
  }
});

test('resuming an agent whose definition was removed refuses with a definition error', async () => {
  const fixture = await workerFixture();
  const agents = join(fixture.dir, '.pi/agents');
  try {
    await mkdir(agents, { recursive: true });
    await writeFile(join(agents, 'ephemeral.md'), '---\nname: ephemeral\ndescription: short lived\n---\nDo the work.');
    clearAgentCache();
    const started = await fixture.call('Agent', { description: 'ephemeral', prompt: 'done', subagent_type: 'ephemeral', run_in_background: false });
    const { agentId } = started.details as Launched;
    await rm(join(agents, 'ephemeral.md'));
    clearAgentCache();
    await expect(fixture.call('SendMessage', { to: agentId, message: 'again' })).rejects.toMatchObject({ code: 'state', message: "Agent type 'ephemeral' is not offered in this session." });
  } finally {
    clearAgentCache();
    await fixture.close();
  }
});

test('a resume needs a free concurrency slot like a launch', async () => {
  const fixture = await workerFixture();
  try {
    const record = await finished(fixture);
    vi.stubEnv('CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS', '1');
    const blocker = (await fixture.call('Agent', { description: 'slot holder', prompt: 'WAIT_BLOCKED' })).details as Launched;
    await expect(fixture.call('SendMessage', { to: record.id, message: 'again' })).rejects.toMatchObject({
      code: 'subagent_concurrency_limit',
      message: 'Concurrent subagent limit reached. You can run 1 subagents at once. Do not retry. If the user wants more concurrent subagents, ask them to increase CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS.',
    });
    await fixture.call('TaskStop', { task_id: blocker.agentId });
  } finally {
    await fixture.close();
  }
});

test('two concurrent resumes of one agent start only one continuation', async () => {
  const fixture = await workerFixture();
  try {
    const record = await finished(fixture);
    const outcomes = await Promise.allSettled([fixture.call('SendMessage', { to: record.id, message: 'first' }), fixture.call('SendMessage', { to: record.id, message: 'second' })]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected']);
    expect(outcomes[1]).toMatchObject({ reason: { name: 'AgentResumeInProgressError', code: 'busy', message: `Agent ${record.id} is already running or being resumed` } });
    expect((await fixture.call('TaskOutput', { task_id: record.id, block: true })).details).toMatchObject({ status: 'settled', output: 'users=2' });
  } finally {
    await fixture.close();
  }
});

test('a message sent during a stop drain is refused, not queued', async () => {
  const fixture = await workerFixture();
  const abort = AgentSession.prototype.abort;
  const drainEntered = gate();
  const drainGate = gate();
  const spy = vi.spyOn(AgentSession.prototype, 'abort').mockImplementation(async function (this: AgentSession) {
    drainEntered.open();
    await drainGate.promise;
    await abort.call(this);
  });
  try {
    const { agentId } = (await fixture.call('Agent', { description: 'draining', prompt: 'WAIT_BLOCKED' })).details as Launched;
    const stopping = fixture.call('TaskStop', { task_id: agentId });
    await drainEntered.promise;
    const still = `Agent ${agentId} is still stopping — its previous run was stopped but has not exited. Re-run TaskStop on it or wait for it to exit before resuming.`;
    await expect(fixture.call('SendMessage', { to: agentId, message: 'late' })).rejects.toMatchObject({ name: 'AgentStillStoppingError', code: 'still_stopping', message: still });
    await expect(fixture.call('TaskMessage', { task_id: agentId, message: 'late' })).rejects.toMatchObject({ code: 'still_stopping' });
    drainGate.open();
    await stopping;
  } finally {
    drainGate.open();
    spy.mockRestore();
    await fixture.close();
  }
});

test('SendMessage to a running agent steers it with the coordinator wrapper without a restart', async () => {
  const fixture = await workerFixture();
  try {
    const { agentId } = (await fixture.call('Agent', { description: 'running', prompt: 'WAIT_BLOCKED' })).details as Launched;
    expect((await fixture.call('SendMessage', { to: agentId, message: 'PEER_NOTE' })).details).toEqual({ success: true, message: `Message queued for ${agentId}` });
    expect((await fixture.call('TaskOutput', { task_id: agentId, block: true })).details).toMatchObject({ status: 'settled', output: 'users=2' });
    const requests = await readFile(join(fixture.dir, 'provider-inputs.jsonl'), 'utf8');
    expect(requests).toContain(JSON.stringify('The coordinator sent a message while you were working:\nPEER_NOTE\n\nAddress this before completing your current task.').slice(1, -1));
  } finally {
    await fixture.close();
  }
});

test('a stop marks the agent stop-pending on its own event bus at once', async () => {
  const fixture = await workerFixture();
  try {
    const { agentId } = (await fixture.call('Agent', { description: 'probe', prompt: 'AWAIT_STOP_PENDING' })).details as Launched;
    const audit = join(fixture.dir, 'audit.txt');
    await until(async () => (await readFile(audit, 'utf8').catch(() => '')).includes('await-stop-pending-start'));
    await fixture.call('TaskStop', { task_id: agentId });
    expect(await readFile(audit, 'utf8')).toContain(`stop-pending:${agentId}`);
  } finally {
    await fixture.close();
  }
});

test('an agent told its stop is pending can neither launch nor resume agents', async () => {
  const fixture = await workerFixture();
  try {
    const record = await finished(fixture);
    fixture.session.sessionManager.appendCustomEntry('pstack-agent-identity', 'self-agent');
    await fixture.session.extensionRunner.emit({ type: 'session_start', reason: 'reload' });
    fixture.eventBus.emit('pstack:subagent-stop-pending', { agentId: 'self-agent' });
    await expect(fixture.call('Agent', { description: 'late spawn', prompt: 'done' })).rejects.toMatchObject({
      code: 'subagent_stop_pending',
      message: 'This agent has been stopped and its stop is still completing; it cannot launch new agents.',
    });
    await expect(fixture.call('SendMessage', { to: record.id, message: 'again' })).rejects.toMatchObject({
      code: 'still_stopping',
      message: 'This agent has been stopped and its stop is still completing; it cannot resume other agents.',
    });
  } finally {
    await fixture.close();
  }
});

test('continuing an interrupted turn that already finished settles it without rerunning', async () => {
  const fixture = await workerFixture();
  try {
    const record = await finished(fixture);
    fixture.session.sessionManager.appendCustomEntry('pstack-task', { ...record, status: 'running' });
    await fixture.session.extensionRunner.emit({ type: 'session_start', reason: 'reload' });
    expect((await fixture.call('TaskOutput', { task_id: record.id })).details).toMatchObject({ status: 'interrupted' });
    const before = await requestCount(fixture);
    expect(await fixture.command('resume-agent', record.id)).toEqual([{ message: `Agent ${record.id} had already completed its interrupted turn`, level: 'info' }]);
    expect(await requestCount(fixture)).toBe(before);
    expect((await fixture.call('TaskOutput', { task_id: record.id })).details).toMatchObject({ status: 'settled', output: 'users=1' });
  } finally {
    await fixture.close();
  }
});
