// /login → Cursor: keychain import, cursor-api-key exchange, and the `cursor-agent login` fallback.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import { describe } from '../lib/context.mjs';
import { cursorApiKey, cursorCredential } from '../lib/fixtures.mjs';
import { reply } from '../lib/peers.mjs';

const lookup = (service) => `find-generic-password -s ${service} -a cursor-user -w`;

export default async function cursorLogin(ctx) {
  const { peers, tui, auth, evidence } = ctx;
  const minted = cursorCredential('minted');
  peers.route('POST api2.cursor.sh/auth/exchange_user_api_key', reply(200, { accessToken: minted.access }));

  // A fresh TUI, /login → Cursor, which runs at once; returns the stored cursor credential.
  const login = async (name) => {
    await auth.clear();
    await tui.start();
    await tui.openLogin('Cursor (The X Subscription)');
    await evidence.text(`${name}-pane.txt`, await tui.waitFor('Logged in to Cursor (The X Subscription). Credentials saved'));
    await tui.stop();
    assert.equal(auth.mode(), '600', `${name}: auth.json mode`);
    return (await auth.read()).cursor;
  };

  try {
    await ctx.step('keychain session', async () => {
      const session = cursorCredential('keychain');
      await ctx.keychain({ 'cursor-access-token': session.access, 'cursor-refresh-token': session.refresh });
      const stored = await login('keychain');
      assert.deepEqual(stored, session, 'keychain session stored as {access, refresh, expires = exp*1000}');
      assert.deepEqual(await ctx.securityCalls(), [lookup('cursor-access-token'), lookup('cursor-refresh-token')]);
      assert.deepEqual(await ctx.agentCalls(), []);
      assert.equal(peers.requests.length, 0, 'keychain import must not call Cursor');
      return { summary: 'session copied, 0 requests', securityArgv: await ctx.securityCalls(), credential: stored };
    });

    await ctx.step('api-key exchange', async () => {
      const apiKey = cursorApiKey();
      await ctx.keychain({ 'cursor-api-key': apiKey });
      const stored = await login('api-key-exchange');
      const exchange = peers.requests.find((r) => r.path === '/auth/exchange_user_api_key');
      assert.ok(exchange, 'no exchange request');
      assert.equal(exchange.headers.authorization, `Bearer ${apiKey}`);
      assert.equal(exchange.body, '{}');
      assert.deepEqual(stored, { type: 'oauth', access: minted.access, refresh: 'cursor-keychain', expires: minted.expires });
      assert.ok(!(await auth.raw()).includes(apiKey), 'auth.json must not hold the API key');
      assert.deepEqual(await ctx.agentCalls(), []);
      // The session lookup misses, so /login mints from the API key.
      assert.deepEqual(await ctx.securityCalls(), [lookup('cursor-access-token'), lookup('cursor-api-key')]);
      return { summary: 'minted via /auth/exchange_user_api_key, key not stored', request: describe(exchange), securityArgv: await ctx.securityCalls(), credential: stored };
    });

    await ctx.step('cursor-agent login', async () => {
      await ctx.keychain({});
      const session = cursorCredential('agent-login');
      await writeFile(ctx.files.sessionAfterLogin, `${session.access}\n`);
      const stored = await login('cursor-agent-login');
      assert.deepEqual(await ctx.agentCalls(), [['login']]);
      // Session miss, API-key miss, `cursor-agent login`, then the keychain is read again.
      assert.deepEqual(await ctx.securityCalls(), [lookup('cursor-access-token'), lookup('cursor-api-key'), lookup('cursor-access-token'), lookup('cursor-refresh-token')]);
      assert.deepEqual(stored, { type: 'oauth', access: session.access, refresh: 'cursor-keychain', expires: session.expires });
      return { summary: 'ran `cursor-agent login`, then read the keychain', agentArgv: await ctx.agentCalls(), securityArgv: await ctx.securityCalls(), credential: stored };
    });
  } finally {
    await tui.stop();
  }
}
