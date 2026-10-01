import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { fixture, packageRoot } from './session-fixture.ts';

test('real RPC context discovers the configured session directory and returns only its workspace', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const directory = join(f.root, 'custom-sessions');
    const handle = await startDetachedRpc({
      directory: join(f.root, 'transport'),
      cwd: f.cwd,
      agentDir: join(f.root, 'real-agent'),
      args: [
        '--approve',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--session-dir',
        directory,
        '-e',
        join(packageRoot, 'src/index.ts'),
        '-e',
        join(packageRoot, 'test/journey-provider.ts'),
        '--provider',
        'journey-test',
        '--model',
        'recorder',
      ],
    });
    try {
      const state = await handle.send({ type: 'get_state' });
      if (!state.success || state.command !== 'get_state' || !state.data.sessionFile) throw new Error('missing current session file');
      const file = state.data.sessionFile;
      await writeFile(join(directory, 'other.jsonl'), `${JSON.stringify({ type: 'session', version: 3, id: 'foreign-workspace', timestamp: '2026-10-01T00:00:00.000Z', cwd: join(f.root, 'other-workspace') })}\n`);
      const response = await handle.send({ type: 'prompt', message: 'JOURNEY:history' });
      expect(response.success).toBe(true);
      await vi.waitFor(async () => {
        const entries = await handle.send({ type: 'get_entries' });
        if (!entries.success || entries.command !== 'get_entries') throw new Error('missing RPC entries');
        const result = entries.data.entries.findLast((entry) => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'pstack_context');
        const details = result?.type === 'message' && result.message.role === 'toolResult' ? result.message.details : undefined;
        expect(details).toMatchObject({ history: [{ path: file }], omitted: { history: 0 }, historyDiscovery: { mode: 'best-effort', completeness: 'unknown' } });
        expect(JSON.stringify(details)).not.toContain('foreign-workspace');
      });
    } finally {
      await handle.close();
    }
  } finally {
    await f.close();
  }
}, 30000);
