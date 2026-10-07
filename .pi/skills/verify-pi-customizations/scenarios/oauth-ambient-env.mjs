import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sseReply, startMessagesServer } from '../../../../extensions/pi-anthropic-oauth/test/support/messages-server.ts';
import { textMessage } from '../../../../extensions/pi-anthropic-oauth/test/support/sse.ts';
import { fakeServer, json, sse, stream } from '../../../../extensions/pi-antigravity-oauth/test/fake-server.ts';
import { ANTHROPIC_MODEL, ANTHROPIC_PACKAGE, ANTHROPIC_PROVIDER, ANTIGRAVITY_MODEL, ANTIGRAVITY_PACKAGE, ANTIGRAVITY_PROVIDER, offlineEnv, REPO_ROOT, readText, runPi, writeJson } from './oauth-support/harness.mjs';

async function anthropicRun(context, server, label, { env, credential }) {
  const agentDir = join(context.scratchDir, `an-${label}`);
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { [ANTHROPIC_PROVIDER]: { baseUrl: server.baseUrl } } }));
  if (credential) await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ [ANTHROPIC_PROVIDER]: credential }), { mode: 0o600 });
  const before = server.requests.length;
  const run = await runPi(context.piBin, ['--offline', '--no-extensions', '-e', join(REPO_ROOT, ANTHROPIC_PACKAGE), '--no-session', '--print', '--model', `${ANTHROPIC_PROVIDER}/${ANTHROPIC_MODEL}`, 'ping'], {
    agentDir,
    cwd: agentDir,
    env: { ...offlineEnv({ logPath: join(agentDir, 'routes.log') }), ...env },
  });
  const authPath = join(agentDir, 'auth.json');
  return {
    env: Object.keys(env),
    run,
    requests: server.requests.slice(before).map((request) => ({ authorization: request.headers.authorization, body: request.body })),
    authJsonAfter: existsSync(authPath) ? readText(authPath).trim() : null,
  };
}

async function antigravityRun(context, server, label, { env, credential, strict = true }) {
  const agentDir = join(context.scratchDir, `ag-${label}`);
  await mkdir(agentDir, { recursive: true });
  if (credential) await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ [ANTIGRAVITY_PROVIDER]: credential }), { mode: 0o600 });
  const before = server.requests.length;
  const run = await runPi(context.piBin, ['--offline', '--no-extensions', '-e', join(REPO_ROOT, ANTIGRAVITY_PACKAGE), '--no-session', '--print', '--model', `${ANTIGRAVITY_PROVIDER}/${ANTIGRAVITY_MODEL}`, 'ping'], {
    agentDir,
    cwd: agentDir,
    env: { ...offlineEnv({ logPath: join(agentDir, 'routes.log'), strict }), ...env },
  });
  return { env, run, requests: server.requests.slice(before).map((request) => ({ path: request.path, authorization: request.headers.authorization, body: request.body })) };
}

function authorizationOf(requests) {
  return requests.map((request) => request.authorization);
}

function cloudRequests(requests) {
  return requests.filter((request) => request.path.startsWith('/v1internal:streamGenerateContent'));
}

