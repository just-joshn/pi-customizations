import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assistantTexts,
  badgeText,
  baseCavemanEnv,
  CAVEMAN_PACKAGE,
  closeCavemanSessions,
  customMessageText,
  noticeMessages,
  notices,
  prepareFixture,
  startCavemanSession,
  systemSections,
  userTexts,
  waitForBadge,
  waitUntil,
  writeRaw,
} from './caveman-fixture.js';

function judge(receipts, { surfaceId, expected, observed, evidence, check }) {
  let failure = null;
  try {
    check();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  receipts.write({
    surfaceId,
    package: CAVEMAN_PACKAGE,
    expected,
    observed: failure ? `${observed} [check failed: ${failure}]` : observed,
    evidence,
    verdict: failure ? 'failed' : 'verified',
    reason: failure,
  });
}

async function driveCavemanCommand(session) {
  const seen = [];
  await session.prompt('/caveman status');
  seen.push(noticeMessages(session).at(-1));
  await session.prompt('/caveman off');
  await waitUntil(() => badgeText(session) === null, { description: 'badge cleared by /caveman off' });
  seen.push(noticeMessages(session).at(-1));
  await session.prompt('/caveman');
  await waitForBadge(session, '[CAVEMAN]');
  seen.push(noticeMessages(session).at(-1));
  await session.prompt('/caveman ultra');
  await waitForBadge(session, '[ULTRACAVE]');
  seen.push(noticeMessages(session).at(-1));
  await session.prompt('/caveman bogus');
  await waitUntil(() => noticeMessages(session).at(-1)?.includes('not recognized'), { description: 'unresolved /caveman argument warning' });
  seen.push(noticeMessages(session).at(-1));
  return seen;
}

async function driveModeCommand(session, command, mode) {
  const seen = [];
  await session.prompt('/caveman off');
  await waitUntil(() => badgeText(session) === null, { description: 'mode reset to off before the mode command' });
  await session.prompt(command);
  await waitForBadge(session, `[${mode.toUpperCase()}]`);
  seen.push({ badge: badgeText(session), notice: noticeMessages(session).at(-1) });
  await session.prompt(`${command} status`);
  seen.push({ badge: badgeText(session), notice: noticeMessages(session).at(-1) });
  await session.prompt(`${command} off`);
  await waitUntil(() => badgeText(session) === null, { description: `badge cleared by ${command} off` });
  seen.push({ badge: badgeText(session), notice: noticeMessages(session).at(-1) });
  return seen;
}

async function driveStatsAndHelp(context, session) {
  await session.prompt('/caveman');
  await waitForBadge(session, '[CAVEMAN]');
  await session.prompt('ordinary turn one');
  const modelReply = assistantTexts(session).at(-1);
  await session.prompt('/caveman-stats');
  const stats = customMessageText(session, 'caveman-stats');
  const historyPath = join(context.scratchDir, 'caveman', 'history.jsonl');
  const historyLine = existsSync(historyPath) ? readFileSync(historyPath, 'utf8').trim().split('\n').at(-1) : null;
  writeRaw(context, 'history-record.json', historyLine === null ? { exists: false } : JSON.parse(historyLine));
  await session.prompt('/caveman-help');
  const help = customMessageText(session, 'caveman-help');
  const sections = systemSections(session, 'caveman');
  const contextMessage = customMessageText(session, 'caveman-context');
  return { modelReply, stats, historyPath, historyLine, help, sections, contextMessage };
}

async function driveInputHook(session) {
  await session.prompt('stop caveman');
  await waitUntil(() => badgeText(session) === null, { description: 'natural-language deactivation' });
  await session.prompt('talk like caveman');
  await waitForBadge(session, '[CAVEMAN]');
  await session.prompt('/caveman:caveman-review hi there');
  await waitForBadge(session, '[CAVEMAN:REVIEW]');
  const skillMessage = userTexts(session).find((text) => text.includes('<skill name="caveman-review"'));
  return { skillMessage };
}

async function drivePersistence(context, env, pkg) {
  const session = startCavemanSession(context, env, { packagePath: pkg, captureName: 'rpc-restore.jsonl', persistSession: true, sessionId: 'caveman-restore-drive' });
  const evidence = session.capturePath;
  try {
    await waitForBadge(session, '[CAVEMAN]');
    await session.prompt('/ultracave');
    await waitForBadge(session, '[ULTRACAVE]');
    await session.prompt('anchor message');
    await session.prompt('second message');
    await session.prompt('/megacave');
    await waitForBadge(session, '[MEGACAVE]');
    await session.prompt('third message');

    await session.restart();
    const restored = await waitForBadge(session, '[MEGACAVE]', 'megacave restored on restart');
    const forkList = await session.send({ type: 'get_fork_messages' });
    const anchor = forkList.messages.find((message) => message.text === 'anchor message');
    assert.ok(anchor, 'anchor message not found in the fork list');
    await session.send({ type: 'fork', entryId: anchor.entryId });
    const forked = await waitForBadge(session, '[ULTRACAVE]', 'branch mode restored after fork');
    return { restored, forked, evidence };
  } finally {
    await session.close();
  }
}

function judgeModeReceipts(receipts, evidence, seen) {
  judge(receipts, {
    surfaceId: 'CV-CMD-1',
    expected: 'Sending /caveman [off|status|...] sets or clears the voice, notices the resulting mode, and a status arg prints the report without changing mode.',
    observed: `notices ${JSON.stringify(seen.caveman)}`,
    evidence,
    check: () => {
      assert.equal(seen.caveman[0], 'Caveman mode: caveman', 'status arg did not report the active mode');
      assert.equal(seen.caveman[1], 'Caveman mode: off', 'off did not report the resulting mode');
      assert.equal(seen.caveman[2], 'Caveman mode: caveman', 'bare /caveman did not turn the voice on');
      assert.equal(seen.caveman[3], 'Caveman mode: ultracave', '/caveman ultra did not resolve to ultracave');
      assert.match(seen.caveman[4] ?? '', /not recognized.*mode is unchanged/s, 'invalid argument warning missing');
    },
  });
  judge(receipts, {
    surfaceId: 'CV-CMD-2',
    expected: 'Sending /ultracave sets the ultracave mode with the same notices as /caveman, status reports it, and off clears it.',
    observed: `sequence ${JSON.stringify(seen.ultra)}`,
    evidence,
    check: () => {
      assert.deepEqual(seen.ultra, [
        { badge: '[ULTRACAVE]', notice: 'Caveman mode: ultracave' },
        { badge: '[ULTRACAVE]', notice: 'Caveman mode: ultracave' },
        { badge: null, notice: 'Caveman mode: off' },
      ]);
    },
  });
  judge(receipts, {
    surfaceId: 'CV-CMD-3',
    expected: 'Sending /megacave sets Classical Chinese mode the same way, status reports it, and off clears it.',
    observed: `sequence ${JSON.stringify(seen.mega)}`,
    evidence,
    check: () => {
      assert.deepEqual(seen.mega, [
        { badge: '[MEGACAVE]', notice: 'Caveman mode: megacave' },
        { badge: '[MEGACAVE]', notice: 'Caveman mode: megacave' },
        { badge: null, notice: 'Caveman mode: off' },
      ]);
    },
  });
}

function judgeReportReceipts(receipts, context, evidence, runs) {
  judge(receipts, {
    surfaceId: 'CV-CMD-4',
    expected: '/caveman-help renders the quick-reference card as a message.',
    observed: `customType=caveman-help message starts ${JSON.stringify(runs.help.slice(0, 80))}`,
    evidence,
    check: () => {
      assert.match(runs.help, /^# Caveman Help/);
      assert.ok(runs.help.includes('## Modes'), 'help card mode table missing');
    },
  });
  judge(receipts, {
    surfaceId: 'CV-CMD-5',
    expected: '/caveman-stats posts token usage and mode attribution for the session and appends a history record.',
    observed: `stats=${JSON.stringify(runs.stats.slice(0, 160))}; history=${runs.historyLine === null ? 'missing' : JSON.stringify(JSON.parse(runs.historyLine))}`,
    evidence,
    check: () => {
      assert.match(runs.stats, /Turns:\s+\d+/);
      assert.ok(runs.stats.includes('caveman'), 'mode attribution missing from the stats report');
      assert.ok(runs.historyLine !== null, `history file not written: ${runs.historyPath}`);
      const record = JSON.parse(runs.historyLine);
      assert.equal(record.session_id?.length > 0, true, 'history record has no session_id');
      assert.ok(record.turns >= 1, `history record reports ${record.turns} turns`);
    },
  });
  judge(receipts, {
    surfaceId: 'CV-CFG-3',
    expected: 'agentDir/caveman/history.jsonl receives a per-session usage record when /caveman-stats runs after at least one turn.',
    observed: `history file ${runs.historyPath} latest line ${JSON.stringify(runs.historyLine === null ? null : JSON.parse(runs.historyLine))}`,
    evidence,
    check: () => {
      assert.ok(runs.historyLine !== null, 'history file was not appended');
      const record = JSON.parse(runs.historyLine);
      assert.equal(runs.historyPath, join(context.scratchDir, 'caveman', 'history.jsonl'));
      assert.ok(record.session_id?.length > 0, 'history record has no session_id');
      assert.ok(record.turns >= 1, 'history record has no turns');
      assert.equal(typeof record.output_tokens_by_mode, 'object', 'history record has no per-mode attribution');
    },
  });
}

function judgeContextReceipts(receipts, evidence, session, runs, directWarning, hook) {
  judge(receipts, {
    surfaceId: 'CV-UI-2',
    expected: 'Mode notices, help, stats and direct-mode warnings arrive as info/warning notices (or stderr when headless).',
    observed: `notify levels ${JSON.stringify(notices(session).map((entry) => entry.level))}; first warning ${JSON.stringify(directWarning ?? '')}`,
    evidence,
    check: () => {
      assert.ok(
        notices(session).some((entry) => entry.level === 'info'),
        'no info notice observed',
      );
      assert.ok(
        notices(session).some((entry) => entry.level === 'warning'),
        'no warning notice observed',
      );
      assert.match(directWarning ?? '', /direct mode, no compression this session/);
    },
  });
  judge(receipts, {
    surfaceId: 'CV-EVT-3',
    expected: 'The input hook detects natural-language mode changes and rewrites /caveman:caveman-* prompts to /skill:caveman-*.',
    observed: `badge after "talk like caveman"=[CAVEMAN], after /caveman:caveman-review=[CAVEMAN:REVIEW]; skill message ${JSON.stringify(hook.skillMessage?.slice(0, 60) ?? null)}`,
    evidence,
    check: () => {
      assert.ok(hook.skillMessage, 'the /caveman:caveman-review prompt was not rewritten to a skill expansion');
    },
  });
  judge(receipts, {
    surfaceId: 'CV-EVT-4',
    expected: 'before_agent_start injects the caveman ruleset section and the per-turn reminder/status message.',
    observed: `system section ${JSON.stringify((runs.sections.at(-1) ?? '').slice(0, 60))}; custom message ${JSON.stringify(runs.contextMessage.slice(0, 80))}; model reply ${JSON.stringify(runs.modelReply)}`,
    evidence,
    check: () => {
      assert.ok(
        runs.sections.some((section) => section.includes('CAVEMAN MODE ACTIVE — mode: caveman')),
        'ruleset section not present',
      );
      assert.match(runs.contextMessage, /CAVEMAN MODE ACTIVE \(caveman\)/);
      assert.match(runs.modelReply, /ruleset=caveman/, 'scripted model did not receive the ruleset section');
    },
  });
}

function judgePersistenceReceipts(receipts, persisted) {
  judge(receipts, {
    surfaceId: 'CV-EVT-1',
    expected: 'session_start restores the mode from branch entries and renders the badge.',
    observed: `badge after restart=${persisted.restored} (fresh default is [CAVEMAN])`,
    evidence: persisted.evidence,
    check: () => {
      assert.equal(persisted.restored, '[MEGACAVE]');
    },
  });
  judge(receipts, {
    surfaceId: 'CV-EVT-2',
    expected: 'session_tree restores the mode stored on the branch that was selected.',
    observed: `badge after fork to the anchor branch=${persisted.forked} (pre-fork branch was [MEGACAVE])`,
    evidence: persisted.evidence,
    check: () => {
      assert.equal(persisted.forked, '[ULTRACAVE]');
    },
  });
}

export default async function cavemanCommands(context) {
  const { receipts } = context;
  const pkg = join(context.repoRoot, CAVEMAN_PACKAGE);
  prepareFixture(context.scratchDir);
  const env = baseCavemanEnv(context.scratchDir);
  const session = startCavemanSession(context, env, { packagePath: pkg, captureName: 'rpc-commands.jsonl' });
  const evidence = session.capturePath;

  try {
    await waitForBadge(session, '[CAVEMAN]');
    const directWarning = noticeMessages(session).find((message) => message.includes('direct mode'));
    writeRaw(context, 'notices.json', notices(session));

    const seen = {
      caveman: await driveCavemanCommand(session),
      ultra: await driveModeCommand(session, '/ultracave', 'ultracave'),
      mega: await driveModeCommand(session, '/megacave', 'megacave'),
    };
    judgeModeReceipts(receipts, evidence, seen);

    const runs = await driveStatsAndHelp(context, session);
    judgeReportReceipts(receipts, context, evidence, runs);

    const hook = await driveInputHook(session);
    judgeContextReceipts(receipts, evidence, session, runs, directWarning, hook);

    judgePersistenceReceipts(receipts, await drivePersistence(context, env, pkg));
  } finally {
    await closeCavemanSessions(context);
  }
}
