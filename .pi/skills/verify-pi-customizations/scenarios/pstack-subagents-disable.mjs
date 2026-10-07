import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createReceipts } from '../lib/receipts.mjs';
import { createRpcSession } from '../lib/rpc.mjs';
import { notifications, startEnv, writeRaw } from './pstack-env-lib.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const scratchDir = mkdtempSync(join(tmpdir(), 'subagents-disable-'));
const rawDir = join(repoRoot, 'artifacts/user-perspective/pstack-subagents-disable/raw');
mkdirSync(rawDir, { recursive: true });
const context = { repoRoot, scratchDir, rawDir, startSession: createRpcSession };
let session;
try {
  ({ session } = await startEnv(context, 'disable', { settings: { builtInAgents: { rubberDuck: true } } }));
  await session.prompt('/subagents');
  await session.prompt('/subagents rubber-duck off');
  const before = notifications(session).length;
  await session.prompt('/rubber-duck check the plan');
  const notices = notifications(session).slice(before);
  const evidence = writeRaw(context, 'same-session-disable.json', { notices, notifications: notifications(session) });
  assert.ok(
    notices.some((notice) => notice.includes('The rubber-duck agent is not available.')),
    'disabled agent must be unavailable in the same session',
  );
  const receipts = createReceipts({ scenario: 'pstack-subagents-disable', repoRoot, artifactsRoot: join(repoRoot, 'artifacts/user-perspective') });
  receipts.write({
    surfaceId: 'PS-CMD-9',
    package: 'extensions/pi-pstack',
    expected: 'Sends a prompt telling the model to call the rubber-duck agent now',
    observed: `After listing primes the offered-agent cache, /subagents rubber-duck off immediately makes /rubber-duck refuse in the same Pi session with ${JSON.stringify(notices)}.`,
    evidence,
  });
  console.log(JSON.stringify({ sameSessionDisabled: true, notices }));
} finally {
  await session?.close();
  rmSync(scratchDir, { recursive: true, force: true });
}
