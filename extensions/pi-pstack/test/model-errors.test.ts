import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { modelConfigPath, readModelRule, setupModels } from '../src/models.ts';

function context(overrides: Partial<ExtensionContext['ui']> = {}): ExtensionContext {
  return {
    hasUI: true,
    modelRegistry: { getAvailable: () => [] },
    ui: {
      notify: () => {},
      input: async () => 'auto',
      confirm: async () => true,
      select: async (title: string) => (title.startsWith('pstack reasoning budget') ? 'unlimited — keep max' : title.startsWith('Accept model table') ? 'Accept as-is' : 'auto'),
      ...overrides,
    },
  } as unknown as ExtensionContext;
}

async function fixture() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'pstack-model-errors-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', dir);
  return {
    dir,
    async close() {
      vi.unstubAllEnvs();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

test('model rule reads propagate non-ENOENT errors', async () => {
  const f = await fixture();
  try {
    await fs.mkdir(modelConfigPath(), { recursive: true });
    await expect(readModelRule()).rejects.toThrow(/EISDIR/);
  } finally {
    await f.close();
  }
});

test.each(['writeFile', 'rename'] as const)('configuration %s failure preserves the old rule and removes temporary files', async (operation) => {
  const f = await fixture();
  try {
    await setupModels(context());
    const previous = await readModelRule();
    const failing = vi.spyOn(fs, operation).mockRejectedValue(new Error(`${operation} failure`));
    syncBuiltinESMExports();
    await expect(setupModels(context())).rejects.toThrow(new RegExp(`${operation} failure`));
    failing.mockRestore();
    syncBuiltinESMExports();
    expect(await readModelRule()).toBe(previous);
    expect(await fs.readdir(dirname(modelConfigPath()))).toEqual(['models.mdc']);
  } finally {
    syncBuiltinESMExports();
    await f.close();
  }
});

test('invalid budgets and roles reject and cancelling a role leaves the rule unchanged', async () => {
  const f = await fixture();
  try {
    await setupModels(context());
    const previous = await readModelRule();
    await expect(setupModels(context({ select: async () => 'invalid' }))).rejects.toThrow(/Unknown budget/);
    await expect(setupModels(context({ select: async (title) => (title.startsWith('pstack reasoning budget') ? 'unlimited — keep max' : 'invalid') }))).rejects.toThrow(/Unknown role/);
    const cancelled = await setupModels(context({ select: async (title) => (title.startsWith('pstack reasoning budget') ? 'unlimited — keep max' : title.startsWith('Accept model table') ? 'bug-fix' : undefined) }));
    expect(cancelled).toBe(false);
    expect(await readModelRule()).toBe(previous);
  } finally {
    await f.close();
  }
});

test('many retired model roles remain ordered and are all reported', async () => {
  const f = await fixture();
  try {
    await setupModels(context());
    const retired = Array.from({ length: 2000 }, (_, index) => `retired-${index}: auto`);
    await fs.appendFile(modelConfigPath(), `${retired.join('\n')}\n`);
    let notice = '';
    expect(
      await setupModels(
        context({
          notify: (message) => {
            notice = message;
          },
          select: async (title) => (title.startsWith('pstack reasoning budget') ? 'unlimited — keep max' : undefined),
        }),
      ),
    ).toBe(false);
    expect(notice.endsWith(retired.join('\n'))).toBe(true);
  } finally {
    await f.close();
  }
});
