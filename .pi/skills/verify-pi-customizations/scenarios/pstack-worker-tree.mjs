import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReceipts } from '../lib/receipts.mjs';
import { createRpcSession } from '../lib/rpc.mjs';
import { customEntries, lastToolResult, NAVIGATOR, prepareHooksAgentDir, startHooks, waitFor } from './pstack-hooks-lib.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const scratchDir = mkdtempSync(join(tmpdir(), 'worker-tree-'));
const rawDir = join(repoRoot, 'artifacts/user-perspective/pstack-worker-tree/raw');
mkdirSync(rawDir, { recursive: true });
const context = { repoRoot, scratchDir, rawDir, startSession: createRpcSession };
let session;
try {
  ({ session } = await startHooks(context, 'tree', {
    agentDir: prepareHooksAgentDir(context, 'agent'),
    cwd: scratchDir,
    capturePath: join(rawDir, 'rpc.jsonl'),
    extraExtensions: [NAVIGATOR],
    persistSession: true,
    env: { PI_PSTACK_WORKER_OWNER: '1' },
  }));
  await session.prompt('HK_TASK_BG');
  const task = lastToolResult(session, 'Task')?.details;
  assert.ok(task?.id);
  await waitFor(() => customEntries(session, 'pstack-task').find((entry) => entry.data?.id === task.id && entry.data?.status === 'settled'), { description: 'the original task settles' });
  const target = (await session.send({ type: 'get_fork_messages' })).messages.find((entry) => entry.text === 'HK_TASK_BG')?.entryId;
  assert.ok(target);
  await session.prompt(`/hk-nav ${target}`);
  await session.prompt('HK_TASK_LIST');
  const destination = lastToolResult(session, 'TaskList')?.details?.tasks;
  const evidence = join(rawDir, 'tree-result.json');
  writeFileSync(evidence, JSON.stringify({ task, target, destination, records: customEntries(session, 'pstack-task') }, null, 2));
  assert.ok(Array.isArray(destination));
  assert.equal(
    destination.some((record) => record.id === task.id),
    false,
    'navigation must not re-append a previous branch task to the destination',
  );
  const receipts = createReceipts({ scenario: 'pstack-worker-tree', repoRoot, artifactsRoot: join(repoRoot, 'artifacts/user-perspective') });
  receipts.write({
    surfaceId: 'PS-EVT-43',
    package: 'extensions/pi-pstack',
    expected: 'Restores the task records from the new branch',
    observed: `After navigating before task ${task.id} was created, TaskList excludes it and reports ${destination.length} destination-branch tasks.`,
    evidence,
  });
  console.log(JSON.stringify({ previousTask: task.id, destinationTasks: destination.length }));
} finally {
  await session?.close();
  rmSync(scratchDir, { recursive: true, force: true });
}
