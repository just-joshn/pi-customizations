import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { startMessagesServer } from '../../../../extensions/pi-anthropic-oauth/test/support/messages-server.ts';
import { frames, textMessage } from '../../../../extensions/pi-anthropic-oauth/test/support/sse.ts';
import { fakeServer, json, sse, stream } from '../../../../extensions/pi-antigravity-oauth/test/fake-server.ts';
import { ANTHROPIC_MODEL, ANTHROPIC_PACKAGE, ANTHROPIC_PROVIDER, ANTIGRAVITY_MODEL, ANTIGRAVITY_PACKAGE, ANTIGRAVITY_PROVIDER, offlineEnv, REPO_ROOT, runPi, writeJson } from './oauth-support/harness.mjs';

const ANTHROPIC_TOKEN_PREFIX = 'https://platform.claude.com';
const GOOGLE_TOKEN_PREFIX = 'https://oauth2.googleapis.com';
const GOOGLE_CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';

async function anthropicRefresh(context) {
  const oldAccess = `sk-ant-oat01-old-${randomUUID()}`;
  const oldRefresh = `old-refresh-${randomUUID()}`;
  const newAccess = `sk-ant-oat01-new-${randomUUID()}`;
  const newRefresh = `new-refresh-${randomUUID()}`;
  const server = await startMessagesServer((res, request) => {
    if (request.body?.grant_type === 'refresh_token') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: newAccess, refresh_token: newRefresh, expires_in: 3600 }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(frames(textMessage('PONG')));
  });
  const agentDir = join(context.scratchDir, 'an-refresh');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ [ANTHROPIC_PROVIDER]: { type: 'oauth', access: oldAccess, refresh: oldRefresh, expires: Date.now() - 60_000 } }), { mode: 0o600 });
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { [ANTHROPIC_PROVIDER]: { baseUrl: server.baseUrl } } }));
  try {
    const run = await runPi(context.piBin, ['--offline', '--no-extensions', '-e', join(REPO_ROOT, ANTHROPIC_PACKAGE), '--no-session', '--print', '--model', `${ANTHROPIC_PROVIDER}/${ANTHROPIC_MODEL}`, 'ping'], {
      agentDir,
      cwd: agentDir,
      env: offlineEnv({ routes: [[ANTHROPIC_TOKEN_PREFIX, server.baseUrl]], logPath: join(agentDir, 'routes.log') }),
    });
    const requests = server.requests.map((request) => ({ headers: request.headers, body: request.body }));
    const tokenRequest = requests.find((request) => request.body?.grant_type === 'refresh_token');
    const messageRequest = requests.find((request) => request.body?.model !== undefined);
    const authAfter = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'));
    return { run, tokenRequest, messageRequest, authAfter, newAccess, newRefresh, oldRefresh };
  } finally {
    await server.close();
  }
}

async function antigravityRefresh(context) {
  const projectId = `proj-${randomUUID()}`;
  const oldRefresh = `old-refresh-${randomUUID()}`;
  const newAccess = `ya29.refreshed-${randomUUID()}`;
  const newRefresh = `rotated-${randomUUID()}`;
  const server = await fakeServer((request, res) => {
    if (request.path === '/token') {
      json(res, 200, { access_token: newAccess, refresh_token: newRefresh, expires_in: 3600 });
      return;
    }
    if (request.path.startsWith('/v1internal:streamGenerateContent')) {
      const events = [{ response: { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 } } }];
      stream(res, sse(events));
      return;
    }
    json(res, 200, {});
  });
  const agentDir = join(context.scratchDir, 'ag-refresh');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ [ANTIGRAVITY_PROVIDER]: { type: 'oauth', access: 'ya29.old', refresh: oldRefresh, expires: Date.now() - 60_000, projectId } }), { mode: 0o600 });
  try {
    const run = await runPi(context.piBin, ['--offline', '--no-extensions', '-e', join(REPO_ROOT, ANTIGRAVITY_PACKAGE), '--no-session', '--print', '--model', `${ANTIGRAVITY_PROVIDER}/${ANTIGRAVITY_MODEL}`, 'ping'], {
      agentDir,
      cwd: agentDir,
      env: { ...offlineEnv({ routes: [[GOOGLE_TOKEN_PREFIX, server.url]], logPath: join(agentDir, 'routes.log') }), CLOUD_CODE_URL: server.url },
    });
    const tokenRequest = server.requests.find((request) => request.path === '/token');
    const streamRequest = server.requests.find((request) => request.path.startsWith('/v1internal:streamGenerateContent'));
    const authAfter = JSON.parse(await readFile(join(agentDir, 'auth.json'), 'utf8'));
    return { run, tokenRequest, streamRequest, authAfter, newAccess, newRefresh, oldRefresh, projectId };
  } finally {
    server.close();
  }
}

