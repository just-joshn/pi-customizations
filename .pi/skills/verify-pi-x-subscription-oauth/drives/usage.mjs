// /usage: logged out, the weekly meter, a rejected session, and the TUI notification.
import assert from 'node:assert/strict';

import { describe } from '../lib/context.mjs';
import { BILLING_FIXTURE, GROK_CLIENT_VERSION, grokCredential } from '../lib/fixtures.mjs';
import { queue, reply } from '../lib/peers.mjs';

export default async function usage(ctx) {
  const { peers, tui } = ctx;
  // Dates relative to now, so "resets in" is predictable: the period ends 5d 3h from now.
  const now = Date.now();
  const billing = structuredClone(BILLING_FIXTURE);
  billing.config.currentPeriod.start = new Date(now - 2 * 86_400_000).toISOString();
  billing.config.currentPeriod.end = new Date(now + 5 * 86_400_000 + 3 * 3_600_000).toISOString();
  peers.route('GET cli-chat-proxy.grok.com/v1/billing', queue(reply(200, billing), reply(401, { error: 'unauthorized' }), reply(200, billing)));
  const cred = grokCredential('usage');

  // Print mode reports /usage on stderr; stdout stays empty.
  const printUsage = async () => {
    const result = await ctx.pi(['--offline', '-p', '/usage']);
    assert.equal(result.stdout, '', '/usage writes nothing to stdout');
    return result;
  };

  await ctx.step('logged out', async () => {
    const result = await printUsage();
    assert.match(result.stderr, /Grok Build is not logged in\. Run \/login and choose Grok Build\./);
    assert.equal(peers.requests.length, 0);
    return { summary: 'not-logged-in error, 0 requests', stderr: result.stderr };
  });

  await ctx.auth.write({ 'grok-build': cred });
  await ctx.step('meter', async () => {
    const result = await printUsage();
    const request = peers.requests.at(-1);
    assert.equal(`${request.path}${request.query}`, '/v1/billing?format=credits');
    assert.equal(request.headers.authorization, `Bearer ${cred.access}`);
    assert.equal(request.headers['x-xai-token-auth'], 'xai-grok-cli');
    assert.equal(request.headers['x-grok-client-version'], GROK_CLIENT_VERSION);
    assert.match(result.stderr, new RegExp(`Weekly ${billing.config.currentPeriod.start} to ${billing.config.currentPeriod.end}: 17% used, 83% left, resets in 5d (2h 59m|3h 0m)`));
    assert.match(result.stderr, /GrokBuild: 15%\nCursor: 2%\nPrepaid: 0\nUnified: yes/);
    return { summary: result.stderr.trim().split('\n')[0], stderr: result.stderr, request: describe(request) };
  });

  await ctx.step('rejected session', async () => {
    const result = await printUsage();
    assert.match(result.stderr, /Grok Build rejected the session \(HTTP 401\)\. Run \/login and choose Grok Build\./);
    return { summary: 'HTTP 401 → run /login', stderr: result.stderr };
  });

  await ctx.step('TUI notification', async () => {
    try {
      await tui.start();
      tui.type('/usage');
      tui.keys('Enter');
      const shown = await tui.waitFor('GrokBuild: 15%');
      await ctx.evidence.text('tui-usage.txt', shown);
      assert.match(shown, /17% used, 83% left/);
    } finally {
      await tui.stop();
    }
    assert.deepEqual(
      peers.requests.map((r) => `${r.method} ${r.path}${r.query}`),
      Array(3).fill('GET /v1/billing?format=credits'),
      'meter, 401, and TUI each made one billing call',
    );
    return { summary: 'notification shows the meter', requests: peers.requests.map(describe) };
  });
}
