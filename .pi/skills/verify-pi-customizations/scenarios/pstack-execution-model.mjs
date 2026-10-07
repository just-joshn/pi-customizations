import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRpcSession } from '../lib/rpc.mjs';
import { startEnv, toolResult, writeRaw } from './pstack-env-lib.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const scratchDir = mkdtempSync(join(tmpdir(), 'execution-model-'));
const rawDir = join(repoRoot, 'artifacts/user-perspective/f019-model/raw');
mkdirSync(rawDir, { recursive: true });
const context = { repoRoot, scratchDir, rawDir, startSession: createRpcSession };
let session;
try {
  ({ session } = await startEnv(context, 'invalid-model', { env: { COPILOT_CLI_ENABLED_FEATURE_FLAGS: 'copilot_cli_execution_subagent,copilot_cli_execution_subagent_model', EXECUTION_SUBAGENT_MODEL: 'missing/none' } }));
  await session.prompt('ENV_EXEC_MODEL');
  const result = toolResult(session, 'execution_subagent');
  writeRaw(context, 'invalid-model-result.json', result);
  assert.equal(result.isError, true, 'an unavailable explicit model must produce an error, not run on another model');
  assert.match(result.text, /missing\/none/);
  console.log(JSON.stringify(result));
} finally {
  await session?.close();
  rmSync(scratchDir, { recursive: true, force: true });
}
