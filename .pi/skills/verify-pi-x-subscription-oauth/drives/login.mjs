// /login → Grok Build: browser callback, wrong-state paste, pasted redirect URL, and device code.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { get as httpGet } from 'node:http';

import { waitUntil } from '../../_shared/verify-harness.mjs';
import { describe } from '../lib/context.mjs';
import { AUTHORIZE_FIXTURE, GROK_CLIENT_ID, GROK_CLIENT_VERSION, tokenReply } from '../lib/fixtures.mjs';
import { reply } from '../lib/peers.mjs';

const LOGGED_IN = 'Logged in to Grok Build (The X Subscription). Credentials saved';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const form = (request) => Object.fromEntries(new URLSearchParams(request.body));
const pkceMatches = (verifier, challenge) => createHash('sha256').update(verifier).digest('base64url') === challenge;

// The browser's redirect to the loopback callback. Plain http.get: no proxy env applies here.
function visit(url) {
  return new Promise((done, fail) => {
    httpGet(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => done({ status: res.statusCode, body }));
    }).on('error', fail);
  });
}

// Addresses a local TCP port listens on, per lsof.
const listeningOn = (port) =>
  execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.startsWith('n'))
    .map((line) => line.slice(1));

export default async function login(ctx) {
  const { peers, tui, auth, evidence } = ctx;
  const issued = [];
  const issue = (label) => {
    const body = tokenReply(label);
    issued.push(body);
    return reply(200, body);
  };
  // The first device poll is still pending; the next one gets tokens.
  let devicePolls = 0;
  peers.route('POST auth.x.ai/oauth2/token', (request) => {
    if (form(request).grant_type !== DEVICE_GRANT) return issue('code');
    devicePolls += 1;
    return devicePolls === 1 ? reply(400, { error: 'authorization_pending' }) : issue('device');
  });
  peers.route('POST auth.x.ai/oauth2/device/code', reply(200, { device_code: `verify-device-${randomUUID()}`, user_code: 'VRFY-7Q2K', verification_uri: 'https://accounts.x.ai/device', expires_in: 300, interval: 1 }));
  const tokenRequests = () => peers.requests.filter((r) => r.path === '/oauth2/token');

  // /login → Grok Build → <method> on a fresh TUI with no stored credential.
  const begin = async (method) => {
    await auth.clear();
    await tui.start();
    await tui.openLogin('Grok Build (The X Subscription)');
    await tui.waitFor('Sign in to Grok Build');
    if (method === 'device') tui.keys('Down');
    tui.keys('Enter');
  };
  const authorizeUrl = async () => {
    const before = (await ctx.opened()).length;
    await tui.waitFor('Paste the redirect URL');
    await waitUntil('browser opener', async () => (await ctx.opened()).length > before);
    const opened = (await ctx.opened()).slice(before);
    assert.equal(opened.length, 1, 'Browser sign-in should open exactly one URL.');
    return new URL(opened[0]);
  };
  // The stored credential is the last issued token, expiring 300 s before expires_in from the exchange.
  const expectStored = async (name, exchangedAfter) => {
    const stored = (await auth.read())['grok-build'];
    const issuedBody = issued.at(-1);
    assert.ok(stored, `${name}: no grok-build credential stored`);
    assert.equal(stored.type, 'oauth');
    assert.equal(stored.access, issuedBody.access_token, `${name}: stored access token`);
    assert.equal(stored.refresh, issuedBody.refresh_token, `${name}: stored refresh token`);
    assert.ok(stored.expires >= exchangedAfter + 21600_000 - 300_000 && stored.expires <= Date.now() + 21600_000 - 300_000, `${name}: expires ${stored.expires} not within the exchange window`);
    assert.equal(auth.mode(), '600', `${name}: auth.json mode`);
    return stored;
  };
  const expectExchange = (exchange, url, code) => {
    const fields = form(exchange);
    assert.deepEqual(Object.keys(fields), ['grant_type', 'client_id', 'code', 'redirect_uri', 'code_verifier']);
    assert.equal(fields.grant_type, 'authorization_code');
    assert.equal(fields.client_id, GROK_CLIENT_ID);
    assert.equal(fields.code, code);
    assert.equal(fields.redirect_uri, url.searchParams.get('redirect_uri'));
    assert.ok(pkceMatches(fields.code_verifier, url.searchParams.get('code_challenge')), 'PKCE verifier matches the challenge');
  };

  try {
    await ctx.step('browser callback', async () => {
      await begin('browser');
      const url = await authorizeUrl();
      await evidence.text('browser-authorize-pane.txt', tui.pane());
      // Byte for byte the Grok 1.0.70 authorize request, apart from the per-run values.
      const captured = new URL(AUTHORIZE_FIXTURE.authorizeUrl);
      assert.equal(`${url.origin}${url.pathname}`, `${captured.origin}${captured.pathname}`);
      assert.deepEqual([...url.searchParams.keys()], AUTHORIZE_FIXTURE.queryParameterOrder, 'authorize parameter order');
      for (const [name, value] of Object.entries(AUTHORIZE_FIXTURE.stableParameters)) assert.equal(url.searchParams.get(name), value, `authorize ${name}`);
      assert.ok(url.search.includes('scope=openid%20profile'), 'scope uses %20 separators like Grok 1.0.70');
      const redirectUri = url.searchParams.get('redirect_uri');
      assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      assert.match(url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
      for (const name of ['state', 'nonce']) assert.match(url.searchParams.get(name), /^[0-9a-f-]{36}$/, name);
      // A server on 0.0.0.0 would still name 127.0.0.1 in the URI, so check where it listens.
      const listening = listeningOn(new URL(redirectUri).port);
      assert.ok(listening.length > 0, 'the loopback callback is listening');
      assert.ok(
        listening.every((address) => /^(127\.0\.0\.1|\[::1\]):\d+$/.test(address)),
        `the callback listens beyond loopback: ${listening.join(', ')}`,
      );
      const exchangedAfter = Date.now();
      const callback = await visit(`${redirectUri}?code=verify-callback-code&state=${url.searchParams.get('state')}`);
      assert.equal(callback.status, 200);
      assert.match(callback.body, /Signed in/);
      await evidence.text('browser-callback-pane.txt', await tui.waitFor(LOGGED_IN));
      const [exchange] = tokenRequests();
      expectExchange(exchange, url, 'verify-callback-code');
      const credential = await expectStored('browser callback', exchangedAfter);
      await tui.stop();
      return { summary: 'stored via loopback callback, PKCE verified', authorizeUrl: url.href, listening, tokenRequest: describe(exchange), credential };
    });

    await ctx.step('browser paste, wrong state', async () => {
      const tokensBefore = tokenRequests().length;
      await begin('browser');
      const url = await authorizeUrl();
      tui.type(`${url.searchParams.get('redirect_uri')}?code=verify-wrong-state&state=${randomUUID()}`);
      tui.keys('Enter');
      await evidence.text('browser-paste-wrong-state-pane.txt', await tui.waitFor('xAI OAuth callback was rejected'));
      assert.equal(tokenRequests().length, tokensBefore, 'A wrong state must not reach the token endpoint.');
      assert.equal((await auth.read())['grok-build'], undefined, 'A rejected paste must not store a credential.');
      await tui.stop();
      return { summary: 'rejected: xAI OAuth callback was rejected; 0 token requests; nothing stored' };
    });

    await ctx.step('browser paste', async () => {
      await begin('browser');
      const url = await authorizeUrl();
      const exchangedAfter = Date.now();
      tui.type(`${url.searchParams.get('redirect_uri')}?code=verify-pasted-code&state=${url.searchParams.get('state')}`);
      tui.keys('Enter');
      await evidence.text('browser-paste-pane.txt', await tui.waitFor(LOGGED_IN));
      const exchange = tokenRequests().at(-1);
      expectExchange(exchange, url, 'verify-pasted-code');
      const credential = await expectStored('browser paste', exchangedAfter);
      await tui.stop();
      return { summary: 'stored via pasted redirect URL, PKCE verified', tokenRequest: describe(exchange), credential };
    });

    await ctx.step('device code', async () => {
      const exchangedAfter = Date.now();
      await begin('device');
      const shown = await tui.waitFor('Enter code: VRFY-7Q2K');
      await evidence.text('device-code-pane.txt', shown);
      assert.match(shown, /accounts\.x\.ai\/device/);
      await evidence.text('device-result-pane.txt', await tui.waitFor(LOGGED_IN, 30_000));
      const start = peers.requests.find((r) => r.path === '/oauth2/device/code');
      const polls = tokenRequests().filter((r) => form(r).grant_type === DEVICE_GRANT);
      assert.deepEqual(form(start), { client_id: GROK_CLIENT_ID, scope: AUTHORIZE_FIXTURE.stableParameters.scope, referrer: 'grok-build' });
      assert.equal(polls.length, 2, 'one pending poll, then success');
      for (const request of [start, ...polls]) {
        assert.equal(request.headers['x-grok-client-version'], GROK_CLIENT_VERSION);
        assert.equal(request.headers['x-grok-client-surface'], 'ui');
      }
      assert.equal(form(polls[0]).client_id, GROK_CLIENT_ID);
      const credential = await expectStored('device code', exchangedAfter);
      await tui.stop();
      return { summary: 'stored after 1 pending poll', start: describe(start), polls: polls.map(describe), credential };
    });
  } finally {
    await tui.stop();
  }
}
