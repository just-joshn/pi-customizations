import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { cleanupRoutine, entriesOf, gitRepo, providerCalls, readIfExists, readJson, shutdownTimer, startEnv, taskEntries, toolResult, waitForValue, writeExecutable, writeFakeSsh, writeRaw } from './pstack-env-lib.js';

const PACKAGE = 'extensions/pi-pstack';
// biome-ignore lint/security/noSecrets: deterministic fixture key used only by a loopback routine receiver
const ROUTINE_KEY = 'pt-verification-sender-key-0123456789abcdef';

async function startedEvent(session, agentId) {
  const started = (await entriesOf(session))
    .filter((entry) => entry.type === 'custom' && entry.customType === 'reference-assistant-event')
    .map((entry) => entry.data)
    .filter((envelope) => envelope?.type === 'subagent.started');
  return started.find((envelope) => envelope.agentId === agentId) ?? started.at(-1);
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

async function catalogScenario(context) {
  const on = await startEnv(context, 'catalog-on', { env: { PI_PSTACK_WORKER_OWNER: 'pt-owner' } });
  try {
    await on.session.prompt('ENV_PING');
  } finally {
    await on.session.close();
  }
  const off = await startEnv(context, 'catalog-off');
  try {
    await off.session.prompt('ENV_PING');
  } finally {
    await off.session.close();
  }
  const onCall = providerCalls(on.providerLog).find((call) => call.text === 'ENV_PING');
  const offCall = providerCalls(off.providerLog).find((call) => call.text === 'ENV_PING');
  const capture = writeRaw(context, 'env-4-catalog.json', { onCall, offCall });
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-4',
    package: PACKAGE,
    expected: 'Marks cloud/detached ownership; switches skill catalog mode',
    observed: `with PI_PSTACK_WORKER_OWNER the pstack_host system section listed host skills ${JSON.stringify(onCall?.hostSkills)}; without it ${JSON.stringify(offCall?.hostSkills)}`,
    evidence: capture,
    check: () => {
      assert.ok(offCall?.hasPstackHost, 'the control session had no pstack_host section');
      assert.match(onCall?.hostSkills ?? '', /loop/);
      assert.match(offCall?.hostSkills ?? '', /origin/, 'the local skill catalog omitted the origin host skill');
      assert.ok(!onCall?.hostSkills.includes('origin'), 'the cloud skill catalog still offered the origin host skill');
    },
  });
}

async function featureFlagScenario(context) {
  const off = await startEnv(context, 'flags-off');
  const offTools = readJson(off.observerFile).activeTools;
  await off.session.close();
  const on = await startEnv(context, 'flags-on', {
    env: { COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'copilot_cli_execution_subagent', COPILOT_EXPERIMENTS: 'copilot_cli_search_subagent_model', COPILOT_DYNAMIC_WORKFLOWS: '1' },
  });
  const onTools = readJson(on.observerFile).activeTools;
  await on.session.close();
  const capture = writeRaw(context, 'env-8-flags.json', { offTools, onTools });
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-8',
    package: PACKAGE,
    expected: 'Enables feature-flagged tools (specialized subagents, dynamic workflows)',
    observed: `off: active tools lack execution_subagent=${!offTools.includes('execution_subagent')} search_subagent=${!offTools.includes('search_subagent')} run_dynamic_workflow=${!offTools.includes('run_dynamic_workflow')}; on: active ${JSON.stringify(onTools.filter((name) => ['execution_subagent', 'search_subagent', 'run_dynamic_workflow'].includes(name)))}`,
    evidence: capture,
    check: () => {
      for (const tool of ['execution_subagent', 'search_subagent', 'run_dynamic_workflow']) assert.ok(!offTools.includes(tool), `${tool} is active without a feature flag`);
      assert.ok(onTools.includes('execution_subagent'), 'COPILOT_CLI_ENABLED_FEATURE_FLAGS did not enable execution_subagent');
      assert.ok(onTools.includes('search_subagent'), 'COPILOT_EXPERIMENTS did not enable search_subagent');
      assert.ok(onTools.includes('run_dynamic_workflow'), 'COPILOT_DYNAMIC_WORKFLOWS did not enable run_dynamic_workflow');
    },
  });
}

