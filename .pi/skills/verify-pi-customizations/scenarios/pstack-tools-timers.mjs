import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { lastToolResult, loadPackageModule, messageText, prepareChildAgentDir, readJson, startObserved, waitForValue } from './pstack-tools-lib.js';

const PACKAGE = 'extensions/pi-pstack';

function result(session, toolName) {
  const message = lastToolResult(session, toolName);
  assert.ok(message, `no ${toolName} tool result recorded`);
  return { text: messageText(message), details: message.details, isError: message.isError };
}

function writeFakeGh(directory) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'gh');
  writeFileSync(
    path,
    `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args[0] === 'pr' && args[1] === 'view') console.log(JSON.stringify({ headRefOid: 'a'.repeat(40), state: 'OPEN', url: 'https://example.invalid/pr/7' }));\nelse if (args[0] === 'pr' && args[1] === 'checks') console.log(JSON.stringify([{ name: 'build', bucket: 'pass', state: 'SUCCESS', link: 'https://example.invalid/check' }]));\nelse process.exit(1);\n`,
  );
  chmodSync(path, 0o755);
}

export default async function pstackToolsTimers(context) {
  const agentDir = prepareChildAgentDir(context, 'timers-agent');
  const timerDir = join(context.scratchDir, 'timer-owner');
  const binDir = join(context.scratchDir, 'fake-bin');
  writeFakeGh(binDir);
  const { timerAlive, timerCommand, timerRecord } = await loadPackageModule(context, 'scripts/timer-client.mjs');
  const { session } = await startObserved(context, 'timers', {
    agentDir,
    env: { PI_PSTACK_TIMER_DIRECTORY: timerDir, PATH: `${binDir}${delimiter}${process.env.PATH}` },
  });
  let rootPid;
  let rootDirectory;
  try {
    await session.prompt('PT5_ORIGIN');
    const origin = result(session, 'SubscribeOriginCI');

    await session.prompt('PT6_SUBSCRIBE');
    const subscribed = result(session, 'SubscribeTimer');
    const timer = subscribed.details;
    rootDirectory = timer.rpcDirectory;
    const subscriptionsPath = join(timerDir, 'subscriptions.json');
    const settled = await waitForValue(
      async () => {
        const entries = readJson(subscriptionsPath);
        const entry = entries.find((item) => item.receipt.subscriptionId === timer.subscriptionId);
        return entry?.occurrence?.phase === 'settled' ? entry : undefined;
      },
      { description: 'the timer occurrence to settle', timeoutMs: 60000 },
    );
    const rootStatus = readJson(join(rootDirectory, 'status.json'));
    rootPid = rootStatus.childPid;
    const rootSession = readFileSync(timer.sessionFile, 'utf8');

    await session.prompt('PT7_LIST');
    const listed = result(session, 'ListSubscriptions');

    const serviceStatus = readJson(join(timerDir, 'status.json'));
    const previousPid = serviceStatus.pid;
    process.kill(previousPid, 'SIGKILL');
    await waitForValue(async () => ((await timerRecord(join(timerDir, 'status.json'))) && !timerAlive(serviceStatus) ? true : undefined), {
      description: 'the killed timer service to be observed dead',
    });
    await session.prompt('PT3_RESTART');
    const restarted = result(session, 'RestartSubscriptions');
    const restartedStatus = readJson(join(timerDir, 'status.json'));
    const reattachedRoot = readJson(join(timerDir, 'root.json'));

    await session.prompt('PT4_GITHUB');
    const github = result(session, 'SubscribeGithubCI');
    await waitForValue(
      async () => {
        const entries = readJson(subscriptionsPath);
        const entry = entries.find((item) => item.receipt.subscriptionId === github.details.subscriptionId);
        return entry?.ci?.state === 'success' ? entry : undefined;
      },
      { description: 'the CI subscription to observe success', timeoutMs: 60000 },
    );
    const rootSessionAfterCi = await waitForValue(
      async () => {
        const text = readFileSync(timer.sessionFile, 'utf8');
        return text.includes('CI for acme/widgets#7 reached success') ? text : undefined;
      },
      { description: 'the CI wake in the root transcript', timeoutMs: 60000 },
    );

    await session.prompt('PT8_UNSUB_CI_LAST');
    const unsubscribedCi = result(session, 'Unsubscribe');
    await session.prompt('PT8_UNSUB_LAST');
    const unsubscribedTimer = result(session, 'Unsubscribe');
    await session.prompt('PT7_LIST');
    const emptied = result(session, 'ListSubscriptions');

    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-5',
      package: PACKAGE,
      expected: 'Fails unless PI_PSTACK_ORIGIN_CI_COMMAND is set',
      observed: `SubscribeOriginCI without the env returned isError=${origin.isError} text=${JSON.stringify(origin.text.slice(0, 220))}`,
      evidence: session.capturePath,
      check: () => {
        assert.ok(origin.isError, 'origin subscription without a command did not fail');
        assert.match(origin.text, /PI_PSTACK_ORIGIN_CI_COMMAND/, 'failure did not name the missing variable');
        assert.match(origin.text, /unsupported live/, 'failure did not explain the unsupported path');
      },
    });
    writeFileSync(join(context.rawDir, 'subscriptions-after-subscribe.json'), `${JSON.stringify({ timer, settled, rootStatus }, null, 2)}\n`);
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-6',
      package: PACKAGE,
      expected: 'Creates a durable timer in a dedicated Pi root',
      observed: `SubscribeTimer receipt name=${timer.name} execution=${JSON.stringify(timer.execution)} subscriptionId=${timer.subscriptionId} sessionFile=${timer.sessionFile}; persisted occurrence=${settled.occurrence.phase} at ${settled.occurrence.dueAt}; dedicated root status=${rootStatus.kind} childPid=${rootPid}; root transcript contains the scheduled prompt=${rootSession.includes('PT timer prompt')}`,
      evidence: join(context.rawDir, 'subscriptions-after-subscribe.json'),
      check: () => {
        assert.equal(timer.name, 'pt-timer', 'subscription name drifted');
        assert.match(timer.execution, /Dedicated persistent Pi root/, 'receipt did not name the dedicated root');
        assert.ok(timer.sessionFile.startsWith(join(timerDir, 'session')), 'root transcript is not in the timer directory');
        assert.equal(settled.occurrence.phase, 'settled', 'the immediate occurrence never settled');
        assert.equal(rootStatus.kind, 'ready', 'the dedicated root is not ready');
        assert.match(rootSession, /PT timer prompt/, 'the dedicated root transcript has no scheduled prompt');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-7',
      package: PACKAGE,
      expected: 'Lists durable subscriptions owned by this initiating Pi session',
      observed: `before unsubscribe ListSubscriptions text=${JSON.stringify(listed.text)}; after cancelling both it returned ${JSON.stringify(emptied.details)}`,
      evidence: session.capturePath,
      check: () => {
        assert.ok(
          listed.details.some((item) => item.subscriptionId === timer.subscriptionId),
          'ListSubscriptions did not list the durable timer',
        );
        assert.deepEqual(emptied.details, [], 'ListSubscriptions still held cancelled subscriptions');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-3',
      package: PACKAGE,
      expected: 'Restarts supervisor, reattaches Pi root, returns subscription list',
      observed: `service pid ${previousPid} -> ${restartedStatus.pid} (alive=${timerAlive(restartedStatus)}); root childPid ${rootPid} -> ${reattachedRoot.childPid}; RestartSubscriptions returned ${JSON.stringify(restarted.details.map((item) => item.subscriptionId))}`,
      evidence: session.capturePath,
      check: () => {
        assert.notEqual(restartedStatus.pid, previousPid, 'supervisor pid did not change after restart');
        assert.ok(timerAlive(restartedStatus), 'restarted supervisor is not alive');
        assert.equal(reattachedRoot.childPid, rootPid, 'restart did not reattach the living Pi root');
        assert.ok(
          restarted.details.some((item) => item.subscriptionId === timer.subscriptionId),
          'RestartSubscriptions did not return the surviving subscription',
        );
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-4',
      package: PACKAGE,
      expected: 'Durable CI watcher; wakes the owning root on terminal state',
      observed: `SubscribeGithubCI(acme/widgets#7, pollSeconds=1) receipt kind=${github.details.kind} name=${github.details.name}; persisted ci.state=success and the dedicated root transcript contains the wake=${rootSessionAfterCi.includes('CI for acme/widgets#7 reached success')}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(github.details.kind, 'ci', 'CI subscription receipt is not a ci subscription');
        assert.equal(github.details.pr, 7, 'CI subscription tracked a different pull request');
        assert.match(rootSessionAfterCi, /CI for acme\/widgets#7 reached success/, 'the owning root never received the CI wake');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-8',
      package: PACKAGE,
      expected: 'Cancels and drains a subscription',
      observed: `Unsubscribe(timer ${timer.subscriptionId}) text=${JSON.stringify(unsubscribedTimer.text)}; Unsubscribe(ci ${github.details.subscriptionId}) text=${JSON.stringify(unsubscribedCi.text)}; ListSubscriptions afterwards ${JSON.stringify(emptied.details)}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(unsubscribedTimer.details.stopped, true, 'timer unsubscribe did not report stopped');
        assert.equal(unsubscribedCi.details.stopped, true, 'CI unsubscribe did not report stopped');
        assert.deepEqual(emptied.details, [], 'unsubscribed entries are still listed');
      },
    });
  } finally {
    await session.close();
    await shutdownTimer(context, { timerDir, rootDirectory, rootPid, timerCommand, timerAlive, timerRecord });
  }
  context.log('✓ pstack-tools-timers wrote 6 receipts');
}

