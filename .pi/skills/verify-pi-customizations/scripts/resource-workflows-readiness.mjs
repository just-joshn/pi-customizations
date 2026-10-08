import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { attemptPrompt, checkInteraction, makeLocalSession } from '../helpers/resource-workflows-local.mjs';

const repoRoot = process.cwd();
const out = resolve(process.argv[2] ?? 'artifacts/user-perspective/resource-workflows-ready');
mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'resource-workflows-ready-'));
let session;
try {
  const response = await fetch('http://127.0.0.1:50713/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ model: 'default_model', temperature: 0, max_tokens: 32, stream: false, chat_template_kwargs: { enable_thinking: false }, messages: [{ role: 'user', content: 'Reply with LOCAL_MODEL_READY only.' }] }),
  });
  const capability = await response.json();
  writeFileSync(join(out, 'capability.json'), `${JSON.stringify(capability, null, 2)}\n`);
  assert.equal(response.status, 200);
  assert.equal(capability.choices?.[0]?.message?.content, 'LOCAL_MODEL_READY');
  const fixture = makeLocalSession({ root, out, repoRoot });
  session = fixture.session;
  const state = await session.state();
  const error = await attemptPrompt(session, 'Run printf LOCAL_TOOL_READY with the bash tool, then report its output. Do not read other files.');
  const records = [...session.records];
  const interacted = checkInteraction(records, 'LOCAL_TOOL_READY');
  const mutationRejected = !checkInteraction(
    records.filter((record) => record.type !== 'tool_execution_end'),
    'LOCAL_TOOL_READY',
  );
  const status = { piVersion: execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim(), model: state.model, error, interacted, mutationRejected };
  writeFileSync(join(out, 'status.json'), `${JSON.stringify(status, null, 2)}\n`);
  assert.equal(error, null);
  assert.equal(interacted, true);
  assert.equal(mutationRejected, true);
  assert.equal(state.model?.provider, 'local');
  assert.equal(state.model?.baseUrl, 'http://127.0.0.1:50713/v1');
  console.log(JSON.stringify(status));
} finally {
  if (session) await session.close();
  rmSync(root, { recursive: true, force: true });
}
