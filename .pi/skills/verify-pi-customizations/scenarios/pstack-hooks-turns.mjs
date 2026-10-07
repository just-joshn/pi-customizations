import assert from 'node:assert/strict';

import { assertSurface, capturesFrom, customEntries, customMessages, lastToolResult, notifications, prepareHooksAgentDir, promptThenAbortAtTool, startHooks, statuses, widgets, writeSurface } from './pstack-hooks-lib.js';

function lastCapture(captures) {
  const capture = captures.at(-1);
  if (!capture) throw new Error('the scripted provider did not receive a request');
  return capture;
}

function sectionText(value) {
  return typeof value === 'string' ? value : String(value ?? '');
}

function uiAfter(session, since) {
  return session.uiRequests.slice(since);
}

export default async function pstackHooksTurns(context) {
  const { session, capture } = await startHooks(context, 'turns', {
    agentDir: prepareHooksAgentDir(context, 'turns'),
    persistSession: true,
    sessionId: `hk-turns-${Date.now()}`,
    env: { PSTACK_HOOKS_ANTHROPIC: '1' },
  });
  try {
    // --- EVT-5 baseline: pstack_host only, before mode and todos exist -------------------------
    await session.prompt('HK_BASE');
    const base = lastCapture(capturesFrom(capture));
    assert.ok(base.sections.pstack_host, 'the base request is missing pstack_host');
    assert.ok(base.sections.subagent_usage, 'the base request is missing subagent_usage');
    assert.equal(base.sections.pstack_mode, undefined, 'pstack_mode should be absent before opt-in');
    assert.equal(base.sections.pstack_todos, undefined, 'pstack_todos should be absent before any todos');

    // --- EVT-1/EVT-2: the command acknowledgement waits for the forwarded turn ------------------
    await session.send({ id: 'hk-mode-on', type: 'prompt', message: '/poteto-mode' });
    const modeCapture = lastCapture(capturesFrom(capture));
    const responseIndex = session.records.findIndex((record) => record.type === 'response' && record.id === 'hk-mode-on');
    const startsBefore = session.records.slice(0, responseIndex).filter((record) => record.type === 'agent_start').length;
    const settlesBefore = session.records.slice(0, responseIndex).filter((record) => record.type === 'agent_settled').length;
    assert.ok(responseIndex > 0, 'the /poteto-mode command produced no RPC response');
    assert.ok(modeCapture.texts.join('\n').includes('<skill name="poteto-mode"'), 'the mode command did not expand the bundled skill');
    assert.ok(startsBefore > 0, 'the forwarded mode turn never started before the command response');
    assert.ok(settlesBefore > 0, 'the command response arrived before the forwarded turn settled');

    assertSurface(context, {
      surfaceId: 'PS-EVT-1',
      observed: `the /poteto-mode RPC response (record index ${responseIndex}) arrived after ${startsBefore} agent_start record(s) of the turn it forwarded`,
      evidence: session.capturePath,
      check: () => assert.ok(startsBefore > 0 && responseIndex > 0),
    });
    assertSurface(context, {
      surfaceId: 'PS-EVT-2',
      observed: `the /poteto-mode RPC response arrived only after ${settlesBefore} agent_settled record(s); settlement released the deferred acknowledgement`,
      evidence: session.capturePath,
      check: () => assert.ok(settlesBefore > 0),
    });

    // --- UI-1: the status badge carries the mode name and crown glyph ---------------------------
    const modeStatus = statuses(session, 'pstack').at(-1);
    assert.equal(modeStatus?.statusText, '👑 Poteto Mode');
    assertSurface(context, {
      surfaceId: 'PS-UI-1',
      observed: `setStatus pstack statusText=${JSON.stringify(modeStatus?.statusText)}`,
      evidence: session.capturePath,
      check: () => assert.equal(modeStatus?.statusText, '👑 Poteto Mode'),
    });

    // --- UI-2: the todo widget renders the checklist --------------------------------------------
    await session.prompt('HK_TODOS');
    assert.ok(lastToolResult(session, 'TodoWrite'), 'TodoWrite produced no tool result');
    const todoLines = widgets(session, 'pstack-todos').at(-1)?.widgetLines;
    assert.deepEqual(todoLines, ['[x] Read the playbook (completed)', '[>] Write the receipt (in_progress)']);
    assertSurface(context, {
      surfaceId: 'PS-UI-2',
      observed: `setWidget pstack-todos widgetLines=${JSON.stringify(todoLines)}`,
      evidence: session.capturePath,
      check: () => assert.deepEqual(todoLines, ['[x] Read the playbook (completed)', '[>] Write the receipt (in_progress)']),
    });

    // --- EVT-5 context: mode and todo sections follow the state ---------------------------------
    await session.prompt('HK_PING2');
    const withState = lastCapture(capturesFrom(capture));
    assert.ok(withState.sections.pstack_mode, 'pstack_mode missing after opt-in');
    assert.ok(withState.sections.pstack_todos, 'pstack_todos missing after TodoWrite');
    assert.match(sectionText(withState.sections.pstack_todos), /Read the playbook/);

    // --- EVT-10: old pstack-status messages never reach the model --------------------------------
    await session.prompt('/pstack status');
    const statusMessages = customMessages(session, 'pstack-status');
    assert.ok(statusMessages.length > 0, '/pstack status posted no custom message');
    await session.prompt('HK_FILTER');
    const filtered = lastCapture(capturesFrom(capture));
    assert.ok(!filtered.customTypes.includes('pstack-status'), 'an old pstack-status message reached the model request');
    assertSurface(context, {
      surfaceId: 'PS-EVT-10',
      observed: `session holds ${statusMessages.length} pstack-status message(s); the next provider request customTypes=${JSON.stringify(filtered.customTypes)}`,
      evidence: capture,
      check: () => assert.ok(!filtered.customTypes.includes('pstack-status')),
    });

    // --- EVT-48: native skill and owned prompt arguments are rewritten ---------------------------
    await session.prompt('/deslop foo bar');
    const expanded = lastCapture(capturesFrom(capture));
    const expandedText = expanded.texts.join('\n');
    assert.match(expandedText, /Read deslop\/SKILL\.md in full/, 'the owned prompt did not expand');
    assert.match(expandedText, /foo bar/, 'the prompt argument was lost');
    assertSurface(context, {
      surfaceId: 'PS-EVT-48',
      observed: `'/skill:poteto-mode' reached the model as ${JSON.stringify(modeCapture.texts.find((text) => text.includes('<skill name="poteto-mode"'))?.slice(0, 48))}; '/deslop foo bar' reached the model with ${JSON.stringify(expandedText.match(/foo bar[^\n]*/)?.[0])}`,
      evidence: capture,
      check: () => {
        assert.match(modeCapture.texts.join('\n'), /<skill name="poteto-mode"/);
        assert.match(expandedText, /Read deslop\/SKILL\.md in full/);
        assert.match(expandedText, /foo bar/);
      },
    });

    // --- Goal create, then abort the turn so the goal stays active -------------------------------
    await promptThenAbortAtTool(session, 'HK_GOAL_ABORT', 'CreateGoal');
    const goalEntry = customEntries(session, 'pstack-goal').at(-1);
    assert.equal(goalEntry?.data?.status, 'active', 'CreateGoal did not persist an active goal');
    const goalStatus = statuses(session, 'pstack-goal').at(-1);
    assert.equal(goalStatus?.statusText, 'goal');
    assertSurface(context, {
      surfaceId: 'PS-UI-3',
      observed: `setStatus pstack-goal statusText=${JSON.stringify(goalStatus?.statusText)} with branch entry ${JSON.stringify(goalEntry?.data)}`,
      evidence: session.capturePath,
      check: () => assert.equal(goalStatus?.statusText, 'goal'),
    });

    // --- UI-10: /goal with no objective reports usage and the active goal ------------------------
    await session.prompt('/goal');
    const usageNotice = notifications(session).at(-1);
    assert.match(usageNotice?.message ?? '', /^Usage: \/goal <objective>\./);
    assert.match(usageNotice?.message ?? '', /Goal \(active\): Ship the queue/);
    assertSurface(context, {
      surfaceId: 'PS-UI-10',
      observed: `notify notifyType=${JSON.stringify(usageNotice?.notifyType)} message=${JSON.stringify(usageNotice?.message)}`,
      evidence: session.capturePath,
      check: () => assert.equal(usageNotice?.message, 'Usage: /goal <objective>. Use /goal clear to drop the active goal. A leading time limit is unsupported. Use /loop for recurring work.\nGoal (active): Ship the queue'),
    });

    // --- EVT-6 and EVT-3: restart restores goal and state ----------------------------------------
    const uiBeforeRestart = session.uiRequests.length;
    const continueCaptureStart = capturesFrom(capture).length;
    await session.restart();
    await session.prompt('HK_PING4');
    const restartUi = uiAfter(session, uiBeforeRestart);
    const restoredGoalStatus = restartUi.find((record) => record.method === 'setStatus' && record.statusKey === 'pstack-goal');
    const restoredModeStatus = restartUi.find((record) => record.method === 'setStatus' && record.statusKey === 'pstack');
    const restoredTodoWidget = restartUi.find((record) => record.method === 'setWidget' && record.widgetKey === 'pstack-todos');
    const restartCaptures = capturesFrom(capture);
    const restartGoalCapture = restartCaptures.find((record) => record.sections.pstack_goal);
    assert.equal(restoredGoalStatus?.statusText, 'goal', 'goal was not restored on session start');
    assert.equal(restoredModeStatus?.statusText, '👑 Poteto Mode', 'poteto mode was not restored on session start');
    assert.deepEqual(restoredTodoWidget?.widgetLines, ['[x] Read the playbook (completed)', '[>] Write the receipt (in_progress)']);
    assert.match(sectionText(restartGoalCapture?.sections.pstack_goal), /Ship the queue/);
    assertSurface(context, {
      surfaceId: 'PS-EVT-6',
      observed: `after restart, setStatus pstack-goal=${JSON.stringify(restoredGoalStatus?.statusText)} and the next request carried pstack_goal=${JSON.stringify(sectionText(restartGoalCapture?.sections.pstack_goal).slice(0, 40))}; branch entry still ${JSON.stringify(goalEntry?.data)}`,
      evidence: capture,
      check: () => {
        assert.equal(restoredGoalStatus?.statusText, 'goal');
        assert.match(sectionText(restartGoalCapture?.sections.pstack_goal), /Ship the queue/);
      },
    });
    writeSurface(context, {
      surfaceId: 'PS-EVT-3',
      observed: `after restart setStatus pstack=${JSON.stringify(restoredModeStatus?.statusText)} and setWidget pstack-todos=${JSON.stringify(restoredTodoWidget?.widgetLines)}; no host-version warning appeared because the installed Pi 1.0.4 is not older than the tested 1.0.2`,
      evidence: capture,
      verdict: 'inconclusive',
      reason: 'state restore observed on restart; the row also claims the host-version warning, which cannot fire on this host (installed Pi 1.0.4 >= tested @earendil-works/pi-coding-agent 1.0.2)',
    });

    // --- EVT-9: a completed turn with an active goal continues with a visible prompt -------------
    const continuation = customEntries(session, 'pstack-goal-continue').at(-1);
    const continueRequests = capturesFrom(capture, continueCaptureStart);
    assert.match(continuation?.content ?? '', /Goal still active\. Objective:\nShip the queue/);
    assert.ok(
      continueRequests.some((record) => record.lastText.includes('Goal still active')),
      'the continuation never reached the model',
    );
    assert.notEqual(statuses(session, 'pstack-goal').at(-1)?.statusText, 'goal', 'the goal did not complete after the continuation');
    assertSurface(context, {
      surfaceId: 'PS-EVT-9',
      observed: `the completed turn appended a ${JSON.stringify(continuation?.customType)} entry ${JSON.stringify(continuation?.content?.slice(0, 48))} and the model then received it; ${continueRequests.length} follow-up request(s) ran`,
      evidence: capture,
      check: () => {
        assert.match(continuation?.content ?? '', /Goal still active/);
        assert.ok(continueRequests.some((record) => record.lastText.includes('Goal still active')));
      },
    });

    // --- EVT-8: the section follows the active goal and is removed after completion ---------------
    await session.prompt('HK_PING8');
    const afterComplete = lastCapture(capturesFrom(capture));
    assert.equal(afterComplete.sections.pstack_goal, undefined, 'pstack_goal was not removed after the goal completed');
    assertSurface(context, {
      surfaceId: 'PS-EVT-8',
      observed: `with an active goal pstack_goal=${JSON.stringify(sectionText(restartGoalCapture?.sections.pstack_goal).slice(0, 60))}; after UpdateGoal completed it the next request pstack_goal=${JSON.stringify(afterComplete.sections.pstack_goal)}`,
      evidence: capture,
      check: () => {
        assert.match(sectionText(restartGoalCapture?.sections.pstack_goal), /Ship the queue/);
        assert.equal(afterComplete.sections.pstack_goal, undefined);
      },
    });

    // --- EVT-4 and EVT-7: a fork to a branch before the state clears it ---------------------------
    await promptThenAbortAtTool(session, 'HK_GOAL_ABORT', 'CreateGoal');
    const forkData = await session.send({ type: 'get_fork_messages' });
    const entryId = forkData.messages[0]?.entryId;
    assert.ok(entryId, 'no fork message was offered');
    const uiBeforeFork = session.uiRequests.length;
    await session.send({ type: 'fork', entryId });
    const forkUi = uiAfter(session, uiBeforeFork);
    const forkGoalStatus = forkUi.find((record) => record.method === 'setStatus' && record.statusKey === 'pstack-goal');
    const forkModeStatus = forkUi.find((record) => record.method === 'setStatus' && record.statusKey === 'pstack');
    const forkTodoWidget = forkUi.find((record) => record.method === 'setWidget' && record.widgetKey === 'pstack-todos');
    await session.prompt('HK_PING5');
    const forkCapture = lastCapture(capturesFrom(capture));
    assert.equal(forkGoalStatus?.statusText, undefined, 'goal status was not cleared by the branch change');
    assert.equal(forkModeStatus?.statusText, undefined, 'mode status was not cleared by the branch change');
    assert.equal(forkTodoWidget?.widgetLines, undefined, 'todo widget was not cleared by the branch change');
    assert.equal(forkCapture.sections.pstack_goal, undefined, 'pstack_goal leaked across the branch change');
    assertSurface(context, {
      surfaceId: 'PS-EVT-7',
      observed: `fork to ${JSON.stringify(entryId)} emitted setStatus pstack-goal=${JSON.stringify(forkGoalStatus?.statusText)} after that branch held an active goal; the next request pstack_goal=${JSON.stringify(forkCapture.sections.pstack_goal)}`,
      evidence: capture,
      check: () => {
        assert.equal(forkGoalStatus?.statusText, undefined);
        assert.equal(forkCapture.sections.pstack_goal, undefined);
      },
    });
    assertSurface(context, {
      surfaceId: 'PS-EVT-4',
      observed: `fork emitted setStatus pstack=${JSON.stringify(forkModeStatus?.statusText)} and setWidget pstack-todos=${JSON.stringify(forkTodoWidget?.widgetLines)} while the pre-fork branch had mode on and todos`,
      evidence: capture,
      check: () => {
        assert.equal(forkModeStatus?.statusText, undefined);
        assert.equal(forkTodoWidget?.widgetLines, undefined);
      },
    });

    // --- UI-9: /goal clear reports the notice -----------------------------------------------------
    await promptThenAbortAtTool(session, 'HK_GOAL_ABORT', 'CreateGoal');
    const uiBeforeClear = session.uiRequests.length;
    await session.prompt('/goal clear');
    const clearNotice = notifications(session)
      .filter((record) => record.message === 'Goal cleared.')
      .at(-1);
    const clearedStatus = uiAfter(session, uiBeforeClear).find((record) => record.method === 'setStatus' && record.statusKey === 'pstack-goal');
    assert.equal(clearNotice?.message, 'Goal cleared.');
    assert.equal(clearedStatus?.statusText, undefined);
    assertSurface(context, {
      surfaceId: 'PS-UI-9',
      observed: `notify notifyType=${JSON.stringify(clearNotice?.notifyType)} message=${JSON.stringify(clearNotice?.message)} followed by setStatus pstack-goal=${JSON.stringify(clearedStatus?.statusText)}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(clearNotice?.message, 'Goal cleared.');
        assert.equal(clearedStatus?.statusText, undefined);
      },
    });

    // --- UI-11: a leading time limit warns and the goal still gets created ------------------------
    await session.prompt('/goal 5m HK_GOAL_CREATE');
    const limitNotice = notifications(session).find((record) => record.message === 'Time limits are unsupported. The goal is created without one.');
    assert.ok(limitNotice, 'the time-limit warning was not shown');
    const limitedGoal = customEntries(session, 'pstack-goal').at(-1);
    assert.ok(limitedGoal, 'the goal was never created through the delivered skill');
    assertSurface(context, {
      surfaceId: 'PS-UI-11',
      observed: `notify notifyType=${JSON.stringify(limitNotice?.notifyType)} message=${JSON.stringify(limitNotice?.message)}; branch goal=${JSON.stringify(limitedGoal?.data)}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(limitNotice?.notifyType, 'warning');
        assert.equal(limitNotice?.message, 'Time limits are unsupported. The goal is created without one.');
        assert.ok(limitedGoal);
      },
    });

    // --- EVT-5 continued: the anthropic first-action rule ----------------------------------------
    await session.prompt('/poteto-mode');
    await session.send({ type: 'set_model', provider: 'pstack-hooks-anthropic', modelId: 'scripted-claude' });
    await session.prompt('HK_ANTHROPIC');
    const anthropicCapture = lastCapture(capturesFrom(capture));
    assert.match(anthropicCapture.lastText, /first tool call must read the matching playbook/, 'the first-action rule did not reach the model');
    assertSurface(context, {
      surfaceId: 'PS-EVT-5',
      observed: `base request has pstack_host; after mode+todos pstack_mode=${JSON.stringify(sectionText(withState.sections.pstack_mode).slice(0, 32))} pstack_todos=${JSON.stringify(sectionText(withState.sections.pstack_todos).slice(0, 60))}; anthropic request carried rule text ${JSON.stringify(anthropicCapture.lastText.slice(0, 80))}`,
      evidence: capture,
      check: () => {
        assert.ok(base.sections.pstack_host, 'pstack_host was not injected');
        assert.ok(withState.sections.pstack_mode, 'pstack_mode was not injected');
        assert.ok(withState.sections.pstack_todos, 'pstack_todos was not injected');
        assert.match(anthropicCapture.lastText, /first tool call must read the matching playbook/);
      },
    });
  } finally {
    await session.close();
  }
}
