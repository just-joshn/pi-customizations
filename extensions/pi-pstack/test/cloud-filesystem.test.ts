import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'real idle transport keeps store data private while nested policy preparation exposes the native sandbox limit',
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
        expect.hasAssertions();
        for (const directory of filesystem.denied) {
          expect(await handle.send({ type: 'bash', command: `ls -A ${JSON.stringify(directory)} >/dev/null 2>&1 && printf listed || printf blocked` })).toMatchObject({ success: true, data: { output: 'blocked' } });
        }
        for (const [path, output] of [
          [legacy, 'readable'],
          [sibling, 'blocked'],
          [global, 'blocked'],
          [orchestration, 'blocked'],
          [repo, 'readable'],
        ] as const) {
          expect(await handle.send({ type: 'bash', command: `head -c 1 '${path}' >/dev/null 2>&1 && printf readable || printf blocked` })).toMatchObject({ success: true, data: { output } });
        }
        const module = fileURLToPath(new URL('../src/cloud-filesystem.ts', import.meta.url));
        const child = join(own, 'nested');
        await mkdir(child);
        const transport = fileURLToPath(new URL('../scripts/detached-rpc-client.mjs', import.meta.url));
        const script = `(async () => { const m = await import(${JSON.stringify(module)}); const t = await import(${JSON.stringify(transport)}); const filesystem = await m.cloudFilesystem(${JSON.stringify(own)}, ${JSON.stringify(child)}, ${JSON.stringify(workspace)}); console.log('prepared'); const h = await t.startDetachedRpc({ directory: ${JSON.stringify(child)}, cwd: ${JSON.stringify(workspace)}, agentDir: ${JSON.stringify(join(root, 'agent'))}, args: ['--no-session', '--no-extensions'], filesystem }); try { const r = await h.send({ type: 'get_state' }); console.log(r.success ? 'prepared' : 'failed'); } finally { await h.close(); } })().catch(e => { if (e.message.includes('sandbox_apply: Operation not permitted')) console.log('nested sandbox unavailable'); else throw e; })`;
        expect(await handle.send({ type: 'bash', command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}` })).toMatchObject({ success: true, data: { output: 'prepared\nnested sandbox unavailable\n' } });
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