async function shutdownTimer(context, { timerDir, rootDirectory, rootPid, timerCommand, timerAlive, timerRecord }) {
  const status = await timerRecord(join(timerDir, 'status.json'));
  if (status && timerAlive(status)) await timerCommand(timerDir, { type: 'shutdown' }).catch(() => {});
  await waitForValue(async () => (timerAlive(await timerRecord(join(timerDir, 'status.json'))) ? undefined : true), { description: 'the timer supervisor to stop' }).catch(() => {});
  const alive = (pid) => {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const recordedRoot = rootDirectory ? await timerRecord(join(timerDir, 'root.json')).catch(() => undefined) : undefined;
  const root = alive(recordedRoot?.childPid) ? recordedRoot.childPid : alive(rootPid) ? rootPid : undefined;
  if (root) {
    process.kill(root, 'SIGTERM');
    await waitForValue(async () => (alive(root) ? undefined : true), { description: 'the timer root to stop', timeoutMs: 10000 }).catch(() => process.kill(root, 'SIGKILL'));
  }
  const supervisor = await timerRecord(join(timerDir, 'status.json'));
  if (supervisor && timerAlive(supervisor)) throw new Error(`timer supervisor ${supervisor.pid} is still alive after shutdown`);
  if (root && alive(root)) throw new Error(`timer root ${root} is still alive after shutdown`);
  context.log(`cleanup: timer supervisor ${supervisor?.kind ?? 'absent'}, root pid ${root ?? 'absent'}`);
}