async function timerDirectoryScenario(context) {
  const directory = join(context.scratchDir, 'timer-env-owner');
  const { session } = await startEnv(context, 'timer-env', { env: { PI_PSTACK_TIMER_DIRECTORY: directory }, persistSession: true, sessionId: 'env-2-timer' });
  let timer;
  let state;
  let listed;
  let unsubscribed;
  let files;
  try {
    await session.prompt('ENV_TIMER');
    timer = toolResult(session, 'SubscribeTimer').details;
    state = await session.state();
    await session.prompt('ENV_TIMER_LIST');
    listed = toolResult(session, 'ListSubscriptions').details;
    await session.prompt('ENV_UNSUB_LAST');
    unsubscribed = toolResult(session, 'Unsubscribe').details;
    const receipts = readdirSync(join(directory, 'receipts'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => readJson(join(directory, 'receipts', name)));
    files = { root: readdirSync(directory).sort(), unsubscribe: receipts.find((receipt) => receipt.command?.type === 'unsubscribe') };
  } finally {
    await session.close();
  }
  try {
    const capture = writeRaw(context, 'env-2-timer.json', { directory, timer, stateFile: state.sessionFile, listed, unsubscribed, files });
    context.receipts.assertVerdict({
      surfaceId: 'PS-ENV-2',
      package: PACKAGE,
      expected: 'Overrides the timer owner directory; Unsubscribe passes the session file',
      observed: `timer rpcDirectory=${timer.rpcDirectory} sessionFile=${timer.sessionFile}; owner directory files=${JSON.stringify(files.root)}; the unsubscribe command recorded fromSession=${files.unsubscribe?.command?.fromSession} (session file ${state.sessionFile})`,
      evidence: capture,
      check: () => {
        assert.ok(timer.rpcDirectory.startsWith(directory), 'the timer root was not written under PI_PSTACK_TIMER_DIRECTORY');
        assert.ok(timer.sessionFile.startsWith(directory), 'the timer transcript was not written under PI_PSTACK_TIMER_DIRECTORY');
        assert.ok(files.root.includes('status.json'), 'the override directory has no supervisor status');
        assert.equal(files.unsubscribe?.command?.fromSession, state.sessionFile, 'Unsubscribe did not pass the session file');
      },
    });
  } finally {
    await shutdownTimer(context, directory);
  }
}

async function originCommandScenario(context) {
  const off = await startEnv(context, 'origin-off');
  let rejected;
  try {
    await off.session.prompt('ENV_ORIGIN');
    rejected = toolResult(off.session, 'SubscribeOriginCI');
  } finally {
    await off.session.close();
  }
  const directory = join(context.scratchDir, 'timer-origin-owner');
  const command = writeExecutable(join(context.scratchDir, 'origin-ci'), '#!/bin/sh\necho \'{"head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","state":"success","summary":"PT origin CI success"}\'\n');
  const { session } = await startEnv(context, 'origin-on', { env: { PI_PSTACK_TIMER_DIRECTORY: directory, PI_PSTACK_ORIGIN_CI_COMMAND: command } });
  let receipt;
  let observed;
  try {
    await session.prompt('ENV_ORIGIN');
    receipt = toolResult(session, 'SubscribeOriginCI').details;
    observed = await waitForValue(
      () => {
        const entries = readIfExists(join(directory, 'subscriptions.json'));
        const entry = entries?.find((item) => item.receipt.subscriptionId === receipt.subscriptionId);
        return entry?.ci?.state === 'success' ? entry : undefined;
      },
      { description: 'the origin CI command result', timeoutMs: 60000 },
    );
    await session.prompt('ENV_UNSUB_LAST');
  } finally {
    await session.close();
  }
  try {
    const capture = writeRaw(context, 'env-3-origin.json', { rejected: { isError: rejected.isError, text: rejected.text }, receipt, observed });
    context.receipts.assertVerdict({
      surfaceId: 'PS-ENV-3',
      package: PACKAGE,
      expected: 'Enables SubscribeOriginCI; command prints head/state/summary JSON',
      observed: `without the variable SubscribeOriginCI isError=${rejected.isError} text=${JSON.stringify(rejected.text.slice(0, 180))}; with it pointing at a script the subscription state became ${observed.ci.state} head=${observed.ci.head.slice(0, 12)} summary=${JSON.stringify(observed.ci.report?.summary)}`,
      evidence: capture,
      check: () => {
        assert.ok(rejected.isError, 'SubscribeOriginCI without PI_PSTACK_ORIGIN_CI_COMMAND did not fail');
        assert.match(rejected.text, /PI_PSTACK_ORIGIN_CI_COMMAND/, 'the failure did not name the variable');
        assert.equal(observed.ci.state, 'success', 'the configured origin command result never reached the subscription');
        assert.match(observed.ci.report?.summary ?? '', /PT origin CI success/);
      },
    });
  } finally {
    await shutdownTimer(context, directory);
  }
}

function executorConfig(repo, knownHosts, agentDir, id = 'env-executor', machineId = 'env-machine') {
  return [{ id, transport: 'ssh', target: 'fixture-vm', packageRoot: repo, repository: repo, localRepository: repo, agentDir, machineId, isolation: 'vm', knownHosts }];
}

async function executorsScenario(context) {
  const repo = gitRepo(join(context.scratchDir, 'env-exec-repo'));
  const knownHosts = join(context.scratchDir, 'env-known-hosts');
  writeFileSync(knownHosts, 'fixture-vm ssh-ed25519 AAAA\n');
  const fake = writeFakeSsh(context, { slot: 'env-5', logPath: join(context.rawDir, 'env-5-ssh.log'), stateDir: join(context.scratchDir, 'env-5-state'), executorId: 'env-executor', machineId: 'env-machine' });
  const configPath = join(context.scratchDir, 'env-executors.json');
  writeFileSync(configPath, JSON.stringify(executorConfig(repo, knownHosts, join(context.scratchDir, 'env-guest'), 'env-executor', 'env-machine')));
  const env = { PATH: `${fake.binDir}${delimiter}${process.env.PATH}`, PI_PSTACK_EXECUTORS: configPath };
  const { session } = await startEnv(context, 'executors', { cwd: repo, env });
  let tool;
  let settled;
  try {
    await session.prompt('ENV_CLOUD_TASK');
    tool = toolResult(session, 'Task');
    settled = await settleTask(session, tool.details.id, 'settled');
  } finally {
    await session.close();
  }
  const badPath = join(context.scratchDir, 'env-executors-bad.json');
  writeFileSync(badPath, '{ not json');
  const bad = await startEnv(context, 'executors-bad', { cwd: repo, env: { PATH: env.PATH, PI_PSTACK_EXECUTORS: badPath } });
  let rejected;
  try {
    await bad.session.prompt('ENV_CLOUD_TASK');
    rejected = toolResult(bad.session, 'Task');
  } finally {
    await bad.session.close();
  }
  const calls = readFileSync(fake.logPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const capture = writeRaw(context, 'env-5-executors.json', { configPath, calls, tool: { text: tool.text.slice(0, 200), details: tool.details }, settled, rejected: { isError: rejected.isError, text: rejected.text.slice(0, 220) } });
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-5',
    package: PACKAGE,
    expected: 'Overrides executor config path',
    observed: `PI_PSTACK_EXECUTORS=${configPath} made the cloud Task reach transport argv ${JSON.stringify(calls.at(-1) ?? [])} and settle with output ${JSON.stringify(settled.output)}; pointing it at a malformed file failed with ${JSON.stringify(rejected.text.slice(0, 160))}`,
    evidence: capture,
    check: () => {
      assert.ok(calls.length > 0, 'the configured executor was never selected');
      assert.ok(
        calls.at(-1).some((arg) => String(arg).includes(knownHosts)),
        'the ssh argv did not use the env-file knownHosts',
      );
      assert.ok(rejected.isError, 'a malformed PI_PSTACK_EXECUTORS file did not fail the Task');
      assert.match(rejected.text, /env-executors-bad\.json/, 'the failure did not name the overridden path');
      assert.equal(settled.output, 'remote fixture reply', 'the selected executor did not run the task');
    },
  });
}

