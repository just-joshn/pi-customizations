import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAgentSession, DefaultResourceLoader, SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, vi } from 'vitest';
import { registerWorkers } from '../src/workers.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function writeProvider(dir: string): Promise<void> {
  await writeFile(join(dir, 'extensions/provider.ts'), `export { default } from ${JSON.stringify(join(packageRoot, 'test/worker-provider.ts'))};`);
}

async function closeFixture(session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined, dir: string) {
  try {
    if (session) {
      try {
        await session.abort();
      } finally {
        try {
          await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
        } finally {
          session.dispose();
        }
      }
    }
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
}

export async function workerFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-child-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', dir);
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  const close = () => closeFixture(session, dir);
  try {
    await mkdir(join(dir, 'extensions'));
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
    await writeProvider(dir);
    const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noSkills: true, noContextFiles: true, extensionFactories: [registerWorkers] });
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    session = (await createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader, sessionManager: SessionManager.create(dir, join(dir, 'sessions')) })).session;
    await session.bindExtensions({ mode: 'print' });
    const context = session.extensionRunner.createContext();
    const model = context.modelRegistry.getAvailable().find((model) => model.provider === 'worker-test');
    expect(model).toBeDefined();
    if (!model) throw new Error('missing model');
    await session.setModel(model);
    const activeSession = session;
    const tools = loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.values()]);
    async function call(name: string, params: Record<string, unknown>, signal?: AbortSignal, busy = false) {
      const tool = tools.find((tool) => tool.definition.name === name);
      expect(tool).toBeDefined();
      if (!tool) throw new Error(`tool ${name} not found`);
      const context = activeSession.extensionRunner.createContext();
      return tool.definition.execute(`test-${name}`, params, signal, undefined, busy ? { ...context, isIdle: () => false } : context);
    }
    return { dir, session, call, close };
  } catch (error) {
    await close();
    throw error;
  }
}
