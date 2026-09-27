import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { modelConfigPath, readModelRule, setupModels } from '../src/models.ts';

function context(overrides: Partial<ExtensionContext['ui']> = {}): ExtensionContext {
  return { hasUI: true, modelRegistry: { getAvailable: () => [] }, ui: {
    notify: () => {}, input: async () => 'auto', confirm: async () => true,
    select: async (title: string) => title.startsWith('pstack reasoning budget') ? 'unlimited — keep max' : title.startsWith('Accept model table') ? 'Accept as-is' : 'auto',
    ...overrides,
  } } as unknown as ExtensionContext;
}

async function fixture() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'pstack-model-errors-'));
  const prior = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  return { dir, async close() {
    if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prior;
    await fs.rm(dir, { recursive: true, force: true });
  } };
}

test('model rule reads propagate non-ENOENT errors', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(modelConfigPath(), { recursive: true });
    await assert.rejects(readModelRule(), /EISDIR/);
  } finally { await f.close(); }
});

for (const operation of ['writeFile', 'rename'] as const) {
  test(`configuration ${operation} failure preserves the old rule and removes temporary files`, async t => {
    const f = await fixture();
    try {
      await setupModels(context());
      const previous = await readModelRule();
      const failing = t.mock.method(fs, operation, async () => { throw new Error(`${operation} failure`); });
      syncBuiltinESMExports();
      await assert.rejects(setupModels(context()), new RegExp(`${operation} failure`));
      failing.mock.restore();
      syncBuiltinESMExports();
      assert.equal(await readModelRule(), previous);
      assert.deepEqual(await fs.readdir(dirname(modelConfigPath())), ['models.mdc']);
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.close(); }
  });
}

test('invalid budgets and roles reject and cancelling a role leaves the rule unchanged', async () => {
  const f = await fixture();
  try {
    await setupModels(context());
    const previous = await readModelRule();
    await assert.rejects(setupModels(context({ select: async () => 'invalid' })), /Unknown budget/);
    await assert.rejects(setupModels(context({ select: async title => title.startsWith('pstack reasoning budget') ? 'unlimited — keep max' : 'invalid' })), /Unknown role/);
    const cancelled = await setupModels(context({ select: async title => title.startsWith('pstack reasoning budget') ? 'unlimited — keep max' : title.startsWith('Accept model table') ? 'bug-fix' : undefined }));
    assert.equal(cancelled, false);
    assert.equal(await readModelRule(), previous);
  } finally { await f.close(); }
});

test('many retired model roles remain ordered and are all reported', async () => {
  const f = await fixture();
  try {
    await setupModels(context());
    const retired = Array.from({ length: 2000 }, (_, index) => `retired-${index}: auto`);
    await fs.appendFile(modelConfigPath(), retired.join('\n') + '\n');
    let notice = '';
    assert.equal(await setupModels(context({ notify: message => { notice = message; }, select: async title => title.startsWith('pstack reasoning budget') ? 'unlimited — keep max' : undefined })), false);
    assert.ok(notice.endsWith(retired.join('\n')));
  } finally { await f.close(); }
});