async function detachedScenario(context) {
  const log = join(context.rawDir, 'env-16-rem.log');
  const recorder = writeExecutable(join(context.scratchDir, 'pi-recorder'), `#!/bin/sh\n{ echo "args=$*"; echo "detached=\${COPILOT_DETACHED_SESSION-unset}"; } >> ${JSON.stringify(log)}\n`);
  const runSession = async (name, extraEnv) => {
    const { session } = await startEnv(context, name, { env: { COPILOT_SUBCONSCIOUS: '1', PSTACK_PI_COMMAND: recorder, ...extraEnv } });
    try {
      await session.prompt('ENV_BOARD');
    } finally {
      await session.close();
    }
  };
  let attempts = 0;
  let launched;
  while (attempts < 3 && launched === undefined) {
    attempts += 1;
    await runSession(`rem-on-${attempts}`, {});
    launched = await waitForValue(() => (existsSync(log) && readFileSync(log, 'utf8').trim() ? readFileSync(log, 'utf8').trim() : undefined), {
      description: 'the detached rem launch record',
      timeoutMs: 15000,
    }).catch(() => undefined);
  }
  const afterLaunch = existsSync(log) ? readFileSync(log, 'utf8').trim() : '';
  await runSession('rem-detached', { COPILOT_DETACHED_SESSION: '1' });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const after = existsSync(log) ? readFileSync(log, 'utf8').trim() : '';
  const capture = writeRaw(context, 'env-16-rem.json', { attempts, launched, after, boardCount: readdirSync(join(context.scratchDir, 'rem-on-1-agent', 'context-boards')).length });
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-16',
    package: PACKAGE,
    expected: 'Prevents a detached rem session from re-launching',
    observed: `a populated board with COPILOT_SUBCONSCIOUS=1 launched the consolidation session after shutdown attempt ${attempts}: ${JSON.stringify(launched)}; the next session with COPILOT_DETACHED_SESSION=1 left the recorder log at ${JSON.stringify(after)}`,
    evidence: capture,
    check: () => {
      assert.match(launched ?? '', /-p/, 'the first shutdown never launched the consolidation session');
      assert.match(launched ?? '', /detached=1/, 'the launched session was not marked detached');
      assert.equal(after, afterLaunch, 'a detached session re-launched the rem session');
    },
  });
}

