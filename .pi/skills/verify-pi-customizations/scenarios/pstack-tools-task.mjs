import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { lastToolResult, messageText, prepareChildAgentDir, startObserved } from './pstack-tools-lib.js';

const PACKAGE = 'extensions/pi-pstack';

function result(session, toolName) {
  const message = lastToolResult(session, toolName);
  assert.ok(message, `no ${toolName} tool result recorded`);
  return { text: messageText(message), details: message.details, isError: message.isError };
}

export default async function pstackToolsTask(context) {
  const agentDir = prepareChildAgentDir(context, 'task-agent');
  execFileSync('git', ['init', '-q'], { cwd: agentDir });
  const { session, observerFile } = await startObserved(context, 'task', { agentDir, cwd: agentDir });
  try {
    await session.prompt('PT13_SYNC');
    const synced = result(session, 'Task');

    await session.prompt('PT13_CLOUD');
    const cloud = result(session, 'Task');

    await session.prompt('PT13_BG_HOLD');
    const holding = result(session, 'Task');
    const holdingId = holding.details.id;

    await session.prompt('PT16_MESSAGE_LAST');
    const messaged = result(session, 'TaskMessage');

    await session.prompt('PT15_STOP_LAST');
    const stopped = result(session, 'TaskStop');

    await session.prompt('PT13_BG_HOLD');
    const finishing = result(session, 'Task');
    await session.prompt('PT14_OUTPUT_LAST');
    const output = result(session, 'TaskOutput');

    await session.prompt('PT17_LIST');
    const listed = result(session, 'TaskList');
    await session.prompt('PT17_LIST_REPO');
    const repository = result(session, 'TaskList');
    await session.prompt('PT18_ATTACH_LAST');
    const attached = result(session, 'TaskAttach');

    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-13',
      package: PACKAGE,
      expected: 'Starts/resumes a subagent locally or in a configured cloud VM',
      observed: `local sync Task text=${JSON.stringify(synced.text)} details=${JSON.stringify({ id: synced.details.id, persona: synced.details.persona, status: synced.details.status, requestShape: synced.details.requestShape })}; local background Task status=${holding.details.status} requestShape=${holding.details.requestShape}; environment cloud returned isError=${cloud.isError} text=${JSON.stringify(cloud.text.slice(0, 200))}`,
      evidence: observerFile,
      check: () => {
        assert.equal(synced.details.status, 'settled', 'local sync task did not settle');
        assert.match(synced.details.output, /scripted fixture reply/, 'local sync task did not return the child output');
        assert.equal(holding.details.status, 'running', 'background task did not start running');
        assert.equal(holding.details.requestShape, 'background', 'background task reported a different request shape');
        assert.ok(cloud.isError && /configured isolated remote executor|No local fallback/.test(cloud.text), `cloud placement without an executor did not fail as documented: ${cloud.text.slice(0, 200)}`);
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-14',
      package: PACKAGE,
      expected: 'Returns status/output; block waits for completion',
      observed: `TaskOutput(block: true) for ${finishing.details.id} returned status=${output.details.status} output=${JSON.stringify(output.details.output)}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(output.details.id, finishing.details.id, 'TaskOutput returned a different task');
        assert.equal(output.details.status, 'settled', 'blocking TaskOutput did not observe completion');
        assert.match(output.details.output, /scripted fixture reply/, 'TaskOutput did not return the settled output');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-15',
      package: PACKAGE,
      expected: 'Aborts a running child task',
      observed: `TaskStop(${holdingId}) text=${JSON.stringify(stopped.text.slice(0, 100))} details.status=${stopped.details.status} details.message=${JSON.stringify(stopped.details.message)}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(stopped.details.task_id, holdingId, 'TaskStop answered for a different task');
        assert.equal(stopped.details.status, 'interrupted', 'TaskStop did not interrupt the running task');
        assert.match(stopped.details.message, /Stopped task/, 'TaskStop did not report a stop');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-16',
      package: PACKAGE,
      expected: 'Queues steering or follow-up input',
      observed: `TaskMessage(${holdingId}, mode steer) text=${JSON.stringify(messaged.text)} details=${JSON.stringify(messaged.details)}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(messaged.details.task_id, holdingId, 'TaskMessage answered for a different task');
        assert.match(messaged.text, new RegExp(`Message queued for ${holdingId}`), 'TaskMessage did not confirm queueing');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-17',
      package: PACKAGE,
      expected: 'Lists branch tasks or repository launch receipts',
      observed: `TaskList text=${JSON.stringify(listed.text.slice(0, 200))} details.tasks=${JSON.stringify(listed.details.tasks.map((task) => ({ id: task.id, status: task.status })))}; TaskList(repository: true) in a fresh git repo returned tasks=${JSON.stringify(repository.details.tasks)}`,
      evidence: session.capturePath,
      check: () => {
        assert.ok(
          listed.details.tasks.some((task) => task.id === holdingId),
          'TaskList did not list the branch task',
        );
        assert.equal(repository.details.tasks.length, 0, 'fresh repository unexpectedly held launch receipts');
      },
    });
    context.receipts.write({
      surfaceId: 'PS-TOOL-18',
      package: PACKAGE,
      expected: 'Attaches a previously launched remote task and reconciles status',
      verdict: 'env-limited',
      observed: `TaskAttach(${holdingId}) returned isError=${attached.isError} text=${JSON.stringify(attached.text)}; repository discovery found ${repository.details.tasks.length} remote launch receipts`,
      evidence: session.capturePath,
      reason:
        'TaskAttach resolves only records with detached.remote from repository launch receipts. No remote executor is configured on this machine, so no remote task can be launched or discovered; selecting a local branch task through the same tool is rejected. Faking a placement receipt would not exercise attach reconciliation.',
    });
  } finally {
    await session.close();
  }
  context.log('✓ pstack-tools-task wrote 6 receipts (5 verified, PS-TOOL-18 env-limited)');
}