async function recordAnEnv1(context, receipts, messages) {
  const { rawPath } = context;
  const token = `sk-ant-oat01-${randomUUID()}`;
  const stored = { type: 'oauth', access: `sk-ant-oat01-stored-${randomUUID()}`, refresh: `refresh-${randomUUID()}`, expires: Date.UTC(2100, 0, 1) };
  const apiKey = `sk-ant-api03-${randomUUID()}`;
  const runs = {
    accepted: await anthropicRun(context, messages, 'env1-accepted', { env: { CLAUDE_CODE_OAUTH_TOKEN: token } }),
    malformed: await anthropicRun(context, messages, 'env1-malformed', { env: { CLAUDE_CODE_OAUTH_TOKEN: apiKey } }),
    stored: await anthropicRun(context, messages, 'env1-stored', { env: { CLAUDE_CODE_OAUTH_TOKEN: `sk-ant-oat01-${randomUUID()}` }, credential: stored }),
  };
  writeJson(rawPath('AN-ENV-1.json'), runs);
  receipts.assertVerdict({
    surfaceId: 'AN-ENV-1',
    package: ANTHROPIC_PACKAGE,
    expected: 'Used as subscription token if no stored credential',
    observed: `no stored credential: authorization=${authorizationOf(runs.accepted.requests).join(',')} and auth.json=${runs.accepted.authJsonAfter ?? 'absent'}; malformed rejected exit=${runs.malformed.run.code} stderr=${JSON.stringify(runs.malformed.run.stderr.trim())} with ${runs.malformed.requests.length} requests; stored credential won: authorization=${authorizationOf(runs.stored.requests).join(',')}`,
    evidence: rawPath('AN-ENV-1.json'),
    check: () => {
      assert.equal(runs.accepted.run.code, 0, 'ambient token run failed');
      assert.deepEqual(authorizationOf(runs.accepted.requests), [`Bearer ${token}`]);
      assert.equal(runs.accepted.authJsonAfter, '{}', 'ambient token run changed the credential store');
      assert.notEqual(runs.malformed.run.code, 0, 'malformed token was accepted');
      assert.match(runs.malformed.run.stderr, /CLAUDE_CODE_OAUTH_TOKEN must contain a Claude OAuth access token, not an API key\./);
      assert.equal(runs.malformed.requests.length, 0, 'malformed token still issued a request');
      assert.deepEqual(authorizationOf(runs.stored.requests), [`Bearer ${stored.access}`]);
    },
  });
}

async function recordAnEnv2(context, receipts, messages) {
  const { rawPath } = context;
  const token = `sk-ant-oat01-${randomUUID()}`;
  const high = `sk-ant-oat01-${randomUUID()}`;
  const apiKey = `sk-ant-api03-${randomUUID()}`;
  const runs = {
    accepted: await anthropicRun(context, messages, 'env2-accepted', { env: { ANTHROPIC_OAUTH_TOKEN: token } }),
    precedence: await anthropicRun(context, messages, 'env2-precedence', { env: { CLAUDE_CODE_OAUTH_TOKEN: high, ANTHROPIC_OAUTH_TOKEN: `sk-ant-oat01-${randomUUID()}` } }),
    malformed: await anthropicRun(context, messages, 'env2-malformed', { env: { ANTHROPIC_OAUTH_TOKEN: apiKey } }),
  };
  writeJson(rawPath('AN-ENV-2.json'), runs);
  receipts.assertVerdict({
    surfaceId: 'AN-ENV-2',
    package: ANTHROPIC_PACKAGE,
    expected: 'Fallback token source',
    observed: `with only ANTHROPIC_OAUTH_TOKEN set: authorization=${authorizationOf(runs.accepted.requests).join(',')}; with CLAUDE_CODE_OAUTH_TOKEN also set: authorization=${authorizationOf(runs.precedence.requests).join(',')}; malformed rejected exit=${runs.malformed.run.code} stderr=${JSON.stringify(runs.malformed.run.stderr.trim())}`,
    evidence: rawPath('AN-ENV-2.json'),
    check: () => {
      assert.deepEqual(authorizationOf(runs.accepted.requests), [`Bearer ${token}`]);
      assert.deepEqual(authorizationOf(runs.precedence.requests), [`Bearer ${high}`], 'CLAUDE_CODE_OAUTH_TOKEN must outrank ANTHROPIC_OAUTH_TOKEN');
      assert.notEqual(runs.malformed.run.code, 0);
      assert.match(runs.malformed.run.stderr, /ANTHROPIC_OAUTH_TOKEN must contain a Claude OAuth access token, not an API key\./);
      assert.equal(runs.malformed.requests.length, 0);
    },
  });
}

