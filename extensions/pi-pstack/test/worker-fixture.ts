import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type AgentToolUpdateCallback, createAgentSession, createEventBus, DefaultResourceLoader, type ExtensionFactory, SessionManager } from '@earendil-works/pi-coding-agent';
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

function workerLoader(dir: string, flags: Readonly<Record<string, string>>, extensions: readonly ExtensionFactory[]) {
  const eventBus = createEventBus();
  const normalizedTypes: unknown[] = [];
  const subagentLogs: unknown[] = [];
  const modelResolutions: unknown[] = [];
  const subagentStats: unknown[] = [];
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    eventBus,
    noSkills: true,
    noContextFiles: true,
    extensionFactories: [
      (pi) => {
        for (const [name, value] of Object.entries(flags)) pi.registerFlag(name, { type: 'string', default: value });
        pi.events.on('pstack:subagent-type-normalized', (value) => {
          normalizedTypes.push(value);
        });
        pi.events.on('pstack:subagent-log', (value) => {
          subagentLogs.push(value);
        });
        pi.events.on('pstack:subagent-model-resolve', (value) => {
          modelResolutions.push(value);
        });
        pi.events.on('pstack:subagent-stats', (value) => {
          subagentStats.push(value);
        });
        registerWorkers(pi);
      },
      ...extensions,
    ],
  });
  return { loader, eventBus, normalizedTypes, subagentLogs, modelResolutions, subagentStats };
}

export async function workerFixture(options: { retry?: boolean; flags?: Readonly<Record<string, string>>; extensions?: readonly ExtensionFactory[] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-child-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', dir);
  vi.stubEnv('HOME', join(dir, 'home'));
  let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  const close = () => closeFixture(session, dir);
  try {
    await mkdir(join(dir, 'extensions'));
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ retry: { enabled: options.retry ?? false, maxRetries: 1, baseDelayMs: 0 }, compaction: { enabled: false } }));
    await writeProvider(dir);
    const { loader, eventBus, normalizedTypes, subagentLogs, modelResolutions, subagentStats } = workerLoader(dir, options.flags ?? {}, options.extensions ?? []);
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    session = (await createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader, sessionManager: SessionManager.create(dir, join(dir, 'sessions')) })).session;
    await session.bindExtensions({ mode: 'print' });
    const context = session.extensionRunner.createContext();
    const model = context.modelRegistry.getAvailable().find((model) => model.provider === 'worker-test' && model.id === 'deterministic');
    expect(model).toBeDefined();
    if (!model) throw new Error('missing model');
    await session.setModel(model);
    const activeSession = session;
    async function call(name: string, params: Record<string, unknown>, signal?: AbortSignal, busy = false, onUpdate?: AgentToolUpdateCallback<unknown>) {
      const tools = loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.values()]);
      const tool = tools.find((tool) => tool.definition.name === name);
      expect(tool).toBeDefined();
      if (!tool) throw new Error(`tool ${name} not found`);
      const context = activeSession.extensionRunner.createToolContext(`test-${name}`, signal);
      return tool.definition.execute(`test-${name}`, params, signal, onUpdate, busy ? { ...context, isIdle: () => false } : context);
    }
    return { dir, session, eventBus, call, close, normalizedTypes, subagentLogs, modelResolutions, subagentStats };
  } catch (error) {
    await close();
    throw error;
  }
}
