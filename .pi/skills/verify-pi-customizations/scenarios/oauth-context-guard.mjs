import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { startMessagesServer } from '../../../../extensions/pi-anthropic-oauth/test/support/messages-server.ts';
import { frames, textMessage } from '../../../../extensions/pi-anthropic-oauth/test/support/sse.ts';
import { ANTHROPIC_PACKAGE, ANTHROPIC_PROVIDER, filler, offlineEnv, startRpc, writeJson } from './oauth-support/harness.mjs';

const COMPACTION_MARKER = 'The conversation history before this point was compacted into the following summary:';
const TRIMMED_NOTICE = 'Claude context guard: trimmed the outgoing request to fit the model limit. The session history is unchanged.';
const COMPACTION_NOTICE = /^Claude context guard: compacting before this request \(about \d+ tokens against a \d+ threshold\)\.$/;
const OMITTED_MARKER = '[Pi context guard: middle of the conversation omitted to fit the model request limit]';
const CONTEXT_WINDOW = 200_000;
const FOREIGN_PROVIDER = 'probe-foreign';
const FOREIGN_MODEL = 'probe-foreign-1';
const MODEL = 'claude-opus-5-5';
const WIRE_BYTES_PER_TOKEN = 3;
const FOREIGN_BYTES_PER_TOKEN = 4.5;

function systemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) return '';
  return system.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\n');
}

function guardFixture() {
  return { type: 'oauth', access: 'sk-ant-oat01-fixture', refresh: 'fixture-refresh', expires: Date.UTC(2100, 0, 1) };
}

async function startGuardGateway() {
  const attempts = [];
  const server = await startMessagesServer((res, request) => {
    const body = request.body;
    const wire = Math.round(Buffer.byteLength(JSON.stringify(body), 'utf8') / WIRE_BYTES_PER_TOKEN);
    const model = typeof body?.model === 'string' ? body.model : '<none>';
    const summarization = systemText(body).toLowerCase().includes('summarization assistant');
    const capped = model === MODEL;
    const over = capped && !summarization && wire > CONTEXT_WINDOW;
    attempts.push({ index: attempts.length, model, wire, summarization, compactionSummary: JSON.stringify(body).includes(COMPACTION_MARKER), status: over ? 400 : 200 });
    if (over) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `prompt is too long: ${wire} tokens > ${CONTEXT_WINDOW} maximum` } }));
      return;
    }
    const foreign = Math.round((wire * WIRE_BYTES_PER_TOKEN) / FOREIGN_BYTES_PER_TOKEN);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(frames(textMessage('ok', { input_tokens: foreign, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })));
  });
  return { server, attempts };
}

async function compactionDrive(context) {
  const gateway = await startGuardGateway();
  const agentDir = join(context.scratchDir, 'guard-compaction');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ [ANTHROPIC_PROVIDER]: guardFixture() }), { mode: 0o600 });
  await writeFile(
    join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        [ANTHROPIC_PROVIDER]: { baseUrl: gateway.server.baseUrl, modelOverrides: { [MODEL]: { contextWindow: CONTEXT_WINDOW } } },
        [FOREIGN_PROVIDER]: { baseUrl: gateway.server.baseUrl, api: 'anthropic-messages', apiKey: 'probe', models: [{ id: FOREIGN_MODEL, name: 'Probe foreign', contextWindow: 1_000_000, maxTokens: 8192 }] },
      },
    }),
  );
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
  const session = startRpc(context, { packagePath: ANTHROPIC_PACKAGE, agentDir, captureName: 'guard-compaction.jsonl', env: offlineEnv({ logPath: join(agentDir, 'routes.log') }) });
  try {
    await session.send({ type: 'set_model', provider: FOREIGN_PROVIDER, modelId: FOREIGN_MODEL });
    await session.prompt(filler('foreign one', 350_000));
    await session.prompt(filler('foreign two', 350_000));
    await session.send({ type: 'set_model', provider: ANTHROPIC_PROVIDER, modelId: MODEL });
    await session.prompt('switch to claude');
    return {
      attempts: gateway.attempts,
      notifications: session.notifications.map((record) => ({ message: record.message, notifyType: record.notifyType })),
      entries: session.entries.filter((entry) => entry.customType === 'claude-context-guard').map((entry) => ({ id: entry.id, data: entry.data })),
      capture: session.capturePath,
    };
  } finally {
    await session.close();
    await gateway.server.close();
  }
}

