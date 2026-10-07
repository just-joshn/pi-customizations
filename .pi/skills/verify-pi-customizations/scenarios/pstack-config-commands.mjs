import assert from 'node:assert/strict';

import { entriesOf, notifications, startEnv, taskEntries, toolResult, waitForValue, writeRaw } from './pstack-env-lib.js';

const PACKAGE = 'extensions/pi-pstack';

async function workflowsScenario(context) {
  const { session } = await startEnv(context, 'workflows', { env: { COPILOT_DYNAMIC_WORKFLOWS: '1' } });
  try {
    await session.prompt('/workflows');
    const empty = notifications(session).at(-1);

    await session.prompt('ENV_WORKFLOW_RUN');
    const run = toolResult(session, 'run_dynamic_workflow');
    assert.equal(run.isError, false, `run_dynamic_workflow failed: ${run.text}`);
    assert.equal(run.details.run.name, 'pt-probe', 'the probe workflow did not start');
    const runId = run.details.run.id;

    await session.prompt('/workflows');
    const listed = notifications(session).at(-1);
    await session.prompt('/factories');
    const factories = notifications(session).at(-1);
    const capture = writeRaw(context, 'commands-workflows.json', { empty, runId, listed, factories, status: run.details.run.status });
    context.receipts.assertVerdict({
      surfaceId: 'PS-CMD-5',
      package: PACKAGE,
      expected: 'Lists dynamic workflow runs',
      observed: `no runs: /workflows notified ${JSON.stringify(empty)}; after run_dynamic_workflow started ${runId}, /workflows notified ${JSON.stringify(listed)}`,
      evidence: capture,
      check: () => {
        assert.equal(empty, 'No workflow runs.', 'empty /workflows did not report an empty list');
        assert.match(listed, new RegExp(runId), '/workflows did not list the run id');
        assert.match(listed, /completed/, '/workflows did not report the run status');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-CMD-6',
      package: PACKAGE,
      expected: 'Same list as /workflows',
      observed: `/workflows notified ${JSON.stringify(listed)}; /factories notified ${JSON.stringify(factories)}; identical=${listed === factories}`,
      evidence: capture,
      check: () => {
        assert.match(factories, new RegExp(runId), '/factories did not list the run id');
        assert.equal(factories, listed, '/factories output diverged from /workflows');
      },
    });
  } finally {
    await session.close();
  }
}

async function tasksScenario(context) {
  const { session } = await startEnv(context, 'tasks');
  let agentId;
  let shellId;
  try {
    await session.prompt('/tasks');
    const empty = notifications(session).at(-1);

    await session.prompt('ENV_SHELL');
    const shell = toolResult(session, 'BackgroundShell');
    assert.equal(shell.isError, false, `BackgroundShell failed: ${shell.text}`);
    shellId = shell.details.id;
    await session.prompt('/tasks');
    const withShell = notifications(session).at(-1);

    await session.prompt('ENV_BG_AGENT');
    const agent = toolResult(session, 'task');
    assert.equal(agent.isError, false, `task failed: ${agent.text}`);
    agentId = agent.details.agent_id;
    await session.prompt('/tasks');
    const withAgent = notifications(session).at(-1);

    await session.prompt(`/tasks cancel ${agentId}`);
    const cancelled = await waitForValue(() => notifications(session).find((line) => line.includes(`Agent ${agentId} is `)), { description: 'the cancel notification' });
    await session.prompt('/tasks');
    const afterCancel = notifications(session).at(-1);

    await session.prompt('/tasks background');
    const promoteEmpty = notifications(session).at(-1);

    const capture = writeRaw(context, 'commands-tasks.json', { empty, withShell, withAgent, cancelled, afterCancel, promoteEmpty, agentId, shellId });
    writeTasksReceipt(context, capture, { empty, withShell, withAgent, cancelled, afterCancel, promoteEmpty, agentId, shellId });
  } finally {
    if (shellId) await session.prompt('ENV_SHELL_STOP').catch(() => {});
    if (agentId) await session.prompt(`/tasks cancel ${agentId}`).catch(() => {});
    await session.close();
  }
}

function writeTasksReceipt(context, capture, { empty, withShell, withAgent, cancelled, afterCancel, promoteEmpty, agentId, shellId }) {
  context.receipts.assertVerdict({
    surfaceId: 'PS-CMD-7',
    package: PACKAGE,
    expected: 'Lists agents and shells, promotes or cancels one',
    observed: `empty: ${JSON.stringify(empty)}; with a background shell: ${JSON.stringify(withShell)}; with a background agent ${agentId}: ${JSON.stringify(withAgent)}; /tasks cancel ${agentId} notified ${JSON.stringify(cancelled)} and a later /tasks notified ${JSON.stringify(afterCancel)}; /tasks background with no sync task notified ${JSON.stringify(promoteEmpty)}`,
    evidence: capture,
    check: () => {
      assert.equal(empty, 'No agents.', 'empty /tasks did not report no agents');
      assert.match(withShell, new RegExp(`id: ${shellId} \\| kind: shell \\| status: running \\| command: sleep 60`), '/tasks did not list the background shell');
      assert.match(withAgent, new RegExp(`agent_id: ${agentId} \\|`), '/tasks did not list the background agent');
      assert.match(cancelled, new RegExp(`Agent ${agentId} is`), '/tasks cancel did not answer for the agent');
      assert.match(afterCancel, new RegExp(`agent_id: ${agentId} \\|`), '/tasks lost the cancelled agent');
      assert.match(afterCancel, /status: cancelled/, '/tasks did not report the cancelled agent status');
      assert.equal(promoteEmpty, 'No running sync task to move to background.', '/tasks background did not report the empty promote path');
    },
  });
}

async function userTexts(session) {
  return (await session.messages())
    .filter((message) => message.role === 'user')
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : (message.content ?? [])
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n'),
    );
}