async function specializedExecution(context) {
  const model = await startEnv(context, 'exec-model', {
    env: { COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'copilot_cli_execution_subagent,copilot_cli_execution_subagent_model', EXECUTION_SUBAGENT_MODEL: 'pstack-verify-env/scripted-alt' },
  });
  let overridden;
  try {
    await model.session.prompt('ENV_EXEC_MODEL');
    overridden = await startedEvent(model.session, toolResult(model.session, 'execution_subagent').details.agent_id);
  } finally {
    await model.session.close();
  }
  const ignored = await startEnv(context, 'exec-ignored', {
    env: { COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'copilot_cli_execution_subagent', EXECUTION_SUBAGENT_MODEL: 'pstack-verify-env/scripted-alt' },
  });
  let inherited;
  try {
    await ignored.session.prompt('ENV_EXEC_MODEL');
    inherited = await startedEvent(ignored.session, toolResult(ignored.session, 'execution_subagent').details.agent_id);
  } finally {
    await ignored.session.close();
  }
  const turns = await startEnv(context, 'exec-turns', { env: { COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'copilot_cli_execution_subagent', EXECUTION_SUBAGENT_MAX_TURNS: '1' } });
  let limited;
  try {
    await turns.session.prompt('ENV_EXEC_TURNS');
    limited = toolResult(turns.session, 'execution_subagent').text;
  } finally {
    await turns.session.close();
  }
  const bad = await startEnv(context, 'exec-bad', {
    env: { COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'copilot_cli_execution_subagent,copilot_cli_execution_subagent_model', EXECUTION_SUBAGENT_MODEL: 'missing/none' },
  });
  let rejected;
  try {
    await bad.session.prompt('ENV_EXEC_MODEL');
    rejected = toolResult(bad.session, 'execution_subagent');
  } finally {
    await bad.session.close();
  }
  return { overridden, inherited, limited, rejected: { isError: rejected.isError, text: rejected.text.slice(0, 200) } };
}

async function specializedScenario(context) {
  const execution = await specializedExecution(context);
  const capture = writeRaw(context, 'env-20-execution.json', execution);
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-20',
    package: PACKAGE,
    expected: 'Model and turn cap for execution_subagent',
    observed: `with the model flag on EXECUTION_SUBAGENT_MODEL=scripted-alt gave subagent.started model=${execution.overridden?.data?.model} source=${execution.overridden?.data?.modelSelectionSource}; with the model flag off the same variable was ignored (model=${execution.inherited?.data?.model} source=${execution.inherited?.data?.modelSelectionSource}); EXECUTION_SUBAGENT_MAX_TURNS=1 produced ${JSON.stringify(execution.limited.slice(0, 120))}; an unknown model reference ran on the inherited model and returned ${JSON.stringify(execution.rejected.text.slice(0, 120))}`,
    evidence: capture,
    check: () => {
      assert.match(execution.overridden?.data?.model ?? '', /scripted-alt/, 'EXECUTION_SUBAGENT_MODEL did not reach the child');
      assert.ok(!(execution.inherited?.data?.model ?? '').includes('scripted-alt'), 'the model variable applied while its flag was off');
      assert.match(execution.limited, /stopped at its 1-turn limit/);
      assert.equal(execution.rejected.isError, false, 'an unknown execution subagent model broke the run instead of falling back');
      assert.match(execution.rejected.text, /scripted fixture reply/, 'the fallback did not use the parent model');
    },
  });
}