function recordAnthropicRefresh(context, receipts, anthropic) {
  const { rawPath } = context;
  writeJson(rawPath('AN-CRED-1.json'), anthropic);
  receipts.assertVerdict({
    surfaceId: 'AN-CRED-1',
    package: ANTHROPIC_PACKAGE,
    expected: 'Token refresh via OAuth refresh; requests identify as Provider CLI',
    observed: `POST /v1/oauth/token body=${JSON.stringify(anthropic.tokenRequest?.body ?? null)}; /v1/messages authorization=${JSON.stringify(anthropic.messageRequest?.headers.authorization)} user-agent=${JSON.stringify(anthropic.messageRequest?.headers['user-agent'])}; auth.json after=${JSON.stringify(anthropic.authAfter[ANTHROPIC_PROVIDER])}`,
    evidence: rawPath('AN-CRED-1.json'),
    check: () => {
      assert.equal(anthropic.run.code, 0, `refresh run failed: ${anthropic.run.stderr}`);
      assert.equal(anthropic.tokenRequest?.body.grant_type, 'refresh_token');
      assert.equal(anthropic.tokenRequest?.body.refresh_token, anthropic.oldRefresh);
      assert.ok(typeof anthropic.tokenRequest?.body.client_id === 'string' && anthropic.tokenRequest.body.client_id.length > 0, 'token request carried no client_id');
      assert.equal(anthropic.messageRequest?.headers.authorization, `Bearer ${anthropic.newAccess}`, 'the model request did not use the refreshed access token');
      assert.equal(anthropic.messageRequest?.headers['user-agent'], 'claude-cli/2.1.288 (external, sdk-cli)');
      const credential = anthropic.authAfter[ANTHROPIC_PROVIDER];
      assert.equal(credential?.access, anthropic.newAccess, 'stored access token was not rotated');
      assert.equal(credential?.refresh, anthropic.newRefresh, 'stored refresh token was not rotated');
      assert.ok(credential?.expires > Date.now(), 'stored credential is still expired');
    },
  });
}

function recordAntigravityRefresh(context, receipts, antigravity) {
  const { rawPath } = context;
  writeJson(rawPath('AG-CRED-1.json'), antigravity);
  receipts.assertVerdict({
    surfaceId: 'AG-CRED-1',
    package: ANTIGRAVITY_PACKAGE,
    expected: 'OAuth credential with access token and project id',
    observed: `POST /token form=${JSON.stringify(antigravity.tokenRequest?.body ?? null)}; stream authorization=${JSON.stringify(antigravity.streamRequest?.headers.authorization)} body.project=${JSON.stringify(JSON.parse(antigravity.streamRequest?.body ?? '{}').project)}; auth.json after=${JSON.stringify(antigravity.authAfter[ANTIGRAVITY_PROVIDER])}`,
    evidence: rawPath('AG-CRED-1.json'),
    check: () => {
      assert.equal(antigravity.run.code, 0, `refresh run failed: ${antigravity.run.stderr}`);
      const form = new URLSearchParams(antigravity.tokenRequest?.body ?? '');
      assert.equal(form.get('grant_type'), 'refresh_token');
      assert.equal(form.get('refresh_token'), antigravity.oldRefresh);
      assert.equal(form.get('client_id'), GOOGLE_CLIENT_ID);
      assert.equal(antigravity.streamRequest?.headers.authorization, `Bearer ${antigravity.newAccess}`);
      assert.equal(JSON.parse(antigravity.streamRequest?.body ?? '{}').project, antigravity.projectId);
      const credential = antigravity.authAfter[ANTIGRAVITY_PROVIDER];
      assert.equal(credential?.access, antigravity.newAccess, 'stored access token was not rotated');
      assert.equal(credential?.refresh, antigravity.newRefresh, 'stored refresh token was not rotated');
      assert.equal(credential?.projectId, antigravity.projectId, 'stored project id was lost');
      assert.ok(credential?.expires > Date.now(), 'stored credential is still expired');
    },
  });
}

export default async function oauthTokenRefresh(context) {
  const { receipts, log } = context;
  recordAnthropicRefresh(context, receipts, await anthropicRefresh(context));
  recordAntigravityRefresh(context, receipts, await antigravityRefresh(context));
  log('✓ AN-CRED-1 and AG-CRED-1 receipts written after loopback token refresh');
}
