import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAgentSession, DefaultResourceLoader, SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { registerWorkers } from '../src/workers.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function nestingFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-nesting-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', dir);
  await mkdir(join(dir, 'extensions'));
  await writeFile(join(dir, 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  await writeFile(join(dir, 'extensions/provider.ts'), `export { default } from ${JSON.stringify(join(packageRoot, 'test/parity-runtime-provider.ts'))};`);
  const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, noSkills: true, noContextFiles: true, extensionFactories: [registerWorkers] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, resourceLoader: loader, sessionManager: SessionManager.create(dir, join(dir, 'sessions')) });
  await session.bindExtensions({ mode: 'print' });
  const model = session.extensionRunner.createContext().modelRegistry.getAvailable().find((item) => item.provider === 'worker-test');
  if (!model) throw new Error('missing worker-test model');
  await session.setModel(model);
  const task = loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.values()]).find((tool) => tool.definition.name === 'Task');
  if (!task) throw new Error('Task tool is not registered');
  const call = (params: Record<string, unknown>) => task.definition.execute('nest', params, undefined, undefined, session.extensionRunner.createToolContext('nest', undefined));
  const close = async () => {
    try {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    } finally {
      session.dispose();
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  };
  return { dir, call, close };
}

test('a Task child can start grandchildren to depth 3 and every level settles', async () => {
  const f = await nestingFixture();
  try {
    const result = await f.call({ prompt: 'LEVEL 1', model: 'worker-test/deterministic', run_in_background: false });
    expect(JSON.parse(result.content.find((block) => block.type === 'text')?.text ?? '{}').status).toBe('settled');
    const lines = (await readFile(join(f.dir, 'nesting.txt'), 'utf8')).trim().split('\n');
    expect(lines.filter((line) => line.startsWith('started'))).toEqual(['started LEVEL 1', 'started LEVEL 2', 'started LEVEL 3']);
    expect(lines.filter((line) => line.startsWith('result')).map((line) => line.split(':')[0])).toEqual(['result level-3', 'result level-2']);
  } finally {
    await f.close();
  }
}, 30000);

test('a nested spawn carries environment cloud and fails at the missing VM executor with no local fallback', async () => {
  const f = await nestingFixture();
  try {
    await f.call({ prompt: 'LEVEL 1 CLOUD_AT_LEVEL', model: 'worker-test/deterministic', run_in_background: false });
    const lines = (await readFile(join(f.dir, 'nesting.txt'), 'utf8')).trim().split('\n');
    const rejected = lines.find((line) => line.startsWith('error cloud-task:')) ?? '';
    expect(rejected).toMatch(/Cloud Tasks require a configured isolated remote executor.*No local fallback is permitted/);
    expect(lines.filter((line) => line.startsWith('started'))).toEqual(['started LEVEL 1', 'started LEVEL 2']);
  } finally {
    await f.close();
  }
}, 30000);