async function trimDrive(context) {
  const attempts = [];
  const server = await startMessagesServer((res, request) => {
    const wire = Math.round(Buffer.byteLength(JSON.stringify(request.body), 'utf8') / WIRE_BYTES_PER_TOKEN);
    attempts.push({ index: attempts.length, wire, omitted: JSON.stringify(request.body).includes(OMITTED_MARKER) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(frames(textMessage('ok', { input_tokens: Math.max(1, Math.round(wire / 1.2)), output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })));
  });
  const agentDir = join(context.scratchDir, 'guard-trim');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ [ANTHROPIC_PROVIDER]: guardFixture() }), { mode: 0o600 });
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { [ANTHROPIC_PROVIDER]: { baseUrl: server.baseUrl, modelOverrides: { [MODEL]: { contextWindow: 40_000 } } } } }));
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ compaction: { enabled: false } }));
  const session = startRpc(context, { packagePath: ANTHROPIC_PACKAGE, agentDir, captureName: 'guard-trim.jsonl', env: offlineEnv({ logPath: join(agentDir, 'routes.log') }) });
  const guardEntries = () => session.entries.filter((entry) => entry.customType === 'claude-context-guard').map((entry) => ({ id: entry.id, data: entry.data }));
  try {
    const counts = [];
    await session.send({ type: 'set_model', provider: ANTHROPIC_PROVIDER, modelId: MODEL });
    await session.prompt(filler('big one', 60_000));
    counts.push(guardEntries().length);
    await session.prompt(filler('big two', 30_000));
    counts.push(guardEntries().length);
    await session.prompt('tiny');
    counts.push(guardEntries().length);
    await session.send({ type: 'new_session' });
    await session.send({ type: 'set_model', provider: ANTHROPIC_PROVIDER, modelId: MODEL });
    await session.prompt(filler('big one', 60_000));
    await session.prompt(filler('big two', 30_000));
    counts.push(guardEntries().length);
    return { attempts, counts, entries: guardEntries(), capture: session.capturePath };
  } finally {
    await session.close();
    await server.close();
  }
}

function recordEvt3(context, receipts, compaction) {
  const { rawPath } = context;
  writeJson(rawPath('AN-EVT-3.json'), { attempts: compaction.attempts, notifications: compaction.notifications });
  const summarization = compaction.attempts.find((attempt) => attempt.summarization);
  const capped = compaction.attempts.filter((attempt) => attempt.model === MODEL && !attempt.summarization);
  const summarizingAgent = capped.find((attempt) => attempt.compactionSummary);
  receipts.assertVerdict({
    surfaceId: 'AN-EVT-3',
    package: ANTHROPIC_PACKAGE,
    expected: 'Compacts the session early when the estimated payload crosses the threshold',
    observed: `before_agent_start step: ${compaction.attempts.length} payloads reached the loopback endpoint; summarization request status=${summarization?.status} at ${summarization?.wire} tokens; capped agent requests=${JSON.stringify(capped.map((attempt) => ({ wire: attempt.wire, compactionSummary: attempt.compactionSummary })))}`,
    evidence: rawPath('AN-EVT-3.json'),
    check: () => {
      assert.ok(summarization, 'no summarization request reached the endpoint');
      assert.equal(summarization.status, 200, 'the endpoint rejected the compaction summarization');
      assert.ok(summarizingAgent, 'the agent request after compaction did not carry the compaction summary');
      assert.ok(
        capped.every((attempt) => attempt.wire <= CONTEXT_WINDOW),
        `an agent request exceeded the ${CONTEXT_WINDOW} token window`,
      );
      assert.ok(summarizingAgent.wire < CONTEXT_WINDOW / 2, 'the post-compaction request was still near the window');
    },
  });
}

