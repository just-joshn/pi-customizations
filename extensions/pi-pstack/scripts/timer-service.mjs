import { randomUUID } from 'node:crypto';
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { writeRecord } from './detached-rpc-protocol.mjs';
import { checkCi, ciObservation, parseCi, wakeText } from './timer-ci.mjs';
import { timerRecord } from './timer-client.mjs';
import { holdTimerLease } from './timer-lease.mjs';
import { occurrenceCompleted, openTimerRoot } from './timer-root.mjs';
import { nextOccurrence, parseTimer } from './timer-schedules.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: timer-service.mjs <owner-directory>');
let subscriptions = [];
let running;
let root;
let active;
let lease;
let closing = false;
const status = (kind, extra = {}) => writeRecord(join(directory, 'status.json'), { kind, pid: process.pid, ...extra });
const persist = () => writeRecord(join(directory, 'subscriptions.json'), subscriptions);
process.on('SIGTERM', () => {
  closing = true;
});
process.on('SIGINT', () => {
  closing = true;
});

async function replace(id, change) {
  subscriptions = subscriptions.map((item) => (item.receipt.subscriptionId === id ? { ...item, ...change } : item));
  await persist();
}

function nextTick(item) {
  if (!item.receipt.delaySeconds) return nextOccurrence(item.receipt, Date.now());
  const interval = item.receipt.delaySeconds * 1000;
  return item.occurrence.dueAt + (Math.floor((Date.now() - item.occurrence.dueAt) / interval) + 1) * interval;
}

async function settle(item) {
  await replace(item.receipt.subscriptionId, { occurrence: { ...item.occurrence, phase: 'settled' }, nextAt: item.enabled ? nextTick(item) : item.nextAt });
  active = undefined;
}

