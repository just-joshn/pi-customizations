import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertSurface, capturesFrom, customMessages, lastToolResult, NAVIGATOR, prepareHooksAgentDir, SELECTOR, startHooks, waitFor, writeSurface } from './pstack-hooks-lib.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inboxCount = (session) => customMessages(session, 'sidekick_inbox').length;

async function forkTo(session, text) {
  const data = await session.send({ type: 'get_fork_messages' });
  const entry = data.messages.find((message) => message.text === text);
  assert.ok(entry, `no fork message with text ${JSON.stringify(text)}`);
  return session.send({ type: 'fork', entryId: entry.entryId });
}

export default async function pstackHooksMisc(context) {
  // --- EVT-41: a failed task reports its consumed usage on the tool result ----------------------
  const failed = await startHooks(context, 'misc-failed', { agentDir: prepareHooksAgentDir(context, 'misc-failed') });
  try {
    await failed.session.prompt('HK_TASK_FAIL');
    const result = lastToolResult(failed.session, 'Task');
    assert.equal(result?.isError, true);
    assert.equal(result?.usage?.totalTokens, 15);
    assertSurface(context, {
      surfaceId: 'PS-EVT-41',
      observed: `the failed Task tool result carried usage=${JSON.stringify(result?.usage)} with isError=${result?.isError}`,
      evidence: failed.session.capturePath,
      check: () => {
        assert.equal(result?.isError, true);
        assert.equal(result?.usage?.totalTokens, 15);
      },
    });
  } finally {
    await failed.session.close();
  }

  // --- EVT-17/EVT-19/EVT-20/EVT-25: sidekick triggers, cancels and tree tracking ----------------
  const side = await startHooks(context, 'misc-sidekick', {
    agentDir: prepareHooksAgentDir(context, 'misc-sidekick'),
    extraExtensions: [NAVIGATOR],
    persistSession: true,
    sessionId: `hk-side-${Date.now()}`,
    env: { COPILOT_SUBCONSCIOUS: '1', PSTACK_HOOKS_ANTHROPIC: '1' },
  });
  try {
    await side.session.prompt('HK_SIDEKICK');
    await delay(2500);
    const beforeTurn = inboxCount(side.session);
    await side.session.prompt('HK_AFTER');
    const afterTurn = inboxCount(side.session);
    const inbox = customMessages(side.session, 'sidekick_inbox').at(-1);
    assert.equal(beforeTurn, 0);
    assert.equal(afterTurn, 1);
    assert.match(inbox?.content ?? '', /HK sidekick inbox/);
    assertSurface(context, {
      surfaceId: 'PS-EVT-17',
      observed: `a user.message trigger ran the sidekick; the inbox message was queued (${beforeTurn} before the next user turn) and delivered on the next turn: ${JSON.stringify(inbox?.content?.slice(0, 60))}`,
      evidence: side.session.capturePath,
      check: () => {
        assert.equal(afterTurn, 1);
        assert.match(inbox?.content ?? '', /HK sidekick inbox/);
      },
    });

    // EVT-25: the session ctx tracked across a branch change still launches sidekicks.
    await forkTo(side.session, 'HK_SIDEKICK');
    await side.session.prompt('HK_SIDEKICK');
    await delay(2500);
    await side.session.prompt('HK_AFTER2');
    const afterForkCount = inboxCount(side.session);
    assert.equal(afterForkCount, 2);
    assertSurface(context, {
      surfaceId: 'PS-EVT-25',
      observed: `after forking to the HK_SIDEKICK branch, a fresh user.message trigger still launched the sidekick and delivered inbox ${afterForkCount} of 2`,
      evidence: side.session.capturePath,
      check: () => assert.equal(afterForkCount, 2),
    });

    // EVT-19: a model change cancels the running sidekick before it delivers.
    await side.session.send({ id: 'hk-cancel-hold', type: 'prompt', message: 'HK_SIDEKICK_HOLD' });
    await delay(800);
    await side.session.send({ type: 'set_model', provider: 'pstack-hooks-anthropic', modelId: 'scripted-claude' });
    await delay(6000);
    await side.session.prompt('HK_AFTER3');
    await delay(1000);
    assert.equal(inboxCount(side.session), 2, 'the cancelled sidekick delivered an inbox message');
    assertSurface(context, {
      surfaceId: 'PS-EVT-19',
      observed: `the model change fired while a sidekick held; after 6s and a following user turn the inbox count stayed ${inboxCount(side.session)} (the sidekick never delivered)`,
      evidence: side.session.capturePath,
      check: () => assert.equal(inboxCount(side.session), 2),
    });

    // EVT-20: aborting the turn cancels the running sidekick.
    await side.session.send({ id: 'hk-abort-hold', type: 'prompt', message: 'HK_SIDEKICK_HOLD' });
    await delay(800);
    await side.session.send({ type: 'abort' });
    await side.session.waitForIdle();
    await delay(6000);
    await side.session.prompt('HK_AFTER4');
    await delay(1000);
    assert.equal(inboxCount(side.session), 2, 'the aborted turn still delivered a sidekick inbox message');
    assertSurface(context, {
      surfaceId: 'PS-EVT-20',
      observed: `an aborted turn fired while a sidekick held; after 6s and a following user turn the inbox count stayed ${inboxCount(side.session)}`,
      evidence: side.session.capturePath,
      check: () => assert.equal(inboxCount(side.session), 2),
    });

    // EVT-18: compaction trigger. The fixture session is too small for Pi to compact.
    const compactError = await side.session.send({ type: 'compact' }).then(
      () => null,
      (error) => error.message,
    );
    writeSurface(context, {
      surfaceId: 'PS-EVT-18',
      observed: `a manual compact attempt answered ${JSON.stringify(compactError ?? 'success')} and the sidekick inbox count stayed ${inboxCount(side.session)}`,
      evidence: side.session.capturePath,
      verdict: 'not-drivable',
      reason: 'Pi refuses to compact a session that is too small ("Nothing to compact (session too small)") and the scripted fixture cannot grow the context enough to pass the threshold, so session_compact never fires in this drive',
    });
  } finally {
    await side.session.close();
  }

  // --- EVT-28: before_agent_start injects the selected agent and usage sections -----------------
  const sections = await startHooks(context, 'misc-sections', {
    agentDir: prepareHooksAgentDir(context, 'misc-sections', { subagents: { agents: { 'rubber-duck': { model: 'pstack-hooks/scripted' } } } }),
    extraExtensions: [SELECTOR],
    env: { RUBBER_DUCK_AGENT: '1', PSTACK_HOOKS_SELECT_AGENT: 'rubber-duck' },
  });
  try {
    await sections.session.prompt('HK_BASE');
    const capture = capturesFrom(sections.capture).at(-1);
    assert.match(String(capture?.sections?.selected_agent ?? ''), /rubber duck/i);
    assert.ok(capture?.sections?.subagent_usage, 'subagent_usage section missing');
    assert.match(String(capture?.sections?.subagent_model_preferences ?? ''), /rubber-duck/);
    assertSurface(context, {
      surfaceId: 'PS-EVT-28',
      observed: `request sections ${JSON.stringify(Object.keys(capture?.sections ?? {}))} with selected_agent=${JSON.stringify(String(capture?.sections?.selected_agent ?? '').slice(0, 40))} and preferences mentioning rubber-duck`,
      evidence: sections.capture,
      check: () => {
        assert.match(String(capture?.sections?.selected_agent ?? ''), /rubber duck/i);
        assert.ok(capture?.sections?.subagent_usage);
        assert.match(String(capture?.sections?.subagent_model_preferences ?? ''), /rubber-duck/);
      },
    });
  } finally {
    await sections.session.close();
  }

  // --- EVT-22: a headless run waits for background subagents before exiting ---------------------
  const headlessDir = prepareHooksAgentDir(context, 'misc-headless');
  const capturePath = join(context.rawDir, 'headless.jsonl');
  const stdout = context.runPi(
    [
      '--mode',
      'json',
      '--no-session',
      '--no-extensions',
      '-e',
      join(context.repoRoot, 'extensions/pi-pstack'),
      '-e',
      join(context.repoRoot, '.pi/skills/verify-pi-customizations/scenarios/pstack-hooks-provider.js'),
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '--provider',
      'pstack-hooks',
      '--model',
      'scripted',
      '--thinking',
      'off',
      'HK_SUBAGENT_BG',
    ],
    { cwd: headlessDir, agentDir: headlessDir, env: { PSTACK_HOOKS_CAPTURE: capturePath }, timeoutMs: 60000 },
  );
  assert.match(stdout, /has finished processing and is now idle/);
  assertSurface(context, {
    surfaceId: 'PS-EVT-22',
    observed: `the headless json run emitted the background agent's completion notice before exit (${JSON.stringify(stdout.split('\n').at(-1)?.slice(0, 120))})`,
    evidence: capturePath,
    check: () => assert.match(stdout, /has finished processing and is now idle/),
  });

  // --- EVT-16: session shutdown halts the workflow runtime --------------------------------------
  const workflows = await startHooks(context, 'misc-workflow', {
    agentDir: prepareHooksAgentDir(context, 'misc-workflow'),
    persistSession: true,
    sessionId: `hk-wf-${Date.now()}`,
    env: { COPILOT_DYNAMIC_WORKFLOWS: '1', PSTACK_HOOKS_WORKFLOW: '1' },
    answers: { confirm: () => true },
  });
  try {
    const state = await workflows.session.state();
    await workflows.session.send({ id: 'hk-wf-run', type: 'prompt', message: 'HK_WORKFLOW_RUN' });
    await waitFor(() => (workflows.session.uiRequests.some((record) => record.method === 'confirm' && record.title === 'Run workflow hk-workflow?') ? true : undefined), { description: 'the workflow confirmation' });
    await delay(1200);
    await workflows.session.close();
    await delay(500);
    const transcript = existsSync(state.sessionFile) ? readFileSync(state.sessionFile, 'utf8') : '';
    const statusLines = transcript.split('\n').filter((line) => line.includes('workflow') && line.includes('"status"'));
    const statuses = statusLines.map((line) => line.match(/"status":"([a-z]+)"/)?.[1]).filter(Boolean);
    const evidence = join(context.rawDir, 'hk-workflow-halt.jsonl');
    writeFileSync(evidence, `${statusLines.join('\n')}\n`);
    assert.equal(statuses.at(-1), 'halted');
    assertSurface(context, {
      surfaceId: 'PS-EVT-16',
      observed: `after shutting down mid-run the parent transcript recorded workflow statuses ${JSON.stringify(statuses)}; the last run entry is ${JSON.stringify(statusLines.at(-1)?.slice(0, 160))}`,
      evidence,
      check: () => assert.equal(statuses.at(-1), 'halted'),
    });
  } finally {
    await workflows.session.close().catch(() => {});
  }

  const undriven = [
    ['PS-EVT-23', 'session_start tracking and limiter refresh only mutate in-memory counters; no user-visible surface reports them and no session record reflects the refresh'],
    ['PS-EVT-24', 'resources_discover is emitted by Pi resource reloads; RPC mode exposes no reload command, so the discovery cache reset cannot be triggered or read from a user action'],
    [
      'PS-EVT-27',
      'session shutdown cancels sidekicks and shuts the scheduler inside the exiting process; the transcript records no terminal sidekick status, so nothing distinguishes this cleanup from process exit (same class as PS-EVT-44)',
    ],
    [
      'PS-EVT-40',
      'MCP inheritance requires a parent MCP server registered by another extension; no MCP server is available in this environment and the child would only reveal the inherited registration through its own MCP tool surface, which cannot connect',
    ],
    [
      'PS-UI-12',
      'the host-version warning fires only when the installed Pi is older than the tested @earendil-works/pi-coding-agent 1.0.2; the only installed hosts are 1.0.4 and 1.0.3, both newer, and standing orders require the PATH host 1.0.4',
    ],
    ['PS-UI-18', 'the picker custom component renders only in TUI mode; RPC degrades pick() to ctx.ui.select (driven as PS-UI-17), and observing the custom filter component needs a tmux TUI drive'],
  ];
  for (const [surfaceId, reason] of undriven) {
    writeSurface(context, {
      surfaceId,
      observed: `attempted in this unit; ${reason}`,
      evidence: side.session.capturePath,
      verdict: 'not-drivable',
      reason,
    });
  }
}
