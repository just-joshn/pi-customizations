import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { cloudFilesystem } from '../src/cloud-filesystem.ts';

test('cloud visibility includes global, custom and orchestration stores but allows only owned paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-cloud-policy-'));
  const agent = join(root, 'agent');
  const sessions = join(root, 'custom-sessions');
  const own = join(sessions, 'task-one');
  const workspace = join(root, 'workspace');
  const orchestration = join(root, 'orchestration');
  vi.stubEnv('PI_CODING_AGENT_DIR', agent);
  vi.stubEnv('ORCH_STORE', orchestration);
  try {
    await Promise.all([mkdir(own, { recursive: true }), mkdir(workspace)]);
    expect(await cloudFilesystem(sessions, own, workspace)).toEqual({ denied: [await realpath(sessions), await realpath(join(agent, 'sessions')), await realpath(orchestration)], allowed: [await realpath(own), await realpath(workspace)] });
    const legacy = join(sessions, 'legacy.jsonl');
    await writeFile(legacy, 'legacy fixture');
    expect((await cloudFilesystem(sessions, own, workspace, legacy)).files).toEqual([await realpath(legacy)]);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'darwin')(
  'real idle transport applies the cloud visibility policy without exposing siblings on legacy resume',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pstack-cloud-policy-rpc-'));
    const sessions = join(root, 'sessions');
    const own = join(sessions, 'task-one');
    const workspace = join(root, 'workspace');
    vi.stubEnv('PI_CODING_AGENT_DIR', join(root, 'agent'));
    vi.stubEnv('ORCH_STORE', join(root, 'orchestration'));
    try {
      await Promise.all([mkdir(own, { recursive: true }), mkdir(workspace)]);
      const legacy = join(sessions, 'legacy.jsonl');
      const sibling = join(sessions, 'sibling.jsonl');
      await Promise.all([writeFile(legacy, 'legacy fixture'), writeFile(sibling, 'sibling fixture')]);
      const filesystem = await cloudFilesystem(sessions, own, workspace, legacy);
      const global = join(root, 'agent/sessions/private.txt');
      const orchestration = join(root, 'orchestration/private.txt');
      const repo = join(workspace, 'README.md');
      await Promise.all([writeFile(global, 'global fixture'), writeFile(orchestration, 'orchestration fixture'), writeFile(repo, 'repo fixture')]);
      const handle = await startDetachedRpc({ directory: own, cwd: workspace, agentDir: join(root, 'agent'), args: ['--no-session', '--no-extensions'], filesystem });
      try {
        for (const [path, output] of [
          [legacy, 'readable'],
          [sibling, 'blocked'],
          [global, 'blocked'],
          [orchestration, 'blocked'],
          [repo, 'readable'],
        ] as const) {
          expect(await handle.send({ type: 'bash', command: `head -c 1 '${path}' >/dev/null 2>&1 && printf readable || printf blocked` })).toMatchObject({ success: true, data: { output } });
        }
      } finally {
        await handle.close();
      }
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
