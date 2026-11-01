#!/usr/bin/env bun
/**
 * Chat-exit smoke for durable routines against extensions/pi-pstack.
 *
 * Path A (required): real `bin/pstack-routines-supervisor` + registry injection,
 * no interactive Pi. Expects the supervisor process to stay alive past a short
 * once-timer delay and fire via a PATH-shadow `pi`.
 *
 * Path B (companion): same package `createSupervisor` in-process with a ref'd
 * keep-alive handle, to separate reconcile/fire logic from event-loop lifetime.
 *
 * Usage: bun run-smoke.mjs
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '../../../../../extensions/pi-pstack');
const SUPERVISOR_BIN = join(PKG, 'bin/pstack-routines-supervisor');
const OUT = join(HERE, 'out');
const DELAY_SECONDS = 2;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const lines = [];
const log = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  lines.push(text);
  console.log(text);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
};

function makeFixture(tag) {
  const root = mkdtempSync(join(tmpdir(), `chat-exit-${tag}-`));
  const agentDir = join(root, 'agent');
  const workspace = join(root, 'workspace');
  const fakeBin = join(root, 'fake-bin');
  const marker = join(workspace, 'timer-marker.txt');
  const spawnLog = join(root, 'fake-pi.jsonl');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(
    join(fakeBin, 'pi'),
    `#!/usr/bin/env bash
set -euo pipefail
echo "{\"argv\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' -- "$@")}" >> ${JSON.stringify(spawnLog)}
prompt=""; prev=""
for arg in "$@"; do
  if [[ "$prev" == "-p" ]]; then prompt="$arg"; fi
  prev="$arg"
done
if [[ "$prompt" == *WRITE_TIMER_MARKER* ]]; then printf 'fired\\n' > ${JSON.stringify(marker)}; fi
if [[ "$prompt" == *WRITE_WEBHOOK_MARKER* ]]; then printf 'webhook\\n' > ${JSON.stringify(join(workspace, 'webhook-marker.txt'))}; fi
exit 0
`,
    { mode: 0o755 },
  );
  return { root, agentDir, workspace, fakeBin, marker, spawnLog };
}

async function pathA() {
  const fx = makeFixture('bin');
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: fx.agentDir,
    PSTACK_ROUTINES_PORT: String(47_200 + Math.floor(Math.random() * 400)),
    PATH: `${fx.fakeBin}:${process.env.PATH ?? ''}`,
  };
  process.env.PI_CODING_AGENT_DIR = fx.agentDir;

  const store = await import(join(PKG, 'src/subscriptions/durable-store.ts'));
  const paths = await import(join(PKG, 'src/paths.ts'));
  const now = Date.now();
  const timerId = `sub-${randomBytes(4).toString('hex')}`;
  store.ensureDurableDirs(fx.workspace);
  store.createDesired(
    fx.workspace,
    {
      id: timerId,
      name: 'durable-smoke',
      createdAt: now,
      expiresAt: now + 7 * 24 * 3_600_000,
      config: {
        kind: 'timer',
        prompt: 'WRITE_TIMER_MARKER',
        delaySeconds: DELAY_SECONDS,
        once: true,
        strategy: 'new_session',
      },
      detachedDelivery: 'spawn',
    },
    fx.workspace,
  );

  const child = spawn(SUPERVISOR_BIN, ['--workspace', fx.workspace], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => {
    stdout += c;
  });
  child.stderr.on('data', (c) => {
    stderr += c;
  });

  const samples = [];
  // Sample through delay + 1s so stayedAlivePastDelay is observable, not a harness false negative.
  const sampleUntilMs = (DELAY_SECONDS + 1) * 1000;
  const sampleStepMs = 250;
  for (let ms = sampleStepMs; ms <= sampleUntilMs; ms += sampleStepMs) {
    await sleep(sampleStepMs);
    samples.push({
      ms,
      pid: child.pid,
      alive: alive(child.pid),
      exitCode: child.exitCode,
      lock: store.readLock(fx.workspace),
      lockLive: store.isSupervisorLive(fx.workspace),
    });
  }

  const delivery = store.readDelivery(fx.workspace, timerId);
  const registry = store.readRegistry(fx.workspace);
  const markerExists = existsSync(fx.marker);
  const spawnCount = existsSync(fx.spawnLog) ? readFileSync(fx.spawnLog, 'utf8').trim().split('\n').filter(Boolean).length : 0;

  const stayedAlivePastDelay = samples.some((s) => s.ms >= sampleUntilMs && s.alive) && alive(child.pid);
  const aliveAfter500ms = samples.find((s) => s.ms === 500)?.alive === true;

  const result = {
    path: 'A-real-bin',
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    samples,
    aliveAfter500ms,
    stayedAlivePastDelay,
    markerExists,
    delivery,
    subscriptionsLeft: registry.subscriptions.length,
    spawnCount,
    registryPath: paths.durableRegistryPath(fx.workspace),
    root: fx.root,
  };

  const pass =
    aliveAfter500ms === true &&
    stayedAlivePastDelay === true &&
    markerExists === true &&
    delivery?.lastClaimKey === `${timerId}:once` &&
    registry.subscriptions.length === 0 &&
    spawnCount >= 1;

  result.verdict = pass ? 'VERIFIED' : 'NOT VERIFIED';
  result.timerId = timerId;
  result.failureReason = pass
    ? null
    : !aliveAfter500ms
      ? 'supervisor process exited within 500ms of start'
      : !stayedAlivePastDelay
        ? 'supervisor process was not alive through delay+1s sampling'
        : !markerExists
          ? 'timer marker missing'
          : 'post-fire assertions failed';

  try {
    child.kill('SIGKILL');
  } catch {
    // already exited
  }
  rmSync(fx.root, { recursive: true, force: true });
  return result;
}

async function pathB() {
  const fx = makeFixture('lib');
  process.env.PI_CODING_AGENT_DIR = fx.agentDir;
  process.env.PATH = `${fx.fakeBin}:${process.env.PATH ?? ''}`;
  const port = 47_600 + Math.floor(Math.random() * 200);

  const store = await import(join(PKG, 'src/subscriptions/durable-store.ts'));
  const { createSupervisor } = await import(join(PKG, 'src/subscriptions/supervisor.ts'));
  const { ensureCredentials } = await import(join(PKG, 'src/subscriptions/webhook.ts'));
  const paths = await import(join(PKG, 'src/paths.ts'));

  const now = Date.now();
  const timerId = `sub-${randomBytes(4).toString('hex')}`;
  const hookId = `sub-${randomBytes(4).toString('hex')}`;
  const routines = join(fx.agentDir, 'routines');
  store.ensureDurableDirs(fx.workspace);
  store.createDesired(
    fx.workspace,
    {
      id: timerId,
      name: 'durable-smoke',
      createdAt: now,
      expiresAt: now + 7 * 24 * 3_600_000,
      config: {
        kind: 'timer',
        prompt: 'WRITE_TIMER_MARKER',
        delaySeconds: DELAY_SECONDS,
        once: true,
        strategy: 'new_session',
      },
      detachedDelivery: 'spawn',
    },
    fx.workspace,
  );

  const fires = [];
  const supervisor = createSupervisor({
    workspaceCwd: fx.workspace,
    routinesDir: routines,
    routinesPort: port,
    reconcileIntervalMs: 60_000,
    runFresh: async (prompt, name, meta) => {
      fires.push({ prompt, name, subscriptionId: meta.subscriptionId });
      if (prompt.includes('WRITE_TIMER_MARKER')) writeFileSync(fx.marker, 'fired\n');
      if (prompt.includes('WRITE_WEBHOOK_MARKER')) writeFileSync(join(fx.workspace, 'webhook-marker.txt'), 'webhook\n');
    },
  });

  // Hold the event loop the way the bin fails to. Library APIs unref every handle.
  const keepAlive = setInterval(() => {}, 60_000);

  const started = await supervisor.start();
  await sleep((DELAY_SECONDS + 1) * 1000);

  const delivery = store.readDelivery(fx.workspace, timerId);
  const afterTimer = {
    started,
    markerExists: existsSync(fx.marker),
    delivery,
    subscriptionsLeft: store.readRegistry(fx.workspace).subscriptions.length,
    fires: fires.length,
  };

  store.createDesired(
    fx.workspace,
    {
      id: hookId,
      name: 'durable-hook',
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 3_600_000,
      config: { kind: 'webhook', prompt: 'WRITE_WEBHOOK_MARKER', slug: 'durable-hook' },
      detachedDelivery: 'spawn',
    },
    fx.workspace,
  );
  await supervisor.reconcile();
  const credPath = ensureCredentials(routines, 'durable-hook');
  const key = JSON.parse(readFileSync(credPath, 'utf8')).key;
  const body = '{"ping":true}';
  const digest = createHash('sha256').update(body).digest('hex');
  const firesBefore = fires.length;
  const post = () =>
    fetch(`http://127.0.0.1:${port}/routines/durable-hook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-automation-key': key },
      body,
    });
  const first = await post();
  const second = await post();
  await sleep(100);

  const afterHook = {
    firstStatus: first.status,
    secondStatus: second.status,
    spawnDelta: fires.length - firesBefore,
    webhookMarker: existsSync(join(fx.workspace, 'webhook-marker.txt')),
    hookClaim: store.readDelivery(fx.workspace, hookId)?.lastClaimKey,
    expectedClaim: `${hookId}:sha256:${digest}`,
  };

  clearInterval(keepAlive);
  supervisor.stop();
  rmSync(fx.root, { recursive: true, force: true });

  const pass =
    afterTimer.markerExists &&
    afterTimer.delivery?.lastClaimKey === `${timerId}:once` &&
    afterTimer.subscriptionsLeft === 0 &&
    afterTimer.fires === 1 &&
    afterHook.firstStatus === 200 &&
    afterHook.secondStatus === 200 &&
    afterHook.spawnDelta === 1 &&
    afterHook.webhookMarker &&
    afterHook.hookClaim === afterHook.expectedClaim;

  return {
    path: 'B-library-with-keepalive',
    verdict: pass ? 'VERIFIED' : 'NOT VERIFIED',
    note: 'createSupervisor in-process with a ref setInterval keep-alive. Proves reconcile/fire/claim/once-remove and webhook idempotency when the process does not exit.',
    afterTimer,
    afterHook,
    timerId,
    hookId,
    routinesDirUsed: routines,
    pathsNote: paths.routinesDir(),
  };
}

const a = await pathA();
log({ section: 'path-A', ...a });
const b = await pathB();
log({ section: 'path-B', ...b });

const overall =
  a.verdict === 'VERIFIED'
    ? 'VERIFIED'
    : b.verdict === 'VERIFIED'
      ? 'NOT VERIFIED'
      : 'NOT VERIFIED';

const summary = {
  overall,
  overallNote:
    a.verdict === 'VERIFIED'
      ? 'Real bin kept timer wakes alive after no interactive chat.'
      : 'Real bin does not stay alive after start, so durable-timer-survives-chat-exit is NOT VERIFIED. Path B shows reconcile/fire logic works when something holds the event loop.',
  pathA: a.verdict,
  pathB: b.verdict,
  binFailureReason: a.failureReason,
};

log({ section: 'summary', ...summary });
writeFileSync(join(OUT, 'smoke.log'), `${lines.join('\n')}\n`);
writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(OUT, 'path-a.json'), `${JSON.stringify(a, null, 2)}\n`);
writeFileSync(join(OUT, 'path-b.json'), `${JSON.stringify(b, null, 2)}\n`);

process.exit(a.verdict === 'VERIFIED' ? 0 : 2);