async function recordAnEnv3(context, receipts, messages) {
  const { rawPath } = context;
  const token = `sk-ant-oat01-${randomUUID()}`;
  const higher = `sk-ant-oat01-${randomUUID()}`;
  const apiKey = `sk-ant-api03-${randomUUID()}`;
  const runs = {
    accepted: await anthropicRun(context, messages, 'env3-accepted', { env: { ANTHROPIC_AUTH_TOKEN: token } }),
    precedence: await anthropicRun(context, messages, 'env3-precedence', { env: { ANTHROPIC_OAUTH_TOKEN: higher, ANTHROPIC_AUTH_TOKEN: `sk-ant-oat01-${randomUUID()}` } }),
    malformed: await anthropicRun(context, messages, 'env3-malformed', { env: { ANTHROPIC_AUTH_TOKEN: apiKey } }),
  };
  writeJson(rawPath('AN-ENV-3.json'), runs);
  receipts.assertVerdict({
    surfaceId: 'AN-ENV-3',
    package: ANTHROPIC_PACKAGE,
    expected: 'Fallback token source; must match sk-ant-oat01 shape',
    observed: `with only ANTHROPIC_AUTH_TOKEN set: authorization=${authorizationOf(runs.accepted.requests).join(',')}; with ANTHROPIC_OAUTH_TOKEN also set: authorization=${authorizationOf(runs.precedence.requests).join(',')}; API-key shape rejected exit=${runs.malformed.run.code} stderr=${JSON.stringify(runs.malformed.run.stderr.trim())}`,
    evidence: rawPath('AN-ENV-3.json'),
    check: () => {
      assert.deepEqual(authorizationOf(runs.accepted.requests), [`Bearer ${token}`]);
      assert.deepEqual(authorizationOf(runs.precedence.requests), [`Bearer ${higher}`], 'ANTHROPIC_OAUTH_TOKEN must outrank ANTHROPIC_AUTH_TOKEN');
      assert.notEqual(runs.malformed.run.code, 0);
      assert.match(runs.malformed.run.stderr, /ANTHROPIC_AUTH_TOKEN must contain a Claude OAuth access token, not an API key\./);
      assert.equal(runs.malformed.requests.length, 0);
    },
  });
}

async function recordAgEnv1(context, receipts, cloud) {
  const { rawPath } = context;
  const fixture = { type: 'oauth', access: `ya29.fixture-${randomUUID()}`, refresh: `1//fixture-${randomUUID()}`, expires: Date.UTC(2100, 0, 1), projectId: 'fixture-project' };
  const runs = {
    accepted: await antigravityRun(context, cloud, 'env-accepted', { env: { CLOUD_CODE_URL: cloud.url }, credential: fixture }),
    malformed: await antigravityRun(context, cloud, 'env-malformed', { env: { CLOUD_CODE_URL: 'http://[::1' }, credential: fixture, strict: false }),
  };
  writeJson(rawPath('AG-ENV-1.json'), runs);
  receipts.assertVerdict({
    surfaceId: 'AG-ENV-1',
    package: ANTIGRAVITY_PACKAGE,
    expected: 'Overrides Cloud Code Assist base URL',
    observed: `CLOUD_CODE_URL=${cloud.url}: ${cloudRequests(runs.accepted.requests).length} streamGenerateContent request(s) arrived at the loopback server with authorization=${cloudRequests(runs.accepted.requests)[0]?.authorization}; CLOUD_CODE_URL=http://[::1 rejected exit=${runs.malformed.run.code} stderr=${JSON.stringify(runs.malformed.run.stderr.trim())} with ${cloudRequests(runs.malformed.requests).length} request(s) reaching the default endpoint`,
    evidence: rawPath('AG-ENV-1.json'),
    check: () => {
      assert.equal(runs.accepted.run.code, 0, 'accepted CLOUD_CODE_URL run failed');
      assert.equal(cloudRequests(runs.accepted.requests).length, 1);
      assert.equal(cloudRequests(runs.accepted.requests)[0]?.authorization, `Bearer ${fixture.access}`);
      assert.notEqual(runs.malformed.run.code, 0, 'malformed base URL was accepted');
      assert.match(runs.malformed.run.stderr, /Failed to parse URL from http:\/\/\[::1\/v1internal:streamGenerateContent/);
      assert.equal(cloudRequests(runs.malformed.requests).length, 0);
    },
  });
}

export default async function oauthAmbientEnv(context) {
  const { receipts, log } = context;
  const messages = await startMessagesServer(sseReply(textMessage('PONG')));
  const cloud = await fakeServer((request, res) => {
    if (request.path.startsWith('/v1internal:streamGenerateContent')) {
      stream(res, sse([{ response: { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1, totalTokenCount: 6 } } }]));
      return;
    }
    json(res, 200, {});
  });
  try {
    await recordAnEnv1(context, receipts, messages);
    await recordAnEnv2(context, receipts, messages);
    await recordAnEnv3(context, receipts, messages);
    await recordAgEnv1(context, receipts, cloud);
    log('✓ AN-ENV-1, AN-ENV-2, AN-ENV-3 and AG-ENV-1 receipts written');
  } finally {
    await messages.close();
    cloud.close();
  }
}
