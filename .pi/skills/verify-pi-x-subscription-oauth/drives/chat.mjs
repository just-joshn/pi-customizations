// Grok Build chat: request identity, effort aliases, models.json overrides, 402, and x-grok-conv-id.
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe } from '../lib/context.mjs';
import { GROK_CLIENT_VERSION, grokCredential, responsesText } from '../lib/fixtures.mjs';
import { reply, sse } from '../lib/peers.mjs';

const RESPONSES = 'POST cli-chat-proxy.grok.com/v1/responses';

export default async function chat(ctx) {
  const { peers } = ctx;
  const cred = grokCredential('chat');
  peers.route(RESPONSES, () => sse(responsesText()));
  const responses = () => peers.requests.filter((r) => r.path === '/v1/responses');

  // One print-mode prompt. `expect.fails` is the error the output must show; otherwise the single
  // request must carry `expect`'s model, effort, client version, and context window.
  const ask = (name, args, expect) =>
    ctx.step(name, async () => {
      const before = responses().length;
      const result = await ctx.pi(['--offline', '-p', 'Reply LOCAL_OK.', ...args]);
      const sent = responses().slice(before);
      const record = { command: result.args, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, requests: sent.map(describe) };
      if (expect.fails) {
        assert.equal(result.exitCode, 1, `${name} should exit 1`);
        assert.match(`${result.stdout}${result.stderr}`, expect.fails, name);
        assert.equal(sent.length, expect.requests ?? 0, `${name}: requests sent`);
        return { summary: `exit 1, ${sent.length} request(s), ${`${result.stdout}${result.stderr}`.trim().split('\n')[0]}`, ...record };
      }
      assert.equal(result.exitCode, 0, `${name}: ${result.stderr}`);
      assert.equal(result.stdout.trim(), 'LOCAL_OK', name);
      assert.equal(sent.length, 1, name);
      const [request] = sent;
      const body = JSON.parse(request.body);
      const h = request.headers;
      assert.equal(h.authorization, `Bearer ${cred.access}`, name);
      assert.equal(h['x-grok-client-version'], expect.version ?? GROK_CLIENT_VERSION, `${name}: x-grok-client-version`);
      assert.equal(h['x-xai-token-auth'], 'xai-grok-cli', name);
      assert.equal(h['x-grok-model-override'], expect.model, `${name}: x-grok-model-override`);
      assert.equal(h['x-grok-context-window'], String(expect.contextWindow ?? 256000), `${name}: x-grok-context-window`);
      assert.match(h['x-grok-conv-id'] ?? '', /\S/, `${name}: x-grok-conv-id`);
      assert.equal(body.model, expect.model, `${name}: body.model`);
      assert.equal(body.reasoning?.effort, expect.effort, `${name}: reasoning effort`);
      assert.equal(body.store, false, name);
      assert.ok(body.include?.includes('reasoning.encrypted_content'), `${name}: asks for encrypted reasoning`);
      return { summary: `${body.model}/${body.reasoning.effort}, client ${h['x-grok-client-version']}, context ${h['x-grok-context-window']}`, ...record };
    });

  await ask('no credential', ['--provider', 'grok-build', '--model', 'grok-4.7'], { fails: /No API key found for grok-build/ });
  await ctx.auth.write({ 'grok-build': cred });
  await ask('grok-4.7 high', ['--provider', 'grok-build', '--model', 'grok-4.7', '--thinking', 'high'], { model: 'grok-4.7', effort: 'high' });
  await ask('alias grok-4.7-xhigh-fast', ['--model', 'grok-build/grok-4.7-xhigh-fast'], { model: 'grok-4.7-build-fast', effort: 'xhigh' });
  await ask('alias grok-4.7-low-fast ignores --thinking high', ['--model', 'grok-build/grok-4.7-low-fast', '--thinking', 'high'], { model: 'grok-4.7-build-fast', effort: 'low' });

  // models.json: provider headers win over the package's, and modelOverrides feed x-grok-context-window.
  const modelsJson = join(ctx.run.agentDir, 'models.json');
  await writeFile(modelsJson, JSON.stringify({ providers: { 'grok-build': { headers: { 'x-grok-client-version': '1.0.60' }, modelOverrides: { 'grok-4.7-build-fast': { contextWindow: 500000, maxTokens: 500000 } } } } }, null, 2));
  await ask('models.json overrides', ['--model', 'grok-build/grok-4.7-build-fast', '--thinking', 'medium'], { model: 'grok-4.7-build-fast', effort: 'medium', version: '1.0.60', contextWindow: 500000 });
  await rm(modelsJson);

  // An exhausted balance surfaces the proxy's 402 text, once.
  peers.route(RESPONSES, reply(402, { error: 'Grok Build usage balance exhausted' }));
  await ask('402 balance exhausted, not retried', ['--provider', 'grok-build', '--model', 'grok-4.7'], { fails: /grok-build API error \(402\): 402 "Grok Build usage balance exhausted"/, requests: 1 });
  peers.route(RESPONSES, () => sse(responsesText()));

  await ctx.step('rpc session id', async () => {
    const rpc = ctx.rpc(['--provider', 'grok-build', '--model', 'grok-4.7', '--thinking', 'low']);
    try {
      const before = responses().length;
      const { sessionId } = await rpc.send({ type: 'get_state' });
      await rpc.prompt('Reply LOCAL_OK.');
      await rpc.prompt('Reply LOCAL_OK again.');
      const sent = responses().slice(before);
      const convIds = sent.map((r) => r.headers['x-grok-conv-id']);
      assert.equal(sent.length, 2);
      assert.deepEqual(convIds, [sessionId, sessionId], 'x-grok-conv-id is the Pi session id on every turn');
      return { summary: `x-grok-conv-id = sessionId ${sessionId} on both turns`, sessionId, convIds, requests: sent.map(describe) };
    } finally {
      await rpc.stop();
    }
  });
}
