import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { type DetachedRpcHandle, startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { promptAndSettle } from '../scripts/rpc-turn.mjs';
import { fixture, packageRoot } from './session-fixture.ts';

async function run(handle: DetachedRpcHandle, message: string) {
  const settlements = () =>
    readFileSync(join(handle.directory, 'events.jsonl'), 'utf8')
      .split('\n')
      .slice(0, -1)
      .filter((line) => JSON.parse(line).type === 'agent_settled').length;
  await promptAndSettle(
    async (command) => {
      const response = await handle.send({ type: 'prompt', message: command.message });
      expect(response.success).toBe(true);
      return response;
    },
    settlements,
    { type: 'prompt', message },
    10000,
  );
}

async function accounting(handle: DetachedRpcHandle, tokens: number, cost: number) {
  const response = await handle.send({ type: 'get_session_stats' });
  if (!response.success || response.command !== 'get_session_stats') throw new Error('RPC accounting response failed');
  expect(response.data.tokens.total).toBe(tokens);
  expect(response.data.cost).toBeCloseTo(cost);
}

test('installed RPC preserves synthetic nonzero usage after goal completion and reopening', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const provider = join(f.root, 'usage-provider.mjs');
    await writeFile(provider, `import journey from ${JSON.stringify(join(packageRoot, 'test/journey-provider.ts'))};\nprocess.env = { ...process.env, PSTACK_JOURNEY_NONZERO_USAGE: '1' };\nexport default journey;\n`);
    const options = { directory: join(f.root, 'transport'), cwd: f.cwd, agentDir: join(f.root, 'agent') };
    const args = ['--approve', '--no-extensions', '--no-skills', '--no-prompt-templates', '-e', join(packageRoot, 'src/index.ts'), '-e', provider, '--provider', 'journey-test', '--model', 'recorder'];
    const first = await startDetachedRpc({ ...options, args });
    let sessionFile: string;
    try {
      await run(first, 'Synthetic accounting baseline');
      await accounting(first, 10, 0.1);
      await run(first, 'JOURNEY:goalcycle');
      await accounting(first, 30, 0.3);
      const entries = await first.send({ type: 'get_entries' });
      if (!entries.success || entries.command !== 'get_entries') throw new Error('RPC entries response failed');
      const goal = entries.data.entries.findLast((entry) => entry.type === 'custom' && entry.customType === 'pstack-goal');
      expect(goal?.type === 'custom' ? goal.data : undefined).toEqual({ objective: 'Verify every capability without subagents', status: 'complete' });
      const state = await first.send({ type: 'get_state' });
      if (!state.success || state.command !== 'get_state' || !state.data.sessionFile) throw new Error('RPC session file missing');
      sessionFile = state.data.sessionFile;
    } finally {
      await first.close();
    }
    const reopened = await startDetachedRpc({ ...options, args: [...args, '--session', sessionFile] });
    try {
      await accounting(reopened, 30, 0.3);
    } finally {
      await reopened.close();
    }
  } finally {
    await f.close();
  }
}, 30000);
