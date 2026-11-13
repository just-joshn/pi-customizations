// /model: the offline baseline, the live refresh of both catalogs, reuse of the saved lists, and an
// effort alias the refreshed target no longer offers.
import assert from 'node:assert/strict';

import { sleep, waitUntil } from '../../_shared/verify-harness.mjs';
import { describe } from '../lib/context.mjs';
import { CURSOR_CLIENT_VERSION, cursorCredential, GROK_IDS, grokCredential, USABLE_MODELS_FIXTURE } from '../lib/fixtures.mjs';
import { reply } from '../lib/peers.mjs';

const efforts = (...values) => values.map((value) => ({ value }));
const LIVE_GROK = {
  data: [
    { id: 'grok-4.7', name: 'Grok 4.7', context_window: 256000, api_backend: 'responses', reasoning_efforts: efforts('low', 'medium', 'high', 'xhigh') },
    // The proxy stops offering xhigh on the fast model, so the pinned grok-4.7-xhigh-fast alias must refuse.
    { id: 'grok-4.7-build-fast', name: 'Grok 4.7 Fast', context_window: 256000, reasoning_efforts: efforts('low', 'medium', 'high') },
    { id: 'grok-4.5', name: 'Grok 4.5', context_window: 256000, reasoning_efforts: efforts('low', 'medium', 'high') },
    { id: 'grok-4.9-verify', name: 'Grok 4.9 Verify', context_window: 512000, reasoning_efforts: efforts('low', 'high') },
    { id: 'grok-chat-only', name: 'Chat Only', context_window: 128000, api_backend: 'chat_completions', reasoning_efforts: efforts('low') },
  ],
};

const ids = (stdout, provider) =>
  stdout
    .split('\n')
    .filter((line) => line.startsWith(`${provider} `))
    .map((line) => line.split(/\s+/)[1]);
const transcript = (result) => `${result.args}\nexit ${result.exitCode}\n\n${result.stdout}\n--- stderr ---\n${result.stderr}`;

export default async function modelCatalog(ctx) {
  const { peers, tui, evidence } = ctx;
  peers.route('GET cli-chat-proxy.grok.com/v1/models', reply(200, LIVE_GROK));
  peers.route('POST api2.cursor.sh/aiserver.v1.AiService/GetUsableModels', reply(200, USABLE_MODELS_FIXTURE));
  const grok = grokCredential('catalog');
  const cursor = cursorCredential('catalog');
  await ctx.auth.write({ 'grok-build': grok, cursor });

  await ctx.step('offline baseline', async () => {
    const listed = await ctx.pi(['--offline', '--list-models']);
    await evidence.text('list-models-offline.txt', transcript(listed));
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.deepEqual(ids(listed.stdout, 'grok-build').sort(), [...GROK_IDS].sort(), 'offline grok-build listing: four models and four effort aliases');
    assert.deepEqual(ids(listed.stdout, 'cursor'), ['composer-2.5'], 'offline cursor listing is the baseline');
    assert.equal(peers.requests.length, 0, 'offline listing must not call any catalog');
    return { summary: `${GROK_IDS.length} grok-build ids, cursor composer-2.5, 0 requests`, grok: ids(listed.stdout, 'grok-build'), cursor: ids(listed.stdout, 'cursor') };
  });

  await ctx.step('live refresh in /model', async () => {
    try {
      // The interactive TUI refreshes catalogs at startup and when /model opens.
      await tui.start({ offline: false });
      tui.type('/model');
      tui.keys('Enter');
      await waitUntil('both catalog calls', () => peers.requests.some((r) => r.path === '/v1/models') && peers.requests.some((r) => r.path.endsWith('/GetUsableModels')));
      await tui.waitFor('Model catalogs refreshed.');
      tui.type('verify');
      await sleep(500);
      const filteredGrok = tui.pane();
      tui.keys('C-u');
      tui.type('sonnet');
      await sleep(500);
      const filteredCursor = tui.pane();
      await evidence.text('model-selector-grok.txt', filteredGrok);
      await evidence.text('model-selector-cursor.txt', filteredCursor);
      tui.keys('Escape');
      assert.match(filteredGrok, /grok-4\.9-verify .*\[grok-build\]/, 'a model the proxy adds appears in /model');
      assert.match(filteredCursor, /claude-sonnet-5 .*\[cursor\]/, 'a GetUsableModels row appears in /model');
    } finally {
      await tui.stop();
    }
    const models = peers.requests.find((r) => r.path === '/v1/models');
    const usable = peers.requests.find((r) => r.path.endsWith('/GetUsableModels'));
    assert.equal(models.method, 'GET');
    assert.equal(models.headers.authorization, `Bearer ${grok.access}`);
    assert.equal(usable.headers.authorization, `Bearer ${cursor.access}`);
    assert.equal(usable.headers['connect-protocol-version'], '1');
    assert.equal(usable.headers['x-cursor-client-type'], 'cli');
    assert.equal(usable.headers['x-cursor-client-version'], CURSOR_CLIENT_VERSION);
    assert.equal(usable.body, '{}');
    return { summary: 'both catalogs fetched; grok-4.9-verify and claude-sonnet-5 listed', requests: peers.requests.map(describe) };
  });

  await ctx.step('saved catalog reused offline', async () => {
    const fetched = peers.requests.length;
    const relisted = await ctx.pi(['--offline', '--list-models']);
    await evidence.text('list-models-after-refresh.txt', transcript(relisted));
    const savedGrok = ids(relisted.stdout, 'grok-build');
    const savedCursor = ids(relisted.stdout, 'cursor');
    assert.equal(relisted.exitCode, 0, relisted.stderr);
    assert.equal(peers.requests.length, fetched, 'saved catalog is reused without a fetch');
    assert.ok(savedGrok.includes('grok-4.9-verify'), 'saved grok-build list has the added model');
    assert.ok(!savedGrok.includes('grok-chat-only'), 'a non-responses backend is dropped');
    assert.deepEqual(savedCursor.sort(), ['claude-sonnet-5', 'composer-2.5', 'default'], 'GetUsableModels rows, deduplicated, invalid ids dropped');
    // README: "The four models in the table are always listed, including before the first refresh."
    for (const id of GROK_IDS) assert.ok(savedGrok.includes(id), `${id} must stay listed after a refresh that omits it`);
    return { summary: `${savedGrok.length} grok-build ids, ${savedCursor.length} cursor ids, 0 new requests`, savedGrok, savedCursor };
  });

  await ctx.step('alias effort no longer offered', async () => {
    const pinned = await ctx.pi(['--offline', '-p', 'Reply LOCAL_OK.', '--model', 'grok-build/grok-4.7-xhigh-fast']);
    await evidence.text('alias-effort-dropped.txt', transcript(pinned));
    assert.notEqual(pinned.exitCode, 0, 'grok-4.7-xhigh-fast must fail once xhigh is gone');
    assert.match(`${pinned.stdout}${pinned.stderr}`, /grok-4\.7-build-fast no longer offers xhigh reasoning\. Supported: low, medium, high\./);
    assert.equal(peers.requests.filter((r) => r.path === '/v1/responses').length, 0, 'the refused alias sends nothing');
    return { summary: 'grok-4.7-xhigh-fast refused before any request' };
  });
}
