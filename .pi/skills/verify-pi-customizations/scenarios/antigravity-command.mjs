import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fakeServer, json, sse, stream } from '../../../../extensions/pi-antigravity-oauth/test/fake-server.ts';
import { ANTIGRAVITY_PACKAGE, ANTIGRAVITY_PROVIDER, offlineEnv, startRpc, writeJson } from './oauth-support/harness.mjs';

const NOT_LOGGED_IN = 'Google Antigravity is not logged in. Run /login and choose Google Antigravity.';

async function startCloudCode() {
  return fakeServer((request, res) => {
    if (request.path === '/oauth2/v2/userinfo') {
      json(res, 200, { email: 'dev@example.com' });
      return;
    }
    if (request.path.startsWith('/v1internal:loadCodeAssist')) {
      json(res, 200, { currentTier: { id: 'free-tier', name: 'Free' }, paidTier: { id: 'g1-pro-tier', name: 'Google AI Pro' } });
      return;
    }
    if (request.path.startsWith('/v1internal:retrieveUserQuotaSummary')) {
      json(res, 200, { groups: [{ displayName: 'Gemini Models', buckets: [{ displayName: 'Weekly Limit Remaining', remainingFraction: 0.8, resetTime: '2026-01-05T00:00:00Z' }] }] });
      return;
    }
    if (request.path.startsWith('/v1internal:streamGenerateContent')) {
      stream(res, sse([{ response: { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 } } }]));
      return;
    }
    json(res, 200, {});
  });
}

async function commandRun(context, name, server, credential) {
  const agentDir = join(context.scratchDir, name);
  await mkdir(agentDir, { recursive: true });
  if (credential) await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ [ANTIGRAVITY_PROVIDER]: credential }), { mode: 0o600 });
  const before = server.requests.length;
  const session = startRpc(context, {
    packagePath: ANTIGRAVITY_PACKAGE,
    agentDir,
    captureName: `${name}.jsonl`,
    env: { ...offlineEnv({ routes: [['https://www.googleapis.com', server.url]], logPath: join(agentDir, 'routes.log') }), CLOUD_CODE_URL: server.url },
  });
  try {
    const disposition = await session.prompt('/antigravity');
    return {
      disposition: disposition?.disposition,
      notifications: session.notifications.map((record) => ({ message: record.message, notifyType: record.notifyType })),
      requests: server.requests.slice(before).map((request) => ({ path: request.path, body: request.body })),
    };
  } finally {
    await session.close();
  }
}

export default async function antigravityCommand(context) {
  const { receipts, log, rawPath } = context;
  const server = await startCloudCode();
  const credential = { type: 'oauth', access: 'ya29.fixture-access', refresh: '1//fixture-refresh', expires: Date.UTC(2100, 0, 1), projectId: 'proj-9', email: 'dev@example.com' };
  try {
    const anonymous = await commandRun(context, 'ag-anonymous', server, null);
    const signedIn = await commandRun(context, 'ag-signed-in', server, credential);
    writeJson(rawPath('AG-CMD-1.json'), { anonymous, signedIn });

    const info = signedIn.notifications.find((record) => record.notifyType === 'info');
    receipts.assertVerdict({
      surfaceId: 'AG-CMD-1',
      package: ANTIGRAVITY_PACKAGE,
      expected: 'Prints account email, project, tier and quota; error if not logged in',
      observed: `signed in: ${JSON.stringify(info?.message)}; not logged in: ${JSON.stringify(anonymous.notifications[0]?.message)}; quota request body=${JSON.stringify(signedIn.requests.find((request) => request.path.startsWith('/v1internal:retrieveUserQuotaSummary'))?.body)}`,
      evidence: rawPath('AG-CMD-1.json'),
      check: () => {
        assert.equal(anonymous.disposition, 'handled');
        assert.deepEqual(anonymous.notifications, [{ message: NOT_LOGGED_IN, notifyType: 'error' }]);
        assert.equal(anonymous.requests.length, 0, 'the anonymous command still called Cloud Code');
        assert.ok(info, `no info notification for the signed-in command: ${JSON.stringify(signedIn.notifications)}`);
        assert.match(info.message, /^Account: dev@example\.com\nProject: proj-9\nTier: Google AI Pro \(g1-pro-tier\)\nQuota:\n/);
        assert.match(info.message, /Weekly Limit Remaining: 80% left/);
        assert.equal(signedIn.requests.find((request) => request.path.startsWith('/v1internal:retrieveUserQuotaSummary'))?.body, '{"project":"proj-9"}');
        assert.equal(signedIn.requests.find((request) => request.path.startsWith('/v1internal:loadCodeAssist'))?.body, '{"metadata":{"ideType":"ANTIGRAVITY"}}');
      },
    });

    writeJson(rawPath('AG-UI-1.json'), { anonymous: anonymous.notifications, signedIn: signedIn.notifications });
    receipts.assertVerdict({
      surfaceId: 'AG-UI-1',
      package: ANTIGRAVITY_PACKAGE,
      expected: 'Info or error notice',
      observed: `anonymous notifyType=${JSON.stringify(anonymous.notifications[0]?.notifyType)} message=${JSON.stringify(anonymous.notifications[0]?.message)}; signed in notifyType=${JSON.stringify(info?.notifyType)} message starts ${JSON.stringify(info?.message.slice(0, 24))}`,
      evidence: rawPath('AG-UI-1.json'),
      check: () => {
        assert.equal(anonymous.notifications.length, 1);
        assert.equal(anonymous.notifications[0]?.notifyType, 'error');
        assert.equal(anonymous.notifications[0]?.message, NOT_LOGGED_IN);
        assert.equal(info?.notifyType, 'info');
        assert.match(info?.message ?? '', /^Account: /);
      },
    });

    log('✓ AG-CMD-1 and AG-UI-1 receipts written for /antigravity');
  } finally {
    server.close();
  }
}