function recordUi1(context, receipts, compaction) {
  const { rawPath } = context;
  writeJson(rawPath('AN-UI-1.json'), { notifications: compaction.notifications, entries: compaction.entries });
  const notice = compaction.notifications.find((record) => COMPACTION_NOTICE.test(record.message));
  const entry = compaction.entries.find((candidate) => candidate.data?.message === notice?.message);
  receipts.assertVerdict({
    surfaceId: 'AN-UI-1',
    package: ANTHROPIC_PACKAGE,
    expected: 'Info notice plus an appended guard entry',
    observed: `notify=${JSON.stringify(notice)}; appended entry customType=claude-context-guard id=${entry?.id} message=${JSON.stringify(entry?.data?.message)}`,
    evidence: rawPath('AN-UI-1.json'),
    check: () => {
      assert.ok(notice, `no guard notify observed; notifications=${JSON.stringify(compaction.notifications)}`);
      assert.equal(notice.notifyType, 'info');
      assert.ok(COMPACTION_NOTICE.test(notice.message));
      assert.ok(entry, 'the guard notice was not appended as a claude-context-guard entry');
    },
  });
}

function recordEvt1(context, receipts, trim) {
  const { rawPath } = context;
  writeJson(rawPath('AN-EVT-1.json'), trim);
  receipts.assertVerdict({
    surfaceId: 'AN-EVT-1',
    package: ANTHROPIC_PACKAGE,
    expected: 'Resets context-guard bias and notices',
    observed: `guard entries after each prompt=${JSON.stringify(trim.counts)} (p1, p2, p3, then new_session + p1 + p2); entries ids=${JSON.stringify(trim.entries.map((entry) => entry.id))} messages=${JSON.stringify(trim.entries.map((entry) => entry.data?.message))}; payloads with the omitted marker=${trim.attempts.filter((attempt) => attempt.omitted).length}`,
    evidence: rawPath('AN-EVT-1.json'),
    check: () => {
      assert.deepEqual(trim.counts, [0, 1, 1, 2], 'the trim notice was not deduplicated within a session and re-emitted after new_session');
      assert.equal(trim.entries.length, 2);
      assert.ok(trim.entries.every((entry) => entry.data?.message === TRIMMED_NOTICE));
      assert.ok(trim.entries[0]?.id !== trim.entries[1]?.id, 'the same entry was read twice');
      assert.ok(trim.attempts.filter((attempt) => attempt.omitted).length >= 2, 'the second session did not trim again');
    },
  });
}

function recordEvt2(context, receipts, trim) {
  const { rawPath } = context;
  writeJson(rawPath('AN-EVT-2.json'), { counts: trim.counts, entries: trim.entries, capture: trim.capture });
  receipts.write({
    surfaceId: 'AN-EVT-2',
    package: ANTHROPIC_PACKAGE,
    expected: 'Resets guard state',
    observed: `guard dedupe state reset across the new_session boundary (notice count ${trim.counts[2]} before, ${trim.counts[3]} after; entries ${trim.entries.map((entry) => entry.id).join(', ')}) on pi ${receipts.piVersion}, but the boundary fires session_shutdown and session_start back to back`,
    evidence: rawPath('AN-EVT-2.json'),
    verdict: 'inconclusive',
    reason:
      'session_shutdown and session_start register the identical reset closure (extensions/pi-anthropic-oauth/src/context/guard.ts:169,197-198); no guard-observable request runs between the two events, so the drive cannot attribute the reset to session_shutdown rather than session_start',
  });
}

export default async function oauthContextGuard(context) {
  const { receipts, log } = context;
  const compaction = await compactionDrive(context);
  recordEvt3(context, receipts, compaction);
  recordUi1(context, receipts, compaction);
  const trim = await trimDrive(context);
  recordEvt1(context, receipts, trim);
  recordEvt2(context, receipts, trim);
  log('✓ AN-EVT-1, AN-EVT-3 and AN-UI-1 verified; AN-EVT-2 recorded inconclusive');
}