async function rubberDuckRejection(context, agentDir) {
  const next = await startEnv(context, 'prompts-next', { agentDir });
  try {
    await next.session.prompt('/rubber-duck focus');
    return notifications(next.session).at(-1);
  } finally {
    await next.session.close();
  }
}

async function promptsScenario(context) {
  const { session, agentDir } = await startEnv(context, 'prompts');
  let rubber;
  let focused;
  let usage;
  let fleet;
  try {
    await session.prompt('/rubber-duck');
    await session.prompt('/rubber-duck examine the plan');
    [rubber, focused] = await userTexts(session);

    await session.prompt('/fleet');
    usage = notifications(session).at(-1);
    await session.prompt('/fleet ship the thing');
    fleet = (await userTexts(session)).at(-1);

    await session.prompt('/subagents rubber-duck off');
  } finally {
    await session.close();
  }

  const rejected = await rubberDuckRejection(context, agentDir);

  const capture = writeRaw(context, 'commands-prompts.json', { rubber, focused, usage, fleet, rejected });
  context.receipts.assertVerdict({
    surfaceId: 'PS-CMD-9',
    package: PACKAGE,
    expected: 'Sends a prompt telling the model to call the rubber-duck agent now',
    observed: `/rubber-duck sent user text ${JSON.stringify(rubber?.slice(0, 130))}; with focus it sent ${JSON.stringify(focused?.slice(0, 160))}; in the next session after /subagents rubber-duck off it notified ${JSON.stringify(rejected)}`,
    evidence: capture,
    check: () => {
      assert.match(rubber, /Call the task tool now with agent_type "rubber-duck" and mode "sync"/, '/rubber-duck did not send the rubber-duck prompt');
      assert.match(focused, /what you want challenged: examine the plan\./, '/rubber-duck dropped its focus argument');
      assert.match(rejected, /not available/, 'a disabled rubber-duck agent did not produce a warning');
    },
  });
  context.receipts.assertVerdict({
    surfaceId: 'PS-CMD-10',
    package: PACKAGE,
    expected: 'Sends the fleet prompt (parallel background subagents)',
    observed: `/fleet with no goal notified ${JSON.stringify(usage)}; /fleet ship the thing sent user text ${JSON.stringify(fleet?.slice(0, 170))}`,
    evidence: capture,
    check: () => {
      assert.equal(usage, 'Usage: /fleet <goal>', '/fleet without a goal did not report usage');
      assert.match(fleet, /^Fleet mode\. Goal: ship the thing/, '/fleet did not send the goal');
      assert.match(fleet, /mode "background" in a single turn/, '/fleet did not ask for parallel background subagents');
    },
  });
}