async function drain() {
  for (const type of ['clear_queue', 'abort_retry', 'abort']) {
    const response = await running.send({ type });
    if (!response.success) throw new Error(response.error);
  }
  const deadline = Date.now() + 30000;
  while (active && (await running.activity()).kind !== 'settled') {
    if (Date.now() >= deadline) throw new Error('Timer turn did not stop; cancellation remains persisted.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  active = undefined;
}

async function recover() {
  for (const item of subscriptions.filter((value) => value.occurrence && value.occurrence.phase !== 'settled')) {
    await recoverOccurrence(item);
  }
}

async function recoverOccurrence(item) {
  const activity = await running.activity();
  const same = activity.invocation === item.occurrence.invocation;
  if (!item.enabled) {
    if (same && activity.kind !== 'settled') {
      active = item.receipt.subscriptionId;
      await drain();
    }
    return settle(item);
  }
  if (item.occurrence.phase === 'pending' && !item.occurrence.attempted) return;
  if (same && activity.kind !== 'settled') {
    active = item.receipt.subscriptionId;
    return;
  }
  if (same || (await occurrenceCompleted(running, item.occurrence.invocation))) return settle(item);
  await replace(item.receipt.subscriptionId, { enabled: false, error: `Occurrence ${item.occurrence.invocation} may have executed. Reconcile its transcript and external effects before explicitly subscribing again.` });
}

async function subscribe(input) {
  const timer = parseTimer(input);
  const existing = subscriptions.find((item) => item.receipt.name === timer.name && item.enabled);
  if (existing) return existing.receipt;
  const nextAt = nextOccurrence(timer, Date.now());
  const receipt = { ...timer, subscriptionId: randomUUID(), runId: root.runId, sessionFile: root.sessionFile, rpcDirectory: running.directory };
  subscriptions = [...subscriptions, { receipt, enabled: true, nextAt: timer.runImmediately === false ? nextAt : Date.now() }];
  await persist();
  return receipt;
}

async function subscribeCi(input) {
  const ci = parseCi(input);
  const existing = subscriptions.find((item) => item.receipt.name === ci.name && item.enabled);
  if (existing) return existing.receipt;
  const { pollSeconds, ...rest } = ci;
  const receipt = { ...rest, kind: 'ci', delaySeconds: pollSeconds, subscriptionId: randomUUID(), runId: root.runId, sessionFile: root.sessionFile, rpcDirectory: running.directory };
  subscriptions = [...subscriptions, { receipt, enabled: true, nextAt: Date.now(), ci: {} }];
  await persist();
  return receipt;
}

async function pollCi(item) {
  const nextAt = Date.now() + item.receipt.delaySeconds * 1000;
  try {
    const { ci, wake } = ciObservation(item.ci, await checkCi(item.receipt));
    const occurrence = wake ? { phase: 'pending', invocation: randomUUID(), dueAt: Date.now(), attempted: false } : item.occurrence;
    await replace(item.receipt.subscriptionId, { nextAt, ci, occurrence });
  } catch (error) {
    await replace(item.receipt.subscriptionId, { nextAt, ci: { ...item.ci, error: error instanceof Error ? error.message : String(error) } });
  }
}

function listed(item) {
  const receipt = item.ci ? { ...item.receipt, ci: { state: item.ci.state, head: item.ci.head, error: item.ci.error } } : item.receipt;
  return item.error ? { ...receipt, status: 'needs_reconciliation', error: item.error } : receipt;
}

async function dispatch(command) {
  if (!command || typeof command !== 'object') throw new Error('Invalid timer command.');
  if (command.type === 'subscribe') return subscribe(command.timer);
  if (command.type === 'subscribe_ci') return subscribeCi(command.ci);
  if (command.type === 'list') return subscriptions.filter((item) => item.enabled || item.error).map(listed);
  if (command.type === 'shutdown') {
    await drain();
    closing = true;
    return;
  }
  if (command.type !== 'unsubscribe' || typeof command.subscriptionId !== 'string') throw new Error('Invalid timer command.');
  const item = subscriptions.find((value) => value.receipt.subscriptionId === command.subscriptionId);
  if (!item) throw new Error('Unknown subscription.');
  await replace(command.subscriptionId, { enabled: false, error: undefined });
  if (active === command.subscriptionId && item.receipt.sessionFile !== command.fromSession) {
    await drain();
    await settle({ ...item, enabled: false });
  }
}

async function commands() {
  for (const file of (await readdir(join(directory, 'commands'))).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)).sort()) {
    const request = await timerRecord(join(directory, 'commands', file));
    if (!request || file !== `${request.id}.json`) throw new Error('Invalid timer request identity.');
    const receiptPath = join(directory, 'receipts', file);
    if (!(await timerRecord(receiptPath))) {
      try {
        await writeRecord(receiptPath, { command: request.command, success: true, result: await dispatch(request.command) });
      } catch (error) {
        await writeRecord(receiptPath, { command: request.command, success: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    await unlink(join(directory, 'commands', file));
    if (closing) return;
  }
}

async function deliver(item) {
  const occurrence = item.occurrence?.phase === 'pending' ? item.occurrence : { phase: 'pending', invocation: randomUUID(), dueAt: item.nextAt, attempted: false };
  await replace(item.receipt.subscriptionId, { occurrence });
  await replace(item.receipt.subscriptionId, { occurrence: { ...occurrence, attempted: true } });
  active = item.receipt.subscriptionId;
  const message = `${wakeText(item)}\n\n[pstack-timer occurrence=${occurrence.invocation} due_at=${occurrence.dueAt}]`;
  const response = await running.send({ type: 'prompt', message }, occurrence.invocation);
  if (!response.success) throw new Error(response.error);
  await replace(item.receipt.subscriptionId, { occurrence: { ...occurrence, attempted: true, phase: 'accepted' } });
}

async function tick() {
  const state = await running.info();
  if (state.kind === 'failed' || state.kind === 'exited') throw new Error(`Timer Pi root stopped: ${state.error ?? state.kind}`);
  if (active) {
    if ((await running.activity()).kind !== 'settled') return;
    const item = subscriptions.find((value) => value.receipt.subscriptionId === active);
    await settle(item);
  }
  const due = subscriptions.filter((item) => item.enabled && (item.occurrence?.phase === 'pending' || item.nextAt <= Date.now())).toSorted((a, b) => a.nextAt - b.nextAt)[0];
  if (due) await (due.ci && due.occurrence?.phase !== 'pending' ? pollCi(due) : deliver(due));
}

try {
  const launch = await timerRecord(join(directory, 'launch.json'));
  lease = await holdTimerLease(launch.leasePort);
  await status('starting');
  process.env.PI_PSTACK_TIMER_DIRECTORY = directory;
  const opened = await openTimerRoot(directory, launch);
  running = opened.handle;
  root = opened.root;
  subscriptions = ((await timerRecord(join(directory, 'subscriptions.json'))) ?? []).map((item) => ({ ...item, receipt: { ...item.receipt, rpcDirectory: running.directory } }));
  await recover();
  await status('ready', { rpcDirectory: running.directory });
  while (!closing) {
    await commands();
    if (!closing) await tick();
    if (!closing) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await running.close();
  await status('stopped');
} catch (error) {
  await running?.close().catch(() => {});
  if (lease) await status('failed', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  lease?.close();
}
