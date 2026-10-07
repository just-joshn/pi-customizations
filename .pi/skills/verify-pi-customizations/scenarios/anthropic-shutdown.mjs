import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReceipts } from '../lib/receipts.mjs';
import { createRpcSession } from '../lib/rpc.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const artifacts = join(root, 'artifacts/user-perspective/f013-shutdown');
mkdirSync(artifacts, { recursive: true });

async function drive(missingHandler) {
  const scratch = mkdtempSync(join(tmpdir(), 'anthropic-shutdown-'));
  const name = missingHandler ? 'missing-handler' : 'intact-handler';
  const resultPath = join(artifacts, `${name}-lifecycle.json`);
  let session;
  try {
    const contextDir = join(scratch, 'context');
    cpSync(join(root, 'extensions/pi-anthropic-oauth/src/context'), contextDir, { recursive: true });
    const guardPath = join(contextDir, 'guard.ts');
    if (missingHandler) {
      const source = readFileSync(guardPath, 'utf8');
      assert.ok(source.includes("  pi.on('session_shutdown', reset);"));
      writeFileSync(guardPath, source.replace("  pi.on('session_shutdown', reset);", ''));
    }
    const fixture = join(scratch, 'probe.js');
    writeFileSync(
      fixture,
      `
import { writeFileSync } from 'node:fs';
import { installContextGuard } from ${JSON.stringify(guardPath)};
export default function(pi) {
  const notices = [];
  const events = [];
  const guard = installContextGuard(pi, { providerId: 'claude-subscription', notify: message => notices.push(message) });
  const model = { id: 'claude-opus-5-5', contextWindow: 200000, maxTokens: 8192 };
  const payload = { model: model.id, messages: [{ role: 'user', content: 'a'.repeat(600000) }, { role: 'user', content: 'keep me' }] };
  pi.on('session_start', () => {
    events.push('session_start');
    guard.fit(payload, model);
    guard.fit(payload, model);
    writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ events, notices }));
  });
  pi.on('session_shutdown', () => {
    events.push('session_shutdown');
    guard.fit(payload, model);
    guard.fit(payload, model);
    writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ events, notices }));
  });
}
`,
    );
    session = createRpcSession({ packagePath: fixture, agentDir: join(scratch, 'agent'), cwd: scratch, capturePath: join(artifacts, `${name}-lifecycle.jsonl`) });
    await session.state();
    const startup = JSON.parse(readFileSync(resultPath, 'utf8'));
    assert.equal(startup.notices.length, 1, 'startup primes the notice deduplication state');
    await session.close();
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    assert.deepEqual(result.events, ['session_start', 'session_shutdown']);
    assert.equal(result.notices.length, missingHandler ? 1 : 2, 'shutdown independently resets notice deduplication');
    return { variant: name, events: result.events, notices: result.notices.length };
  } finally {
    await session?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

const missing = await drive(true);
const intact = await drive(false);
assert.notEqual(missing.notices, intact.notices, 'the drive distinguishes a missing shutdown reset');
const receipts = createReceipts({ scenario: 'anthropic-shutdown', repoRoot: root, artifactsRoot: join(root, 'artifacts/user-perspective') });
receipts.write({
  surfaceId: 'AN-EVT-2',
  package: 'extensions/pi-anthropic-oauth',
  expected: 'Resets guard state',
  observed: `Real Pi startup followed by shutdown only. Intact shutdown reset emits ${intact.notices} trim notices; removing only the shutdown registration emits ${missing.notices}. No intervening startup occurred.`,
  evidence: join(artifacts, 'intact-handler-lifecycle.json'),
  scope: 'behaviour',
});
console.log(JSON.stringify(missing));
console.log(JSON.stringify(intact));