async function finalizeScenario(context) {
  const off = await startEnv(context, 'finalize-off');
  const offCommands = (await off.session.commands()).map((command) => command.name);
  await off.session.close();

  const { session } = await startEnv(context, 'finalize-on', { env: { PI_PSTACK_WORKER_OWNER: 'pt-owner' }, requestTimeoutMs: 60000 });
  try {
    const commands = (await session.commands()).map((command) => command.name);
    await session.prompt('ENV_TASK_BG');
    const started = toolResult(session, 'Task');
    assert.equal(started.isError, false, `background Task failed: ${started.text}`);
    const taskId = started.details.task_id ?? started.details.id;
    const running = await waitForValue(
      async () => {
        const records = (await taskEntries(session)).filter((record) => record.id === taskId);
        return records.at(-1)?.status === 'running' ? records.at(-1) : undefined;
      },
      { description: `task ${taskId} to run` },
    );

    await session.prompt('/pstack-worker-finalize');
    const cleanup = await waitForValue(
      async () => {
        const entries = await entriesOf(session);
        const usage = entries.findLast((entry) => entry.type === 'custom' && entry.customType === 'pstack-worker-cleanup-usage' && entry.data?.taskId === taskId);
        if (!usage) return undefined;
        return { usage: usage.data, errors: entries.filter((entry) => entry.type === 'custom' && entry.customType === 'pstack-worker-cleanup-error') };
      },
      { description: `finalize to reclaim task ${taskId}`, timeoutMs: 90000 },
    );
    const state = await session.state();
    const capture = writeRaw(context, 'commands-finalize.json', { offCommands, commands, taskId, running: running.status, cleanup, sessionAlive: state.sessionId });
    context.receipts.assertVerdict({
      surfaceId: 'PS-CMD-11',
      package: PACKAGE,
      expected: 'Stops all owned tasks, then exits',
      observed: `without PI_PSTACK_WORKER_OWNER the command list lacks pstack-worker-finalize; with it the list includes it, and invoking it aborted background task ${taskId} (record status ${running.status}, retained as the stop handle) and appended a cleanup-usage entry ${JSON.stringify(cleanup.usage.usage?.totalTokens ?? cleanup.usage.usage)} with ${cleanup.errors.length} cleanup errors; the session then answered get_state (the detached root process exit is performed by scripts/detached-rpc-server.mjs after it sends this command)`,
      evidence: capture,
      check: () => {
        assert.ok(!offCommands.includes('pstack-worker-finalize'), 'the finalize command exists without PI_PSTACK_WORKER_OWNER');
        assert.ok(commands.includes('pstack-worker-finalize'), 'the finalize command is missing with PI_PSTACK_WORKER_OWNER');
        assert.equal(cleanup.errors.length, 0, 'finalize left a worker cleanup error');
        assert.equal(cleanup.usage.taskId, taskId, 'the cleanup receipt belongs to a different task');
      },
    });
  } finally {
    await session.close();
  }
}

export default async function pstackConfigCommands(context) {
  await workflowsScenario(context);
  await tasksScenario(context);
  await promptsScenario(context);
  await finalizeScenario(context);
  context.log('✓ pstack-config-commands wrote 6 receipts (PS-CMD-5,6,7,9,10,11)');
}