async function specializedSearch(context) {
  const model = await startEnv(context, 'search-model', {
    env: { COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'copilot_cli_search_subagent_model', SEARCH_SUBAGENT_MODEL: 'pstack-verify-env/scripted-alt' },
  });
  let overridden;
  try {
    await model.session.prompt('ENV_SEARCH_MODEL');
    overridden = await startedEvent(model.session, toolResult(model.session, 'search_subagent').details.agent_id);
  } finally {
    await model.session.close();
  }
  const turns = await startEnv(context, 'search-turns', { env: { COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'copilot_cli_search_subagent_model', SEARCH_SUBAGENT_MAX_TURNS: '1' } });
  let limited;
  try {
    await turns.session.prompt('ENV_SEARCH_TURNS');
    limited = toolResult(turns.session, 'search_subagent').text;
  } finally {
    await turns.session.close();
  }
  return { overridden, limited };
}

async function specializedScenarioTwo(context) {
  const search = await specializedSearch(context);
  const capture = writeRaw(context, 'env-21-search.json', search);
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-21',
    package: PACKAGE,
    expected: 'Model and turn cap for search_subagent',
    observed: `SEARCH_SUBAGENT_MODEL=scripted-alt gave subagent.started model=${search.overridden?.data?.model} source=${search.overridden?.data?.modelSelectionSource}; SEARCH_SUBAGENT_MAX_TURNS=1 produced ${JSON.stringify(search.limited.slice(0, 120))}`,
    evidence: capture,
    check: () => {
      assert.match(search.overridden?.data?.model ?? '', /scripted-alt/, 'SEARCH_SUBAGENT_MODEL did not reach the child');
      assert.match(search.limited, /stopped at its 1-turn limit/);
    },
  });
}

function findRoutineDirectory(agentDir, routineId) {
  for (const owner of readdirSync(join(agentDir, 'pstack-routines'))) {
    const candidate = join(agentDir, 'pstack-routines', owner, routineId);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`routine directory for ${routineId} not found`);
}

async function timerRootArgs(context) {
  const directory = join(context.scratchDir, 'timer-args-owner');
  const { session } = await startEnv(context, 'root-args', { env: { PI_PSTACK_TIMER_DIRECTORY: directory } });
  try {
    await session.prompt('ENV_TIMER');
    const timer = toolResult(session, 'SubscribeTimer').details;
    const launch = await waitForValue(() => readIfExists(join(timer.rpcDirectory, 'launch.json')), { description: 'the timer launch record' });
    await session.prompt('ENV_UNSUB_LAST');
    return launch.args;
  } finally {
    await session.close();
    await shutdownTimer(context, directory);
  }
}

async function routineRootArgs(context) {
  const { session, agentDir } = await startEnv(context, 'root-args-routine', { answers: { confirm: () => true } });
  let routineDirectory;
  try {
    await session.prompt('CFG_ROUTINE');
    const prepared = toolResult(session, 'RoutinePrepare').details;
    routineDirectory = findRoutineDirectory(agentDir, prepared.routineId);
    mkdirSync(join(routineDirectory, 'secrets'), { recursive: true });
    writeFileSync(join(routineDirectory, 'secrets', 'sender-key'), ROUTINE_KEY, { mode: 0o600 });
    await session.prompt('ENV_ROUTINE_ENABLE');
    const enabled = toolResult(session, 'RoutineEnable');
    assert.equal(enabled.isError, false, `RoutineEnable failed: ${enabled.text}`);
    const launch = await waitForValue(() => readIfExists(join(routineDirectory, 'launch.json')), { description: 'the routine launch record' });
    return launch.args;
  } finally {
    try {
      await session.prompt('CFG_ROUTINE_DISABLE');
    } catch {}
    await session.close();
    await cleanupRoutine(context, routineDirectory);
  }
}

