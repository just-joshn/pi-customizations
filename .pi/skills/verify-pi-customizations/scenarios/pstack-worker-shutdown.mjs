import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReceipts } from '../lib/receipts.mjs';
import { createRpcSession } from '../lib/rpc.mjs';
import { lastToolResult, prepareHooksAgentDir, startHooks } from './pstack-hooks-lib.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const scratchDir = mkdtempSync(join(tmpdir(), 'worker-shutdown-'));
const rawDir = join(repoRoot, 'artifacts/user-perspective/pstack-worker-shutdown/raw');
mkdirSync(rawDir, { recursive: true });
const context = { repoRoot, scratchDir, rawDir, startSession: createRpcSession };
let session;
try {
  ({ session } = await startHooks(context, 'shutdown', { agentDir: prepareHooksAgentDir(context, 'agent'), cwd: scratchDir, capturePath: join(rawDir, 'rpc.jsonl'), persistSession: true, env: { PI_PSTACK_WORKER_OWNER: '1' } }));
  await session.prompt('HK_TASK_BG_LONG');
  const task = lastToolResult(session, 'Task')?.details;
  assert.equal(task?.status, 'running');
  const state = await session.state();
  await session.close();
  const transcript = readFileSync(state.sessionFile, 'utf8');
  const evidence = join(rawDir, 'shutdown-transcript.jsonl');
  writeFileSync(evidence, transcript);
  const records = transcript
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.customType === 'pstack-task' && entry.data?.id === task.id);
  assert.equal(records.at(-1)?.data.status, 'interrupted', 'shutdown must persist the terminal status without waiting for a subsequent startup');
  const receipts = createReceipts({ scenario: 'pstack-worker-shutdown', repoRoot, artifactsRoot: join(repoRoot, 'artifacts/user-perspective') });
  receipts.write({
    surfaceId: 'PS-EVT-44',
    package: 'extensions/pi-pstack',
    expected: 'Stops the workers and removes staged dirs',
    observed: `Task ${task.id} began running and its final transcript record is interrupted immediately after real Pi shutdown, without a subsequent startup.`,
    evidence,
  });
  console.log(JSON.stringify({ id: task.id, status: records.at(-1).data.status }));
} finally {
  await session?.close();
  rmSync(scratchDir, { recursive: true, force: true });
}
