// Cursor asks: native HTTP/2 Run, a mixed-provider transcript, refusal text, ERROR_NOT_LOGGED_IN,
// and the cursor-agent fallback.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CURSOR_CLIENT_VERSION, cursorCredential, grokCredential, responsesText, responsesToolCall } from '../lib/fixtures.mjs';
import { queue, sse } from '../lib/peers.mjs';

// One redirected HTTP/2 attempt per Cursor ask: native, transcript, refusal, not logged in, fallback.
export const egress = { 'h2 api2.cursor.sh': 5 };

const MODEL = ['--provider', 'cursor', '--model', 'composer-2.5'];

export default async function cursorAsk(ctx) {
  const { peers } = ctx;
  const cred = cursorCredential('ask');
  await ctx.auth.write({ cursor: cred });

  await ctx.step('native ask', async () => {
    const rpc = ctx.rpc(MODEL);
    let reply;
    try {
      await rpc.prompt('Reply LOCAL_OK.');
      const { messages } = await rpc.send({ type: 'get_messages' });
      reply = messages.filter((m) => m.role === 'assistant').at(-1);
    } finally {
      await rpc.stop();
    }
    const [native] = peers.cursor.runs;
    const h = native.headers;
    assert.equal(peers.cursor.runs.length, 1);
    assert.equal(h[':path'], '/agent.v1.AgentService/Run');
    assert.equal(h[':method'], 'POST');
    assert.equal(h['content-type'], 'application/connect+proto');
    assert.equal(h.authorization, `Bearer ${cred.access}`);
    assert.equal(h['x-cursor-client-type'], 'cli');
    assert.equal(h['x-cursor-client-version'], CURSOR_CLIENT_VERSION);
    assert.equal(h['connect-protocol-version'], '1');
    assert.equal(h['connect-accept-encoding'], 'gzip');
    assert.equal(h['user-agent'], 'connect-es/1.6.1');
    assert.equal(h['x-ghost-mode'], 'true', 'native asks run in ghost mode');
    assert.match(h['x-cursor-timezone'] ?? '', /\//, 'x-cursor-timezone');
    assert.match(h['x-request-id'] ?? '', /^[0-9a-f-]{36}$/, 'x-request-id');
    assert.equal(native.run.modelId, 'composer-2.5');
    assert.equal(native.run.mode, 2, 'ask mode');
    assert.match(native.run.prompt, /^System:\n/, 'the system prompt goes first');
    assert.match(native.run.prompt, /\n\nUser:\nReply LOCAL_OK\.$/, 'the user turn is labeled');
    assert.deepEqual(native.contextReply, { execId: 'verify-exec-7', hasResult: true }, 'the context reply echoes the exec id');
    const text = reply.content.map((block) => block.text ?? '').join('');
    assert.equal(text, 'LOCAL_OK');
    assert.equal(reply.stopReason, 'stop');
    assert.deepEqual([reply.usage.input, reply.usage.output, reply.usage.cacheRead, reply.usage.cacheWrite], [11, 3, 5, 0], 'turn-end token counts');
    assert.deepEqual(await ctx.agentCalls(), [], 'native success must not spawn cursor-agent');
    return {
      summary: 'LOCAL_OK, usage [11,3,5,0], exec id echoed',
      native: { ...native, run: { ...native.run, prompt: `${native.run.prompt.slice(0, 120)}… (${native.run.prompt.length} chars)` } },
      reply: { text, usage: reply.usage, stopReason: reply.stopReason },
    };
  });

  await ctx.step('transcript across providers', async () => {
    // Started on grok-build with a `read` tool call, continued on Cursor: every speaker label must
    // reach the native prompt, in order.
    await ctx.auth.write({ cursor: cred, 'grok-build': grokCredential('ask') });
    await writeFile(join(ctx.run.cwd, 'probe.txt'), 'LOCAL_FILE\n');
    peers.route('POST cli-chat-proxy.grok.com/v1/responses', queue(sse(responsesToolCall('read', { path: 'probe.txt' })), sse(responsesText())));
    const rpc = ctx.rpc(['--provider', 'grok-build', '--model', 'grok-4.7', '--thinking', 'low']);
    try {
      await rpc.prompt('Read the probe.');
      await rpc.send({ type: 'set_model', provider: 'cursor', modelId: 'composer-2.5' });
      await rpc.prompt('Summarize the probe.');
    } finally {
      await rpc.stop();
    }
    assert.equal(peers.cursor.runs.length, 2, 'the Cursor turn is one native run');
    const { prompt } = peers.cursor.runs.at(-1).run;
    let at = prompt.indexOf('System:\n');
    assert.equal(at, 0, 'the system prompt goes first');
    for (const turn of ['User:\nRead the probe.', 'Assistant:\n[called tool read]', 'Tool result (read):\nLOCAL_FILE', 'Assistant:\nLOCAL_OK', 'User:\nSummarize the probe.']) {
      const next = prompt.indexOf(`\n\n${turn}`, at);
      assert.ok(next > at, `the native prompt is missing "${turn.replace('\n', '\\n')}" in order`);
      at = next;
    }
    assert.ok(prompt.endsWith('User:\nSummarize the probe.'), 'the new user turn is last');
    return { summary: 'System, User, Assistant tool call, Tool result, Assistant, User in order', prompt };
  });

  await ctx.step('refusal', async () => {
    peers.cursor.use('refusal');
    const result = await ctx.pi(['--offline', '-p', 'Reply LOCAL_OK.', ...MODEL]);
    assert.notEqual(result.exitCode, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Weekly usage limit reached\. It resets in 4 days\. Buy credits to keep going now, or upgrade your plan for more weekly usage\./);
    return { summary: 'Cursor’s weekly-limit text shown', stderr: result.stderr };
  });

  await ctx.step('not logged in', async () => {
    peers.cursor.use('not-logged-in');
    const result = await ctx.pi(['--offline', '-p', 'Reply LOCAL_OK.', ...MODEL]);
    assert.match(`${result.stdout}${result.stderr}`, /Cursor rejected the session \(HTTP 401\)\. Run \/login and choose Cursor\./);
    assert.deepEqual(await ctx.agentCalls(), [], 'a native refusal must not fall back to cursor-agent');
    return { summary: '/login hint, no fallback', stderr: result.stderr };
  });

  await ctx.step('cursor-agent fallback', async () => {
    const runsBefore = peers.cursor.runs.length;
    const guardBefore = (await ctx.guardLog()).length;
    const result = await ctx.pi(['--offline', ...MODEL, '-p', '--', '-starts with a dash'], { VERIFY_X_CURSOR_H2: 'refuse' });
    const calls = await ctx.agentCalls();
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'LOCAL_OK');
    assert.equal(peers.cursor.runs.length, runsBefore, 'the refused native connection never reached the peer');
    assert.equal(calls.length, 1);
    const [argv] = calls;
    assert.deepEqual(argv.slice(0, 9), ['--trust', '--print', '--output-format', 'json', '--mode', 'ask', '--model', 'composer-2.5', '--']);
    assert.match(argv[9], /\n\nUser:\n-starts with a dash$/, 'the prompt follows -- so a leading dash is not a flag');
    const attempted = (await ctx.guardLog()).slice(guardBefore).map((entry) => `${entry.kind} ${entry.target}`);
    assert.deepEqual(attempted, ['h2 api2.cursor.sh'], 'the fallback run first tried native HTTP/2 to api2.cursor.sh, and nothing else');
    return { summary: 'cursor-agent --trust --print … -- <prompt>', agentArgv: calls, attempted };
  });
}