async function rootArgsScenario(context) {
  const timerArgs = await timerRootArgs(context);
  const routineArgs = await routineRootArgs(context);
  const capture = writeRaw(context, 'env-23-root-args.json', { timerArgs, routineArgs });
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-23',
    package: PACKAGE,
    expected: 'Passes `--approve`/`--no-approve`, provider, model, thinking, `-e` extensions',
    observed: `timer launch args=${JSON.stringify(timerArgs)}; routine launch args=${JSON.stringify(routineArgs)}`,
    evidence: capture,
    check: () => {
      for (const [label, args] of [
        ['timer', timerArgs],
        ['routine', routineArgs],
      ]) {
        assert.ok(
          args.some((arg) => arg === '--approve' || arg === '--no-approve'),
          `${label} args lacked the approval flag`,
        );
        assert.ok(args.includes('--provider') && args.includes('pstack-verify-env'), `${label} args lacked the provider`);
        assert.ok(args.includes('--model') && args.includes('scripted-env'), `${label} args lacked the model`);
        assert.ok(args.includes('--thinking'), `${label} args lacked the thinking level`);
        assert.ok(args.includes('-e'), `${label} args lacked an extension path`);
      }
    },
  });
}

async function credentialsScenario(context) {
  const { session, providerLog } = await startEnv(context, 'credentials', { bare: true });
  let result;
  try {
    await session.prompt('ENV_TASK_SYNC');
    result = toolResult(session, 'Task');
  } finally {
    await session.close();
  }
  const calls = providerCalls(providerLog);
  const parent = calls.find((call) => call.text === 'ENV_TASK_SYNC');
  const child = calls.find((call) => call.text.startsWith('reply with the fixture text'));
  const capture = writeRaw(context, 'env-24-credentials.json', { calls, result: { details: result.details, text: result.text.slice(0, 160) } });
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-24',
    package: PACKAGE,
    expected: 'Model credentials are inherited by child Pi roots',
    observed: `the parent provider call recorded apiKey=${JSON.stringify(parent?.apiKey)}; the local readonly child provider call recorded model=${child?.model} apiKey=${JSON.stringify(child?.apiKey)} and the Task settled with status=${JSON.stringify(result.details.status)} without the child agent directory holding a provider extension`,
    evidence: capture,
    check: () => {
      assert.equal(result.details.status, 'settled', 'the child task did not complete');
      assert.equal(child?.model, 'pstack-verify-env/scripted-env', 'the child did not use the parent provider');
      assert.equal(child?.apiKey, parent?.apiKey, 'the child did not inherit the parent provider credentials');
    },
  });
}

async function sidekickScenario(context) {
  const repo = gitRepo(join(context.scratchDir, 'sidekick-repo'), 'https://github.com/acme/widgets.git');
  const on = await startEnv(context, 'sidekick-on', {
    cwd: repo,
    env: {
      SESSION_SEARCH_SIDEKICK_AGENT: '1',
      GITHUB_CONTEXT_SIDEKICK_AGENT: '1',
      GITHUB_CONTEXT_SIDEKICK_AGENT_FULL: '1',
      CLOUD_SESSION_SEARCH_SIDEKICK_AGENT: '1',
    },
  });
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
        return unique.length >= 4 ? unique : undefined;
      },
      { description: 'four sidekick deliveries', timeoutMs: 180000 },
    );
  } finally {
    await on.session.close();
  }
  const off = await startEnv(context, 'sidekick-off', { cwd: repo });
  let offNames = [];
  try {
    await off.session.prompt('ENV12_TRIGGER');
    await off.session.prompt('ENV_PING');
    offNames = (await off.session.messages()).filter((message) => message.role === 'custom' && message.customType === 'sidekick_inbox').length;
  } finally {
    await off.session.close();
  }
  const capture = writeRaw(context, 'env-12-sidekicks.json', { names, offNames });
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-12',
    package: PACKAGE,
    expected: 'Enables individual sidekick definitions',
    observed: `with the four flags set, sidekick_inbox messages arrived from ${JSON.stringify(names)}; without them the trigger produced ${offNames} sidekick messages`,
    evidence: capture,
    check: () => {
      for (const name of ['session-search', 'github-context-memory', 'github-context', 'cloud-session-search']) assert.ok(names.includes(name), `${name} never launched`);
      assert.equal(offNames, 0, 'a sidekick launched without its flag');
    },
  });
}

export default async function pstackEnvVariables(context) {
  await catalogScenario(context);
  await featureFlagScenario(context);
  await timerDirectoryScenario(context);
  await originCommandScenario(context);
  await executorsScenario(context);
  await detachedScenario(context);
  await specializedScenario(context);
  await specializedScenarioTwo(context);
  await rootArgsScenario(context);
  await credentialsScenario(context);
  await sidekickScenario(context);
  context.log('✓ pstack-env-variables wrote 11 receipts (PS-ENV-2,3,4,5,8,12,16,20,21,23,24)');
}
