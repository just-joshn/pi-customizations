import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { lastToolResult, loadPackageModule, messageText, prepareChildAgentDir, startObserved, waitForValue } from './pstack-tools-lib.js';

const PACKAGE = 'extensions/pi-pstack';
// biome-ignore lint/security/noSecrets: deterministic fixture key used only against a loopback receiver
const KEY = 'pt-verification-sender-key-0123456789abcdef';

function result(session, toolName) {
  const message = lastToolResult(session, toolName);
  assert.ok(message, `no ${toolName} tool result recorded`);
  return { text: messageText(message), details: message.details, isError: message.isError };
}

function findRoutineDirectory(agentDir, routineId) {
  const root = join(agentDir, 'pstack-routines');
  for (const owner of readdirSync(root)) {
    const candidate = join(root, owner, routineId);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`routine directory for ${routineId} not found under ${root}`);
}

async function postEvent(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
      'x-automation-key': KEY,
      'x-pstack-delivery-id': '8f8b7e1c-1111-4222-8333-abcdefabcdef',
    },
    body: JSON.stringify(body),
  });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export default async function pstackToolsRoutines(context) {
  const agentDir = prepareChildAgentDir(context, 'routines-agent');
  const { disableRoutine } = await loadPackageModule(context, 'scripts/routine-client.mjs');
  const { session } = await startObserved(context, 'routines', { agentDir, answers: { confirm: () => true } });
  let enabledDirectory;
  try {
    await session.prompt('PT9_PREPARE');
    const prepared = result(session, 'RoutinePrepare');
    const routineId = prepared.details.routineId;
    const routineDirectory = findRoutineDirectory(agentDir, routineId);
    const preparedState = { status: existsSync(join(routineDirectory, 'status.json')), owner: existsSync(join(routineDirectory, 'owner')) };
    mkdirSync(join(routineDirectory, 'secrets'), { recursive: true });
    writeFileSync(join(routineDirectory, 'secrets', 'sender-key'), KEY, { mode: 0o600 });

    await session.prompt('PT10_INSPECT_LAST');
    const inspected = result(session, 'RoutineInspect');

    await session.prompt('PT11_ENABLE_LAST');
    const enabled = result(session, 'RoutineEnable');
    enabledDirectory = routineDirectory;
    const confirmDialogs = session.dialogs.filter((dialog) => dialog.request.method === 'confirm');

    const response = await postEvent(enabled.details.url, { action: 'probe' });
    const ack = await response.json();
    const rootSession = enabled.details.sessionFile ? await waitForValue(() => readFileSync(enabled.details.sessionFile, 'utf8').includes('action') || undefined, { description: 'the routine root transcript', timeoutMs: 30000 }) : undefined;

    await session.prompt('PT12_DISABLE_LAST');
    const disabled = result(session, 'RoutineDisable');
    const refused = await postEvent(enabled.details.url, { action: 'probe' }).then(
      (value) => value.status,
      () => 'connection refused',
    );

    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-9',
      package: PACKAGE,
      expected: 'Creates a disabled webhook routine draft plus hidden key-initializer command',
      observed: `RoutinePrepare returned kind=${prepared.details.kind} routineId=${routineId} revision=${prepared.details.revision} port=${prepared.details.port} initializer=${JSON.stringify(prepared.details.initializer)}; immediately after prepare status.json exists=${preparedState.status} owner exists=${preparedState.owner}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(prepared.details.kind, 'disabled', 'draft is not disabled');
        assert.match(prepared.details.initializer, /routine-secret\.mjs/, 'initializer does not name the hidden key helper');
        assert.ok(prepared.details.initializer.includes(routineDirectory), 'initializer does not target the prepared routine directory');
        assert.equal(preparedState.status, false, 'prepare started a service');
        assert.equal(preparedState.owner, false, 'prepare created an owner directory');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-10',
      package: PACKAGE,
      expected: 'Returns definition and receipt without the sender key',
      observed: `RoutineInspect returned kind=${inspected.details.kind} revision=${inspected.details.revision} directory=${inspected.details.directory}; sender key present in result=${inspected.text.includes(KEY) || JSON.stringify(inspected.details).includes(KEY)}; secrets file mode=${(statSync(join(routineDirectory, 'secrets', 'sender-key')).mode & 0o777).toString(8)}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(inspected.details.kind, 'disabled', 'inspect did not report the disabled draft');
        assert.equal(inspected.details.revision, prepared.details.revision, 'inspect returned a different revision');
        assert.ok(!inspected.text.includes(KEY) && !JSON.stringify(inspected.details).includes(KEY), 'inspect leaked the sender key');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-11',
      package: PACKAGE,
      expected: "Starts the routine's receiver and dedicated Pi root",
      observed: `confirm dialog ${JSON.stringify(confirmDialogs.map((dialog) => dialog.request.title))} answered ${JSON.stringify(confirmDialogs.map((dialog) => dialog.answer))}; enable returned kind=${enabled.details.kind} url=${enabled.details.url} pid=${enabled.details.pid} sessionFile=${enabled.details.sessionFile}; loopback POST returned status=${response.status} body=${JSON.stringify(ack)}; root transcript contains the event=${Boolean(rootSession)}`,
      evidence: session.capturePath,
      check: () => {
        assert.ok(
          confirmDialogs.some((dialog) => dialog.request.title === 'Enable webhook routine?'),
          'enable did not ask for operator confirmation',
        );
        assert.equal(enabled.details.kind, 'ready', 'enable did not start the routine');
        assert.match(enabled.details.url, /^http:\/\/127\.0\.0\.1:\d+\/webhook$/, 'receiver is not loopback-bound');
        assert.equal(response.status, 200, 'receiver did not acknowledge the webhook');
        assert.equal(ack.accepted, true, 'receiver did not accept the webhook');
        assert.ok(rootSession, 'the dedicated root never saw the webhook event');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-12',
      package: PACKAGE,
      expected: 'Stops ingress and drains the owned process',
      observed: `RoutineDisable returned kind=${disabled.details.kind} pid=${enabled.details.pid} alive=${alive(enabled.details.pid)}; a later POST to ${enabled.details.url} produced status=${refused}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(disabled.details.kind, 'disabled', 'disable did not report the routine disabled');
        assert.equal(alive(enabled.details.pid), false, 'routine supervisor is still alive after disable');
        assert.ok(refused === 'connection refused' || refused >= 500, `receiver still accepted ingress after disable: ${refused}`);
      },
    });
  } finally {
    await session.close();
    await cleanupRoutine(enabledDirectory, disableRoutine);
  }

  const decline = await startObserved(context, 'routines-decline', { agentDir, answers: { confirm: () => false } });
  try {
    await decline.session.prompt('PT9_PREPARE');
    const draft = result(decline.session, 'RoutinePrepare');
    await decline.session.prompt(`PT11_DECLINE:${draft.details.routineId}:${draft.details.revision}`);
    const denied = result(decline.session, 'RoutineEnable');
    const deniedDirectory = findRoutineDirectory(agentDir, draft.details.routineId);
    const confirm = decline.session.dialogs.find((dialog) => dialog.request.method === 'confirm');
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-11',
      package: PACKAGE,
      expected: "Starts the routine's receiver and dedicated Pi root",
      observed: `approval path: confirm answered true, kind=ready, loopback POST accepted and the root transcript held the event; declined path: confirm answered ${confirm?.answer}, enable returned ${JSON.stringify(denied.details)} and status.json exists=${existsSync(join(deniedDirectory, 'status.json'))}`,
      evidence: decline.session.capturePath,
      check: () => {
        assert.equal(confirm?.answer, false, 'decline path did not answer the confirmation with false');
        assert.deepEqual(denied.details, { enabled: false, revision: draft.details.revision }, 'decline did not return the disabled revision');
        assert.equal(existsSync(join(deniedDirectory, 'status.json')), false, 'declined routine started a receiver');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-12',
      package: PACKAGE,
      expected: 'Stops ingress and drains the owned process',
      observed: `approved routine: disable returned kind=disabled, pid dead, later POST refused; declined routine: status.json exists=${existsSync(join(deniedDirectory, 'status.json'))}`,
      evidence: decline.session.capturePath,
      check: () => {
        assert.equal(existsSync(join(deniedDirectory, 'status.json')), false, 'a declined routine left a service receipt');
      },
    });
  } finally {
    await decline.session.close();
  }
  context.log('✓ pstack-tools-routines wrote 4 receipts');
}

async function cleanupRoutine(directory, disableRoutine) {
  if (!directory) return;
  const statusPath = join(directory, 'status.json');
  if (!existsSync(statusPath)) return;
  const status = JSON.parse(readFileSync(statusPath, 'utf8'));
  if (status.kind !== 'disabled') await disableRoutine(directory).catch(() => {});
  const after = existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, 'utf8')) : undefined;
  if (after && alive(after.pid)) {
    process.kill(after.pid, 'SIGTERM');
    await waitForValue(async () => (alive(after.pid) ? undefined : true), { description: 'the routine supervisor to stop', timeoutMs: 10000 }).catch(() => process.kill(after.pid, 'SIGKILL'));
  }
  if (after && alive(after.pid)) throw new Error(`routine supervisor ${after.pid} is still alive after cleanup`);
}
