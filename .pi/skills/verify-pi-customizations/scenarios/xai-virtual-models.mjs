import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { startResponsesServer } from '../../../../extensions/pi-xai-oauth/test/support/responses-server.ts';
import { offlineEnv, REPO_ROOT, runPi, writeJson, XAI_PACKAGE, XAI_PROVIDER } from './oauth-support/harness.mjs';

const TARGET = 'grok-4.7-build-fast';
const ALIASES = [
  { surfaceId: 'XA-VM-1', id: 'grok-4.7-low-fast', effort: 'low' },
  { surfaceId: 'XA-VM-2', id: 'grok-4.7-medium-fast', effort: 'medium' },
  { surfaceId: 'XA-VM-3', id: 'grok-4.7-high-fast', effort: 'high' },
  { surfaceId: 'XA-VM-4', id: 'grok-4.7-xhigh-fast', effort: 'xhigh' },
];

export default async function xaiVirtualModels(context) {
  const { receipts, log, rawPath } = context;
  const server = await startResponsesServer();
  const agentDir = join(context.scratchDir, 'xai');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ [XAI_PROVIDER]: { type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', expires: Date.UTC(2100, 0, 1) } }), { mode: 0o600 });
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { [XAI_PROVIDER]: { baseUrl: server.baseUrl } } }));
  try {
    for (const alias of ALIASES) {
      const before = server.requests.length;
      const run = await runPi(context.piBin, ['--offline', '--no-extensions', '-e', join(REPO_ROOT, XAI_PACKAGE), '--no-session', '--print', '--model', `${XAI_PROVIDER}/${alias.id}`, 'ping'], {
        agentDir,
        cwd: agentDir,
        env: offlineEnv({ logPath: join(agentDir, `routes-${alias.effort}.log`) }),
      });
      const recorded = server.requests.slice(before);
      const request = recorded[0];
      const capture = { alias: alias.id, target: TARGET, run, requests: recorded.map((item) => ({ path: item.path, headers: item.headers, body: item.body })) };
      writeJson(rawPath(`${alias.surfaceId}.json`), capture);
      receipts.assertVerdict({
        surfaceId: alias.surfaceId,
        package: 'extensions/pi-xai-oauth',
        expected: `Routes to ${TARGET} at ${alias.effort} reasoning`,
        observed: `pi --print --model ${XAI_PROVIDER}/${alias.id} exit=${run.code} stdout=${JSON.stringify(run.stdout.trim())}; body.model=${JSON.stringify(request?.body.model)} body.reasoning=${JSON.stringify(request?.body.reasoning)} x-grok-model-override=${JSON.stringify(request?.headers['x-grok-model-override'])} requests=${recorded.length}`,
        evidence: rawPath(`${alias.surfaceId}.json`),
        check: () => {
          assert.equal(run.code, 0, `run failed: ${run.stderr}`);
          assert.equal(recorded.length, 1, 'the alias did not route exactly one request');
          assert.equal(request?.body.model, TARGET, 'the request did not carry the base model');
          assert.equal(request?.body.reasoning?.effort, alias.effort, 'the request did not carry the alias effort');
          assert.equal(request?.headers['x-grok-model-override'], TARGET);
        },
      });
    }
    log('✓ XA-VM-1 through XA-VM-4 receipts written for the Grok virtual models');
  } finally {
    server.close();
  }
}
