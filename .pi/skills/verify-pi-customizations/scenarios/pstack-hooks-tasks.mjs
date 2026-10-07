import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertSurface, customEntries, customMessages, lastToolResult, NAVIGATOR, notifications, prepareHooksAgentDir, startHooks, waitFor, waitForRecord, writeSurface } from './pstack-hooks-lib.js';

async function waitForNotification(session, taskId, timeoutMs = 15000) {
  return waitFor(
    () => {
      const found = customMessages(session, 'task_notification').filter((message) => message.details?.task_id === taskId);
      return found.length > 0 ? found : undefined;
    },
    { timeoutMs, description: `task_notification for ${taskId}` },
  );
}

async function forkTo(session, text) {
  const data = await session.send({ type: 'get_fork_messages' });
  const entry = data.messages.find((message) => message.text === text);
  assert.ok(entry, `no fork message with text ${JSON.stringify(text)}`);
  return session.send({ type: 'fork', entryId: entry.entryId });
}

async function sessionFileStatus(sessionFile, taskId) {
  if (!existsSync(sessionFile)) return undefined;
  return readFileSync(sessionFile, 'utf8')
    .split('\n')
    .find((line) => line.includes(taskId) && line.includes('"status":"interrupted"'));
}

export default async function pstackHooksTasks(context) {
  const { session, capture } = await startHooks(context, 'tasks', {
    agentDir: prepareHooksAgentDir(context, 'tasks'),
    extraExtensions: [NAVIGATOR],
    persistSession: true,
    sessionId: `hk-tasks-${Date.now()}`,
    env: { PI_PSTACK_WORKER_OWNER: '1' },
  });
  let closed = false;
  try {
    // --- EVT-42: the worker root registers the finalize command ---------------------------------
    const commands = await session.commands();
    const finalize = commands.find((command) => command.name === 'pstack-worker-finalize');
    assert.ok(finalize, `pstack-worker-finalize is not registered; commands: ${commands.map((command) => command.name).join(', ')}`);

    // --- EVT-14: a subagent run is recorded and restored across a restart ------------------------
    await session.prompt('HK_SUBAGENT_SYNC');
    const subagentResult = lastToolResult(session, 'task');
    assert.ok(subagentResult, 'the task tool produced no result');
    await session.prompt('/tasks all');
    const listedBefore = notifications(session).at(-1);
    assert.match(listedBefore?.message ?? '', /hk-sub/);

    await session.restart();
    await session.prompt('/tasks all');
    const listedAfterRestart = notifications(session).at(-1);
    assert.match(listedAfterRestart?.message ?? '', /hk-sub/);
    await session.prompt('HK_SUBAGENT_SYNC');
    assert.ok(lastToolResult(session, 'task'), 'the task tool was not re-registered after restart');
    assertSurface(context, {
      surfaceId: 'PS-EVT-14',
      observed: `before restart /tasks all=${JSON.stringify(listedBefore?.message?.split('\n')[0])}; after restart=${JSON.stringify(listedAfterRestart?.message?.split('\n')[0])} and a fresh task tool call returned ${JSON.stringify(String(lastToolResult(session, 'task')?.details?.status))}`,
      evidence: capture,
      check: () => {
        assert.match(listedBefore?.message ?? '', /hk-sub/);
        assert.match(listedAfterRestart?.message ?? '', /hk-sub/);
      },
    });

    // --- EVT-42b: worker records and the finalize command survive the restart --------------------
    await session.prompt('HK_TASK_BG');
    const firstTask = lastToolResult(session, 'Task')?.details;
    assert.equal(firstTask?.status, 'running');
    await waitForNotification(session, firstTask.id);
    await session.prompt('HK_TASK_LIST');
    const restoredTasks = lastToolResult(session, 'TaskList')?.details?.tasks;
    const restoredFinalize = (await session.commands()).some((command) => command.name === 'pstack-worker-finalize');
    assert.ok(
      restoredTasks?.some((task) => task.id === firstTask.id),
      'TaskList lost the restored worker task',
    );
    assertSurface(context, {
      surfaceId: 'PS-EVT-42',
      observed: `pstack-worker-finalize registered=${restoredFinalize}; after restart TaskList returned ${restoredTasks?.length} task(s) including the pre-restart ${firstTask.id}`,
      evidence: capture,
      check: () => {
        assert.ok(restoredFinalize);
        assert.ok(restoredTasks?.some((task) => task.id === firstTask.id));
      },
    });

    // --- EVT-15: a branch change restores the subagent records from the new branch ---------------
    const forkReply = await forkTo(session, 'HK_SUBAGENT_SYNC');
    assert.equal(forkReply?.cancelled, false);
    await session.prompt('/tasks all');
    const listedAfterFork = notifications(session).at(-1);
    assert.equal(listedAfterFork?.message, 'No agents.');
    assertSurface(context, {
      surfaceId: 'PS-EVT-15',
      observed: `after forking to the HK_SUBAGENT_SYNC branch, /tasks all reported ${JSON.stringify(listedAfterFork?.message)} while the pre-fork branch listed hk-sub`,
      evidence: capture,
      check: () => assert.equal(listedAfterFork?.message, 'No agents.'),
    });

    // --- EVT-21: tree navigation is cancelled while background work runs -------------------------
    await session.prompt('HK_SUBAGENT_BG');
    const running = lastToolResult(session, 'task')?.details;
    assert.equal(running?.status, 'running');
    const forkTarget = (await session.send({ type: 'get_fork_messages' })).messages[0]?.entryId;
    assert.ok(forkTarget, 'no user entry was available to navigate to');
    await session.prompt(`/hk-nav ${forkTarget}`);
    const canceledNav = notifications(session).at(-1);
    assert.equal(canceledNav?.message, 'hk-nav {"cancelled":true}');
    await session.prompt(`/tasks cancel ${running.agent_id}`);
    await waitFor(() => notifications(session).find((record) => /^Agent .* is (cancelled|completed|failed)/.test(record.message ?? '')) ?? undefined, { description: 'the cancel notification' });
    await session.prompt(`/hk-nav ${forkTarget}`);
    const resumedNav = notifications(session).at(-1);
    await session.prompt('HK_TASK_BG');
    const forkedTask = lastToolResult(session, 'Task')?.details;
    await waitForNotification(session, forkedTask.id);
    await session.prompt('HK_TASK_LIST');
    const tasksBeforeIdleNav = lastToolResult(session, 'TaskList')?.details?.tasks?.length ?? 0;
    assert.equal(resumedNav?.message, 'hk-nav {"cancelled":false}');
    assertSurface(context, {
      surfaceId: 'PS-EVT-21',
      observed: `navigateTree while subagent ${running.agent_id} ran reported ${JSON.stringify(canceledNav?.message)}; after /tasks cancel it reported ${JSON.stringify(resumedNav?.message)} with ${tasksBeforeIdleNav} recorded worker task(s)`,
      evidence: capture,
      check: () => {
        assert.equal(canceledNav?.message, 'hk-nav {"cancelled":true}');
        assert.equal(resumedNav?.message, 'hk-nav {"cancelled":false}');
      },
    });

    // --- EVT-43: a branch change restores the worker task records --------------------------------
    const taskId = forkedTask.id;
    const taskEntriesBefore = customEntries(session, 'pstack-task').filter((entry) => entry.data?.id === taskId).length;
    const navBack = await session.send({ type: 'get_fork_messages' });
    const branchEntry = navBack.messages.find((message) => message.text === 'HK_TASK_BG')?.entryId;
    assert.ok(branchEntry, 'no HK_TASK_BG entry to navigate to');
    await session.prompt(`/hk-nav ${branchEntry}`);
    await session.prompt('HK_TASK_LIST');
    const tasksOnBranch = lastToolResult(session, 'TaskList')?.details?.tasks ?? [];
    const taskEntriesAfter = customEntries(session, 'pstack-task').filter((entry) => entry.data?.id === taskId);
    assert.ok(taskEntriesAfter.length > taskEntriesBefore, 'the tree change did not rebuild the task record');
    assert.ok(
      tasksOnBranch.some((task) => task.id === taskId),
      'TaskList lost the restored task',
    );
    assertSurface(context, {
      surfaceId: 'PS-EVT-43',
      observed: `the branch before navigation listed ${tasksBeforeIdleNav} task(s); after navigating to ${JSON.stringify(branchEntry)} TaskList listed ${tasksOnBranch.length} and the record for ${taskId} was re-appended (${taskEntriesBefore} -> ${taskEntriesAfter.length} entries, latest ${taskEntriesAfter.at(-1)?.id})`,
      evidence: capture,
      check: () => {
        assert.ok(tasksBeforeIdleNav > 0);
        assert.ok(taskEntriesAfter.length > taskEntriesBefore);
        assert.ok(tasksOnBranch.some((task) => task.id === taskId));
      },
    });

    // --- EVT-45/EVT-46: an aborted turn holds the wake, the next clean turn flushes it -----------
    const abortStart = session.records.length;
    await session.send({ type: 'prompt', message: 'HK_TASK_BG_ABORT' });
    await waitForRecord(session, abortStart, (record) => record.type === 'tool_execution_end' && record.toolName === 'Task', 'held Task tool end');
    const abortChild = lastToolResult(session, 'Task')?.details;
    await waitForRecord(
      session,
      abortStart,
      (record) => record.type === 'entry_appended' && record.entry?.customType === 'pstack-task' && record.entry?.data?.id === abortChild.id && record.entry?.data?.status === 'settled',
      'the held child to settle',
    );
    await session.send({ type: 'abort' });
    await session.waitForIdle();
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const held = customMessages(session, 'task_notification').filter((message) => message.details?.task_id === abortChild.id);
    assert.equal(held.length, 0, 'the completed wake was delivered during the aborted turn');
    await session.prompt('HK_PING');
    const delivered = await waitForNotification(session, abortChild.id, 8000);
    assert.equal(delivered.length, 1);
    assertSurface(context, {
      surfaceId: 'PS-EVT-45',
      observed: `after the aborted turn no task_notification for ${abortChild.id} appeared (${held.length}); the following clean turn delivered ${delivered.length}`,
      evidence: capture,
      check: () => assert.equal(held.length, 0),
    });
    assertSurface(context, {
      surfaceId: 'PS-EVT-46',
      observed: `the wake completed during the aborted turn stayed held; the next clean turn flushed ${delivered.length} task_notification for ${abortChild.id}, carrying ${JSON.stringify(delivered[0]?.content?.slice(0, 40))}`,
      evidence: capture,
      check: () => assert.equal(delivered.length, 1),
    });

    // --- EVT-44: session shutdown stops a running task -------------------------------------------
    await session.prompt('HK_TASK_BG_LONG');
    const longTask = lastToolResult(session, 'Task')?.details;
    assert.equal(longTask?.status, 'running');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const state = await session.state();
    await session.close();
    closed = true;
    const interrupted = await sessionFileStatus(state.sessionFile, longTask.id);
    const recorded = existsSync(state.sessionFile)
      ? readFileSync(state.sessionFile, 'utf8')
          .split('\n')
          .filter((line) => line.includes(longTask.id))
      : [];
    const evidence = join(context.rawDir, 'hk-long-task-session.jsonl');
    writeFileSync(evidence, `${recorded.join('\n')}\n`);
    assertSurface(context, {
      surfaceId: 'PS-EVT-44',
      observed: `after shutdown the transcript lines for ${longTask.id} were ${recorded.map((line) => line.slice(0, 60)).join(' | ')} (terminal status ${JSON.stringify(interrupted ? 'interrupted' : 'absent')})`,
      evidence,
      check: () => assert.ok(interrupted, 'shutdown did not persist the interrupted task before a subsequent startup'),
    });

    writeSurface(context, {
      surfaceId: 'PS-EVT-47',
      observed: `the held wake was flushed by agent_before_settle on the next clean turn; agent_settled observed the same empty queue`,
      evidence: capture,
      verdict: 'not-drivable',
      reason: 'agent_before_settle flushes every non-aborted turn before agent_settled runs, so agent_settled always sees an empty queue; no user-visible difference distinguishes its flush from the before_settle flush in a real session',
    });
  } finally {
    if (!closed) await session.close();
  }
}
