import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lastToolResult, messageText, prepareChildAgentDir, readJson, startObserved } from './pstack-tools-lib.js';

const PACKAGE = 'extensions/pi-pstack';

function result(session, toolName) {
  const message = lastToolResult(session, toolName);
  assert.ok(message, `no ${toolName} tool result recorded`);
  return { text: messageText(message), details: message.details, isError: message.isError };
}

function customMessages(session) {
  return session.messages().then((messages) => messages.filter((message) => message?.role === 'custom' && message.customType === 'sidekick_inbox'));
}

async function waitForInbox(session, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = await customMessages(session);
    if (found.length > 0) return found;
    await session.prompt(`PT33_AFTER_${attempt}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return customMessages(session);
}

export default async function pstackToolsFeatures(context) {
  const agentDir = prepareChildAgentDir(context, 'features-agent');
  execFileSync('git', ['init', '-q'], { cwd: agentDir });

  const off = await startObserved(context, 'features-off', { agentDir, cwd: agentDir });
  const offSnapshot = readJson(off.observerFile);
  await off.session.close();

  const on = await startObserved(context, 'features-on', {
    agentDir,
    cwd: agentDir,
    env: { COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'copilot_cli_execution_subagent,copilot_cli_search_subagent_model', COPILOT_DYNAMIC_WORKFLOWS: '1' },
  });
  try {
    await on.session.prompt('PT32_WRITE');
    const boardWritten = result(on.session, 'context_board');
    const boardFile = readFileSync(join(agentDir, 'context-boards', boardFileName(agentDir)), 'utf8');
    await on.session.prompt('PT32_READ');
    const boardRead = result(on.session, 'context_board');
    await on.session.prompt('PT32_DELETE');
    const boardDeleted = result(on.session, 'context_board');

    await on.session.prompt('PT34_EXEC');
    const executed = result(on.session, 'execution_subagent');
    await on.session.prompt('PT35_SEARCH');
    const searched = result(on.session, 'search_subagent');

    await on.session.prompt('PT36_RUN');
    const firstRun = result(on.session, 'run_dynamic_workflow');
    const runId = firstRun.details.run.id;
    await on.session.prompt('PT37_LIST');
    const listed = result(on.session, 'dynamic_workflows_manage');
    await on.session.prompt(`PT37_PAUSE:${runId}`);
    const pausedError = result(on.session, 'dynamic_workflows_manage');
    await on.session.prompt(`PT37_RESUME:${runId}`);
    const resumed = result(on.session, 'dynamic_workflows_manage');
    await on.session.prompt(`PT38_READ:${runId}`);
    const read = result(on.session, 'read_workflow_run');
    await on.session.prompt('PT36_RUN');
    const cancelledRun = result(on.session, 'run_dynamic_workflow').details.run.id;
    await on.session.prompt(`PT37_CANCEL:${cancelledRun}`);
    const cancelled = result(on.session, 'dynamic_workflows_manage');

    const onSnapshot = readJson(on.observerFile);
    const active = onSnapshot.activeTools;

    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-32',
      package: PACKAGE,
      expected: 'Reads/writes durable project facts on a per-cwd board',
      observed: `write returned ${JSON.stringify(boardWritten.details.board)}; read returned ${JSON.stringify(boardRead.details.board)}; delete returned ${JSON.stringify(boardDeleted.details.board)}; on-disk board file holds ${JSON.stringify(boardFile.slice(0, 120))}`,
      evidence: on.session.capturePath,
      check: () => {
        assert.equal(boardWritten.details.board['pt-key'], 'pt-value', 'context_board write did not return the written fact');
        assert.equal(boardRead.details.board['pt-key'], 'pt-value', 'context_board read lost the fact');
        assert.equal('pt-key' in boardDeleted.details.board, false, 'context_board delete kept the fact');
        assert.match(boardFile, /pt-key/, 'the on-disk board does not hold the written key');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-34',
      package: PACKAGE,
      expected: 'Runs build/test commands in a separate context',
      observed: `flag off: execution_subagent active=${offSnapshot.activeTools.includes('execution_subagent')}; flag on: active=${active.includes('execution_subagent')} call returned details=${JSON.stringify(executed.details)} text=${JSON.stringify(executed.text.slice(0, 80))}`,
      evidence: on.observerFile,
      check: () => {
        assert.ok(!offSnapshot.activeTools.includes('execution_subagent'), 'execution_subagent is active without its flag');
        assert.ok(active.includes('execution_subagent'), 'execution_subagent is not active with its flag');
        assert.match(executed.text, /scripted fixture reply/, 'execution_subagent did not return the child reply');
        assert.equal(executed.details.status, 'completed', 'execution_subagent did not complete');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-35',
      package: PACKAGE,
      expected: 'Searches code in a separate context',
      observed: `flag off: search_subagent active=${offSnapshot.activeTools.includes('search_subagent')}; flag on: active=${active.includes('search_subagent')} call returned details=${JSON.stringify(searched.details)} text=${JSON.stringify(searched.text.slice(0, 80))}`,
      evidence: on.observerFile,
      check: () => {
        assert.ok(!offSnapshot.activeTools.includes('search_subagent'), 'search_subagent is active without its flag');
        assert.ok(active.includes('search_subagent'), 'search_subagent is not active with its flag');
        assert.match(searched.text, /scripted fixture reply/, 'search_subagent did not return the child reply');
        assert.equal(searched.details.status, 'completed', 'search_subagent did not complete');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-36',
      package: PACKAGE,
      expected: 'Starts a registered dynamic workflow',
      observed: `flags off: run_dynamic_workflow active=${offSnapshot.activeTools.includes('run_dynamic_workflow')}; flags on: active=${active.includes('run_dynamic_workflow')} start returned run status=${firstRun.details.run.status} id=${runId} name=${firstRun.details.run.name}`,
      evidence: on.observerFile,
      check: () => {
        assert.ok(!offSnapshot.activeTools.includes('run_dynamic_workflow'), 'run_dynamic_workflow is active without its flag');
        assert.ok(active.includes('run_dynamic_workflow'), 'run_dynamic_workflow is not active with its flag');
        assert.equal(firstRun.details.run.name, 'pt-probe', 'workflow start returned a different workflow');
        assert.equal(firstRun.details.run.status, 'paused', 'the probe workflow did not stop at its checkpoint');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-37',
      package: PACKAGE,
      expected: 'Lists, cancels, pauses or resumes workflow runs',
      observed: `list returned runs=${JSON.stringify(listed.details.run.map((run) => ({ id: run.id, status: run.status })))}; pause on a paused run returned isError=${pausedError.isError} text=${JSON.stringify(pausedError.text)}; resume returned status=${resumed.details.run.status} result=${JSON.stringify(resumed.details.run.result)}; cancel returned status=${cancelled.details.run.status}; flagged active=${active.includes('dynamic_workflows_manage')} without flag=${offSnapshot.activeTools.includes('dynamic_workflows_manage')}`,
      evidence: on.session.capturePath,
      check: () => {
        assert.ok(!offSnapshot.activeTools.includes('dynamic_workflows_manage'), 'dynamic_workflows_manage is active without its flag');
        assert.ok(
          listed.details.run.some((run) => run.id === runId),
          'dynamic_workflows_manage list did not show the run',
        );
        assert.ok(pausedError.isError && /not running/.test(pausedError.text), 'pausing a paused run did not report the runtime error');
        assert.equal(resumed.details.run.status, 'completed', 'resume did not complete the paused run');
        assert.deepEqual(resumed.details.run.result, { ok: true, resumed: true, marker: 'pt-workflow-result' });
        assert.equal(cancelled.details.run.status, 'cancelled', 'cancel did not cancel the paused run');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-38',
      package: PACKAGE,
      expected: 'Returns status, consumption, phases, journal',
      observed: `read returned status=${read.details.run.status} phases=${JSON.stringify(read.details.run.phases)} consumption=${JSON.stringify(read.details.run.consumption)} journal keys=${JSON.stringify(Object.keys(read.details.run.journal))}; flagged active=${active.includes('read_workflow_run')} without flag=${offSnapshot.activeTools.includes('read_workflow_run')}`,
      evidence: on.session.capturePath,
      check: () => {
        assert.ok(!offSnapshot.activeTools.includes('read_workflow_run'), 'read_workflow_run is active without its flag');
        assert.equal(read.details.run.status, 'completed', 'read_workflow_run returned a different status');
        assert.ok(read.details.run.phases.includes('pt-phase'), 'read_workflow_run lost the workflow phase');
        assert.equal(typeof read.details.run.consumption, 'object', 'read_workflow_run lost consumption');
        assert.equal(typeof read.details.run.journal, 'object', 'read_workflow_run lost the journal');
      },
    });
  } finally {
    await on.session.close();
  }

  const inbox = await startObserved(context, 'features-inbox', { agentDir, cwd: agentDir, env: { COPILOT_SUBCONSCIOUS: '1' } });
  try {
    await inbox.session.prompt('PT33_INBOX_SIDEKICK');
    const delivered = await waitForInbox(inbox.session);
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-33',
      package: PACKAGE,
      expected: 'Emits a message on a pstack child-event channel',
      observed: `subconscious sidekick delivered ${delivered.length} sidekick_inbox message(s): ${JSON.stringify(delivered.map((message) => messageText(message)))}`,
      evidence: inbox.session.capturePath,
      check: () => {
        assert.equal(delivered.length, 1, 'expected one sidekick inbox message');
        assert.match(messageText(delivered[0]), /PT inbox message/, 'the inbox message did not reach the parent');
      },
    });
  } finally {
    await inbox.session.close();
  }
  context.log('✓ pstack-tools-features wrote 7 receipts');
}

function boardFileName(agentDir) {
  return readdirSync(join(agentDir, 'context-boards')).find((name) => name.endsWith('.json'));
}
