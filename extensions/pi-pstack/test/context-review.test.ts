import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SessionManager, type ExtensionAPI, type ExtensionContext, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { registerContext } from '../src/context.ts';

type Evidence = { entries: unknown[]; models: string[]; tools: unknown[]; history: unknown[];
  omitted: Record<string, number>; historyDiscovery: { mode: string; completeness: string } };

async function call(manager: SessionManager, options: { history?: boolean; models?: { provider: string; id: string }[]; tools?: { name: string; description: string }[] } = {}) {
  let tool: ToolDefinition | undefined;
  const pi = { registerTool: (value: ToolDefinition) => { tool = value; }, getAllTools: () => options.tools ?? [] } as unknown as ExtensionAPI;
  registerContext(pi);
  assert.ok(tool);
  const ctx = { cwd: manager.getCwd(), sessionManager: manager, modelRegistry: { getAvailable: () => options.models ?? [] } } as unknown as ExtensionContext;
  const result = await tool.execute('context-review', { history: options.history }, undefined, undefined, ctx);
  return result.details as Evidence;
}

for (const id of ['a'.repeat(8186), '🙂'.repeat(2046) + 'ab']) {
  test(`context accepts the exact serialized byte budget for ${id.startsWith('a') ? 'ASCII' : 'multibyte'} models`, async () => {
    const manager = SessionManager.inMemory('/tmp/context-review');
    const exact = await call(manager, { models: [{ provider: 'p', id }] });
    assert.deepEqual(exact.models, [`p/${id}`]);
    assert.equal(Buffer.byteLength(JSON.stringify(exact.models)), 8192);
    assert.equal(exact.omitted.models, 0);
    const oversized = await call(manager, { models: [{ provider: 'p', id: id + 'a' }] });
    assert.deepEqual(oversized.models, []);
    assert.equal(oversized.omitted.models, 1);
  });
}

test('context counts separators at the exact multibyte list boundary', async () => {
  const manager = SessionManager.inMemory('/tmp/context-review');
  const models = [{ provider: 'p', id: 'a' }, { provider: 'p', id: '🙂'.repeat(2045) }, { provider: 'p', id: 'omitted' }];
  const result = await call(manager, { models });
  assert.deepEqual(result.models, ['p/a', `p/${'🙂'.repeat(2045)}`]);
  assert.equal(Buffer.byteLength(JSON.stringify(result.models)), 8192);
  assert.equal(result.omitted.models, 1);
});

async function historyFixture() {
  const root = await mkdtemp(join(tmpdir(), 'pstack-context-review-'));
  const prior = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  const close = async () => {
    if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prior;
    await rm(root, { recursive: true, force: true });
  };
  try {
    const manager = SessionManager.create(root);
    return { root, manager, directory: manager.getSessionDir(), close };
  } catch (error) { await close(); throw error; }
}

for (const failure of ['directory', 'session']) {
  test(`real SDK ${failure} read failures retain unknown history completeness`, async () => {
    const f = await historyFixture();
    try {
      if (failure === 'directory') {
        await rm(f.directory, { recursive: true });
        await writeFile(f.directory, 'not a directory');
        await assert.rejects(readdir(f.directory), /ENOTDIR/);
      } else {
        const unreadable = join(f.directory, 'broken.jsonl');
        await mkdir(unreadable);
        await assert.rejects(readFile(unreadable), /EISDIR/);
      }
      assert.deepEqual(await SessionManager.list(f.root), []);
      const result = await call(f.manager, { history: true });
      assert.deepEqual(result.history, []);
      assert.equal(result.omitted.history, 0);
      assert.deepEqual(result.historyDiscovery, { mode: 'best-effort', completeness: 'unknown' });
    } finally { await f.close(); }
  });
}

test('context reports budget omissions for every list without claiming history completeness', async () => {
  const f = await historyFixture();
  try {
    for (let index = 0; index < 100; index++) {
      f.manager.appendCustomEntry('large-history', { index });
      const header = { type: 'session', version: 3, id: `history-${index}`, cwd: f.root, timestamp: new Date(0).toISOString() };
      await writeFile(join(f.directory, `${index}.jsonl`), JSON.stringify(header) + '\n');
    }
    const tools = Array.from({ length: 100 }, (_, index) => ({ name: `tool-${index}`, description: '🙂'.repeat(160) }));
    const models = Array.from({ length: 100 }, (_, index) => ({ provider: 'provider', id: `${index}-${'m'.repeat(100)}` }));
    const result = await call(f.manager, { history: true, tools, models });
    for (const key of ['entries', 'tools', 'models', 'history'] as const) {
      assert.ok(result[key].length > 0);
      assert.ok(result.omitted[key]! > 0);
      assert.equal(result[key].length + result.omitted[key]!, 100);
      assert.ok(Buffer.byteLength(JSON.stringify(result[key])) <= 8192);
    }
    assert.deepEqual(result.historyDiscovery, { mode: 'best-effort', completeness: 'unknown' });
    const empty = await call(SessionManager.inMemory(f.root));
    assert.deepEqual(empty.omitted, { entries: 0, tools: 0, models: 0, history: 0 });
    assert.deepEqual(empty.historyDiscovery, { mode: 'not-requested', completeness: 'unknown' });
  } finally { await f.close(); }
});
