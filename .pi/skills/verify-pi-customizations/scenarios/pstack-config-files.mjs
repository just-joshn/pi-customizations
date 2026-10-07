import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { cleanupRoutine, gitRepo, readJson, shutdownTimer, startEnv, taskEntries, toolResult, waitForValue, widgets, writeFakeSsh, writeRaw } from './pstack-env-lib.js';

const PACKAGE = 'extensions/pi-pstack';
// biome-ignore lint/security/noSecrets: deterministic fixture key used only by a loopback routine receiver
const ROUTINE_KEY = 'pt-verification-sender-key-0123456789abcdef';

function executorConfig(repo, knownHosts, agentDir) {
  return [{ id: 'cfg-executor', transport: 'ssh', target: 'fixture-vm', packageRoot: repo, repository: repo, localRepository: repo, agentDir, machineId: 'cfg-machine', isolation: 'vm', knownHosts }];
}

async function settleTask(session, taskId, status) {
  return waitForValue(
    async () => {
      const record = (await taskEntries(session)).filter((item) => item.id === taskId).at(-1);
      return record?.status === status ? record : undefined;
    },
    { description: `task ${taskId} to reach ${status}`, timeoutMs: 60000 },
  );
}

async function executorsScenario(context) {
  const repo = gitRepo(join(context.scratchDir, 'cfg-exec-repo'));
  const knownHosts = join(context.scratchDir, 'cfg-known-hosts');
  writeFileSync(knownHosts, 'fixture-vm ssh-ed25519 AAAA\n');
  const fake = writeFakeSsh(context, { slot: 'cfg-4', logPath: join(context.rawDir, 'cfg-4-ssh.log'), stateDir: join(context.scratchDir, 'cfg-4-state'), executorId: 'cfg-executor', machineId: 'cfg-machine' });
  const { session, agentDir } = await startEnv(context, 'cfg-executors', { cwd: repo, env: { PATH: `${fake.binDir}${delimiter}${process.env.PATH}` } });
  const configPath = join(agentDir, 'pstack', 'executors.json');
  let settled;
  let rejected;
  let calls;
  try {
    mkdirSync(join(agentDir, 'pstack'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(executorConfig(repo, knownHosts, join(context.scratchDir, 'cfg-guest'))));
    await session.prompt('ENV_CLOUD_TASK');
    const task = toolResult(session, 'Task');
    assert.equal(task.isError, false, `cloud Task failed: ${task.text}`);
    settled = await settleTask(session, task.details.id, 'settled');
    calls = readFileSync(fake.logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    writeFileSync(configPath, '{ not json');
    await session.prompt('ENV_CLOUD_TASK');
    rejected = toolResult(session, 'Task');
  } finally {
    await session.close();
  }
  const capture = writeRaw(context, 'cfg-4-executors.json', { configPath, calls, settled, rejected: { isError: rejected.isError, text: rejected.text.slice(0, 220) } });
  context.receipts.assertVerdict({
    surfaceId: 'PS-CFG-4',
    package: PACKAGE,
    expected: 'Selects the isolated VM executor',
    observed: `agentDir/pstack/executors.json selected transport argv ${JSON.stringify(calls.at(-1) ?? [])} and the cloud Task settled with ${JSON.stringify(settled.output)}; replacing the file with malformed JSON failed with ${JSON.stringify(rejected.text.slice(0, 160))}`,
    evidence: capture,
    check: () => {
      assert.ok(calls.length > 0, 'the agentDir executor config was never read');
      assert.ok(
        calls.at(-1).some((arg) => String(arg).includes(knownHosts)),
        'the ssh argv did not use the configured knownHosts',
      );
      assert.equal(settled.output, 'remote fixture reply', 'the selected executor did not run the task');
      assert.ok(rejected.isError, 'malformed executors.json did not fail the Task');
      assert.match(rejected.text, /executors\.json/, 'the failure did not name the config path');
    },
  });
}

async function timerDirectoryScenario(context) {
  const { session, agentDir } = await startEnv(context, 'cfg-timer', { persistSession: true, sessionId: 'cfg-5-timer' });
  let timer;
  let state;
  let files;
  let rootFiles;
  try {
    await session.prompt('ENV_TIMER');
    timer = toolResult(session, 'SubscribeTimer').details;
    state = await session.state();
    files = readdirSync(join(agentDir, 'pstack-timers')).filter((name) => name !== '');
    const owner = createHash('sha256')
      .update(`${realpathSync(agentDir)}\0${state.sessionId}`)
      .digest('hex');
    const directory = join(agentDir, 'pstack-timers', owner);
    rootFiles = readdirSync(directory).sort();
    assert.equal(timer.rpcDirectory.startsWith(directory), true, 'timer root is not in the hashed owner directory');
    await session.prompt('ENV_UNSUB_LAST');
  } finally {
    await session.close();
  }
  try {
    const capture = writeRaw(context, 'cfg-5-timer.json', { files, rootFiles, timer });
    context.receipts.assertVerdict({
      surfaceId: 'PS-CFG-5',
      package: PACKAGE,
      expected: 'Timer supervisor state, session, system prompt, status.json',
      observed: `agentDir/pstack-timers held owner hash ${files[0] ?? 'none'}; that directory held ${JSON.stringify(rootFiles)}; the timer transcript was ${timer.sessionFile}`,
      evidence: capture,
      check: () => {
        assert.equal(files.length, 1, 'expected exactly one owner directory without PI_PSTACK_TIMER_DIRECTORY');
        for (const name of ['status.json', 'system.txt', 'session', 'launch.json']) assert.ok(rootFiles.includes(name), `timer owner directory lacks ${name}`);
        assert.ok(timer.sessionFile.includes('pstack-timers'), 'timer transcript is outside the owner directory');
      },
    });
  } finally {
    if (files?.[0]) await shutdownTimer(context, join(agentDir, 'pstack-timers', files[0]));
  }
}

function findRoutineDirectory(agentDir, routineId) {
  for (const owner of readdirSync(join(agentDir, 'pstack-routines'))) {
    const candidate = join(agentDir, 'pstack-routines', owner, routineId);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`routine directory for ${routineId} not found`);
}

async function routineDirectoryScenario(context) {
  const { session, agentDir } = await startEnv(context, 'cfg-routine', { answers: { confirm: () => true } });
  let routineDirectory;
  let prepared;
  let definition;
  let modes;
  let afterEnable;
  try {
    await session.prompt('CFG_ROUTINE');
    prepared = toolResult(session, 'RoutinePrepare').details;
    routineDirectory = findRoutineDirectory(agentDir, prepared.routineId);
    definition = readJson(join(routineDirectory, 'definition.json'));
    modes = Object.fromEntries(['secrets', 'events', 'delivered', 'fallback'].map((name) => [name, statSync(join(routineDirectory, name)).mode & 0o777]));
    mkdirSync(join(routineDirectory, 'secrets'), { recursive: true });
    writeFileSync(join(routineDirectory, 'secrets', 'sender-key'), ROUTINE_KEY, { mode: 0o600 });
    await session.prompt('ENV_ROUTINE_ENABLE');
    const enabled = toolResult(session, 'RoutineEnable');
    assert.equal(enabled.isError, false, `RoutineEnable failed: ${enabled.text}`);
    afterEnable = readdirSync(routineDirectory).sort();
    await session.prompt('CFG_ROUTINE_DISABLE');
  } finally {
    await session.close();
    await cleanupRoutine(context, routineDirectory);
  }
  const capture = writeRaw(context, 'cfg-6-routine.json', { prepared, definition, modes, afterEnable });
  context.receipts.assertVerdict({
    surfaceId: 'PS-CFG-6',
    package: PACKAGE,
    expected: 'Routine definition, revision receipt, session dir',
    observed: `agentDir/pstack-routines/<hash>/${prepared.routineId} held definition.json revision ${definition.revision} (receipt revision ${prepared.revision}), subdirectory modes ${JSON.stringify(modes)}; after enable it held ${JSON.stringify(afterEnable)}`,
    evidence: capture,
    check: () => {
      assert.equal(definition.revision, prepared.revision, 'the stored definition revision does not match the prepare receipt');
      for (const [name, mode] of Object.entries(modes)) assert.equal(mode, 0o700, `${name} is not mode 0700`);
      assert.ok(afterEnable.includes('session'), 'enabling the routine created no session directory');
      assert.ok(afterEnable.includes('approval.json'), 'enabling the routine created no revision approval receipt');
    },
  });
}

async function taskIndexScenario(context) {
  const repo = gitRepo(join(context.scratchDir, 'cfg-index-repo'));
  const knownHosts = join(context.scratchDir, 'cfg-index-known-hosts');
  writeFileSync(knownHosts, 'fixture-vm ssh-ed25519 AAAA\n');
  const fake = writeFakeSsh(context, { slot: 'cfg-7', logPath: join(context.rawDir, 'cfg-7-ssh.log'), stateDir: join(context.scratchDir, 'cfg-7-state'), executorId: 'cfg-executor', machineId: 'cfg-machine' });
  const { session, agentDir } = await startEnv(context, 'cfg-index', { cwd: repo, env: { PATH: `${fake.binDir}${delimiter}${process.env.PATH}` } });
  let taskId;
  let receipt;
  let listed;
  try {
    mkdirSync(join(agentDir, 'pstack'), { recursive: true });
    writeFileSync(join(agentDir, 'pstack', 'executors.json'), JSON.stringify(executorConfig(repo, knownHosts, join(context.scratchDir, 'cfg-index-guest'))));
    await session.prompt('ENV_CLOUD_TASK');
    const task = toolResult(session, 'Task');
    assert.equal(task.isError, false, `cloud Task failed: ${task.text}`);
    taskId = task.details.id;
    await settleTask(session, taskId, 'settled');
    const scope = createHash('sha256').update(realpathSync(repo)).digest('hex');
    const indexPath = join(agentDir, 'pstack-task-index', scope, `${taskId}.json`);
    receipt = await waitForValue(() => (existsSync(indexPath) ? readJson(indexPath) : undefined), { description: 'the task index receipt' });
    await session.prompt('ENV_LIST_REPO');
    listed = toolResult(session, 'TaskList').details.tasks;
  } finally {
    await session.close();
  }
  const capture = writeRaw(context, 'cfg-7-task-index.json', { taskId, receipt, listed });
  context.receipts.assertVerdict({
    surfaceId: 'PS-CFG-7',
    package: PACKAGE,
    expected: 'Launch receipts for TaskList repository discovery',
    observed: `the remote launch wrote ${JSON.stringify(receipt && { branch: receipt.branch, repository: receipt.repository, taskId: receipt.record?.id, executor: receipt.record?.detached?.remote?.executor?.id })}; TaskList(repository: true) returned ${JSON.stringify(listed?.map((task) => task.id))}`,
    evidence: capture,
    check: () => {
      assert.equal(receipt?.record?.id, taskId, 'the index receipt names a different task');
      assert.equal(receipt?.record?.detached?.remote?.executor?.id, 'cfg-executor', 'the index receipt lost the executor');
      assert.ok(
        listed?.some((task) => task.id === taskId),
        'TaskList repository discovery did not return the launch receipt',
      );
    },
  });
}

async function sidekickDefinitionsScenario(context) {
  const repo = gitRepo(join(context.scratchDir, 'cfg-sidekick-repo'), 'https://github.com/acme/widgets.git');
  const definitions = readdirSync(join(context.repoRoot, PACKAGE, 'src/subagents/sidekicks/definitions')).sort();
  const flags = {
    SESSION_SEARCH_SIDEKICK_AGENT: '1',
    GITHUB_CONTEXT_SIDEKICK_AGENT: '1',
    GITHUB_CONTEXT_SIDEKICK_AGENT_FULL: '1',
    CLOUD_SESSION_SEARCH_SIDEKICK_AGENT: '1',
    COPILOT_SUBCONSCIOUS: '1',
  };
  const on = await startEnv(context, 'cfg-sidekick-on', { cwd: repo, env: flags });
  let names = [];
  try {
    await on.session.prompt('ENV12_TRIGGER');
    names = await waitForValue(
      async () => {
        await on.session.prompt('ENV_PING');
        const found = (await on.session.messages())
          .filter((message) => message.role === 'custom' && message.customType === 'sidekick_inbox')
          .map((message) => /Message from the ([\w-]+) sidekick/.exec(typeof message.content === 'string' ? message.content : '')?.[1])
          .filter(Boolean);
        const unique = [...new Set(found)];
        return unique.length >= 5 ? unique : undefined;
      },
      { description: 'five sidekick deliveries', timeoutMs: 180000 },
    );
  } finally {
    await on.session.close();
  }
  const capture = writeRaw(context, 'cfg-11-sidekicks.json', { definitions, names });
  context.receipts.assertVerdict({
    surfaceId: 'PS-CFG-11',
    package: PACKAGE,
    expected: 'Five sidekick agents can launch on triggers',
    observed: `the definitions directory holds ${JSON.stringify(definitions)}; a trigger with all five flags delivered sidekick_inbox messages from ${JSON.stringify(names)}`,
    evidence: capture,
    check: () => {
      assert.equal(definitions.length, 5, 'the shipped definitions directory does not hold five files');
      for (const name of ['cloud-session-search', 'github-context-memory', 'github-context', 'session-search', 'subconscious-agent']) assert.ok(names.includes(name), `${name} never launched`);
    },
  });
}

function statusLineScript(context, commandLog) {
  const source = `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify({ cwd: input.cwd, projectDir: process.env.CLAUDE_PROJECT_DIR, tasks: (input.tasks ?? []).map((task) => task.id) }) + '\\n');
  const task = (input.tasks ?? [])[0];
  if (task) process.stdout.write(JSON.stringify({ id: task.id, content: 'PT-DECORATION' }) + '\\n');
});
`;
  const path = join(context.scratchDir, 'status-line.mjs');
  writeFileSync(path, source, { mode: 0o755 });
  return path;
}

async function statusLineScenario(context) {
  const commandLog = join(context.rawDir, 'cfg-12-status-line.log');
  const script = statusLineScript(context, commandLog);
  const { session } = await startEnv(context, 'cfg-status-line', {
    settings: { subagentStatusLine: { type: 'command', command: `node ${script}` } },
  });
  let taskId;
  let received;
  try {
    await session.prompt('CFG12_TASK');
    taskId = toolResult(session, 'Task').details.id;
    received = await waitForValue(
      () => {
        const lines = widgets(session, 'pstack-agents').flatMap((request) => request.widgetLines ?? []);
        const decorated = lines.find((line) => line.includes('PT-DECORATION'));
        return decorated ? { decorated, lines } : undefined;
      },
      { description: 'the decorated task panel', timeoutMs: 30000 },
    );
  } finally {
    await session.close();
  }
  const calls = readFileSync(commandLog, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const capture = writeRaw(context, 'cfg-12-status-line.json', { taskId, received, calls: calls.slice(0, 3) });
  context.receipts.assertVerdict({
    surfaceId: 'PS-CFG-12',
    package: PACKAGE,
    expected: 'Runs a shell command for task-panel decorations',
    observed: `agentDir/settings.json subagentStatusLine ran the command (${calls.length} invocations, first stdin tasks=${JSON.stringify(calls[0]?.tasks)} projectDir=${JSON.stringify(calls[0]?.projectDir)}) and the pstack-agents widget line became ${JSON.stringify(received?.decorated)}`,
    evidence: capture,
    check: () => {
      assert.ok(calls.length > 0, 'the configured subagentStatusLine command never ran');
      assert.ok(calls[0]?.tasks.includes(taskId), 'the command did not receive the running task');
      assert.equal(calls[0]?.projectDir, calls[0]?.cwd, 'CLAUDE_PROJECT_DIR did not match the session cwd');
      assert.match(received?.decorated ?? '', /PT-DECORATION/, 'the widget did not render the decoration');
    },
  });
}

export default async function pstackConfigFiles(context) {
  await executorsScenario(context);
  await timerDirectoryScenario(context);
  await routineDirectoryScenario(context);
  await taskIndexScenario(context);
  await sidekickDefinitionsScenario(context);
  await statusLineScenario(context);
  context.log('✓ pstack-config-files wrote 6 receipts (PS-CFG-4,5,6,7,11,12)');
}
