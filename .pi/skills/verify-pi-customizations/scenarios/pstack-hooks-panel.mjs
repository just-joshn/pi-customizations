import assert from 'node:assert/strict';

import { assertSurface, customEntries, customMessages, lastToolResult, prepareHooksAgentDir, startHooks, widgets } from './pstack-hooks-lib.js';

async function waitForNotification(session, startIndex, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = customMessages(session, 'task_notification').slice(startIndex);
    if (found.length > 0) return found;
    if (Date.now() > deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export default async function pstackHooksPanel(context) {
  const writePath = `${context.scratchDir}/hk-panel-write.txt`;
  const { session, capture } = await startHooks(context, 'panel', {
    agentDir: prepareHooksAgentDir(context, 'panel'),
    persistSession: true,
    sessionId: `hk-panel-${Date.now()}`,
    env: { PSTACK_HOOKS_WRITE_PATH: writePath },
  });
  let closed = false;
  try {
    // --- EVT-26: an edit/write tool appends a file-change entry ---------------------------------
    await session.prompt('HK_WRITE');
    const change = customEntries(session, 'reference-assistant-file-change').at(-1);
    assert.equal(change?.data?.path, writePath);
    assertSurface(context, {
      surfaceId: 'PS-EVT-26',
      observed: `the write tool call appended entry ${JSON.stringify(change?.customType)} data=${JSON.stringify(change?.data)}`,
      evidence: session.capturePath,
      check: () => assert.equal(change?.data?.path, writePath),
    });

    // --- UI-4: a running background task is listed in the pstack-agents panel -------------------
    await session.prompt('HK_TASK_BG');
    const started = lastToolResult(session, 'Task');
    assert.equal(started?.details?.status, 'running');
    const runningLines = widgets(session, 'pstack-agents').at(-1)?.widgetLines;
    assert.deepEqual(runningLines, ['● generalPurpose: generalPurpose']);
    assertSurface(context, {
      surfaceId: 'PS-UI-4',
      observed: `setWidget pstack-agents widgetLines=${JSON.stringify(runningLines)} for task ${started?.details?.id}`,
      evidence: session.capturePath,
      check: () => assert.deepEqual(runningLines, ['● generalPurpose: generalPurpose']),
    });

    // --- EVT-39: a settled task is dismissed by the next user input ------------------------------
    const notifications = await waitForNotification(session, 0);
    assert.equal(notifications.length, 1, 'the background task produced no completion notice');
    const settledLines = widgets(session, 'pstack-agents').at(-1)?.widgetLines;
    assert.deepEqual(settledLines, ['✓ generalPurpose: generalPurpose']);
    await session.prompt('HK_PING');
    const dismissedLines = widgets(session, 'pstack-agents').at(-1)?.widgetLines;
    assert.equal(dismissedLines, undefined);
    assertSurface(context, {
      surfaceId: 'PS-EVT-39',
      observed: `after the task settled the panel held ${JSON.stringify(settledLines)}; the next user prompt set setWidget pstack-agents=${JSON.stringify(dismissedLines)}`,
      evidence: session.capturePath,
      check: () => {
        assert.deepEqual(settledLines, ['✓ generalPurpose: generalPurpose']);
        assert.equal(dismissedLines, undefined);
      },
    });

    // --- EVT-37: session start attaches the panel and renders restored records -------------------
    const uiBeforeRestart = session.uiRequests.length;
    await session.restart();
    await session.prompt('HK_PING');
    const restartWidgets = session.uiRequests.slice(uiBeforeRestart).filter((record) => record.method === 'setWidget' && record.widgetKey === 'pstack-agents');
    const attachLines = restartWidgets.flatMap((record) => record.widgetLines ?? []).find((line) => line.includes('generalPurpose'));
    assert.deepEqual(attachLines, '✓ generalPurpose: generalPurpose');
    assertSurface(context, {
      surfaceId: 'PS-EVT-37',
      observed: `after restart the panel attach set widgetLines ${JSON.stringify(restartWidgets.map((record) => record.widgetLines).filter(Boolean))} from the restored task record`,
      evidence: capture,
      check: () => assert.deepEqual(attachLines, '✓ generalPurpose: generalPurpose'),
    });

    // --- EVT-38: session shutdown detaches the panel ---------------------------------------------
    const uiBeforeClose = session.uiRequests.length;
    await session.close();
    closed = true;
    const detach = session.uiRequests.slice(uiBeforeClose).filter((record) => record.method === 'setWidget' && record.widgetKey === 'pstack-agents');
    assert.ok(
      detach.some((record) => record.widgetLines === undefined),
      'shutdown did not clear the panel widget',
    );
    assertSurface(context, {
      surfaceId: 'PS-EVT-38',
      observed: `session shutdown emitted ${detach.length} setWidget pstack-agents record(s), last widgetLines=${JSON.stringify(detach.at(-1)?.widgetLines)}`,
      evidence: session.capturePath,
      check: () => assert.ok(detach.some((record) => record.widgetLines === undefined)),
    });
  } finally {
    if (!closed) await session.close();
  }
}
