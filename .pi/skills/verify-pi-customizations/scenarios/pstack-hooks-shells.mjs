import assert from 'node:assert/strict';

import { assertSurface, customMessages, lastToolResult, prepareHooksAgentDir, startHooks } from './pstack-hooks-lib.js';

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForDeath(pid, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

export default async function pstackHooksShells(context) {
  const { session, capture } = await startHooks(context, 'shells', {
    agentDir: prepareHooksAgentDir(context, 'shells'),
    persistSession: true,
    sessionId: `hk-shells-${Date.now()}`,
  });
  let shellPid;
  try {
    await session.prompt('HK_SHELL_TWO_WAKES');
    const started = lastToolResult(session, 'BackgroundShell');
    assert.ok(started, 'BackgroundShell produced no tool result');
    const shell = started.details;
    shellPid = shell.pid;
    assert.deepEqual(shell.status, { kind: 'running' });

    const wakes = await (async () => {
      const deadline = Date.now() + 15000;
      for (;;) {
        const found = customMessages(session, 'pstack-shell-output').filter((message) => message.details?.id === shell.id);
        if (found.length >= 2) return found;
        if (Date.now() > deadline) return found;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();
    assert.equal(wakes.length, 2, `expected two wake messages for two matching lines, saw ${wakes.length}`);
    assert.match(wakes[0].content, /matched HK_READY/);
    assert.match(wakes[1].content, /matched HK_READY/);
    assertSurface(context, {
      surfaceId: 'PS-EVT-13',
      observed: `${wakes.length} pstack-shell-output wakes for shell ${shell.id} (${JSON.stringify(wakes[0]?.content?.split('\n')[0])} / ${JSON.stringify(wakes[1]?.content?.split('\n')[0])}); a second wake only arrives because the first delivery reset wakePending`,
      evidence: session.capturePath,
      check: () => assert.equal(wakes.length, 2),
    });

    await session.prompt('HK_SHELL_LIST');
    // biome-ignore lint/security/noSecrets: the BackgroundShell tool name is not a credential
    const before = lastToolResult(session, 'BackgroundShellList')?.details;
    assert.equal(before?.length, 1, 'the running shell was not listed before the restart');

    const uiBeforeRestart = session.uiRequests.length;
    await session.restart();
    const restartUi = session.uiRequests.slice(uiBeforeRestart);
    assert.ok(
      restartUi.some((record) => record.method === 'setStatus' || record.method === 'setWidget'),
      'the restarted session did not re-render',
    );
    await session.prompt('HK_SHELL_LIST');
    // biome-ignore lint/security/noSecrets: the BackgroundShell tool name is not a credential
    const after = lastToolResult(session, 'BackgroundShellList')?.details;
    assert.deepEqual(after, []);
    assertSurface(context, {
      surfaceId: 'PS-EVT-11',
      observed: `before restart the list held ${before?.length} shell; the restarted session lists ${JSON.stringify(after)} and re-rendered its state, so the runtime serves the new session context`,
      evidence: capture,
      check: () => {
        assert.equal(before?.length, 1);
        assert.deepEqual(after, []);
      },
    });

    await session.prompt('HK_SHELL_START');
    const second = lastToolResult(session, 'BackgroundShell')?.details;
    assert.deepEqual(second?.status, { kind: 'running' });
    shellPid = second.pid;
  } finally {
    await session.close();
  }

  const died = await waitForDeath(shellPid);
  assert.ok(died, `background shell pid ${shellPid} survived session shutdown`);
  assertSurface(context, {
    surfaceId: 'PS-EVT-12',
    observed: `after session shutdown the background shell pid ${shellPid} was gone within 6s (SIGTERM to the process group)`,
    evidence: capture,
    check: () => assert.ok(!isAlive(shellPid)),
  });
}
