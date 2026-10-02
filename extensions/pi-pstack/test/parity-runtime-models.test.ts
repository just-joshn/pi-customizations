import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { modelConfigPath, roleNames, setupModels } from '../src/models.ts';

const found = anthropicProvider()
  .getModels()
  .find((item) => item.reasoning);
if (!found) throw new Error('Pi Anthropic catalogue has no reasoning model.');
const claude = found;
const gpt = { ...claude, provider: 'openai', id: 'gpt-5.6' };

async function runSetup(panel: string, available: (typeof claude)[]) {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-family-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', directory);
  try {
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), roleNames.map((role) => `${role}: ${role === 'interrogate reviewers' ? panel : 'inherit-parent'}`).join('\n'));
    const notices: { message: string; level?: string }[] = [];
    const ctx = {
      hasUI: true,
      mode: 'rpc',
      model: claude,
      thinkingLevel: 'medium',
      modelRegistry: { getAvailable: () => available },
      ui: {
        notify: (message: string, level?: string) => notices.push({ message, level }),
        select: async (title: string) => (title.startsWith('pstack reasoning budget') ? 'unlimited — keep max' : 'Accept as-is'),
        input: async () => undefined,
        confirm: async () => true,
      },
    } as unknown as ExtensionCommandContext;
    const written = await setupModels(ctx);
    return { written, notices, rule: await readFile(modelConfigPath(), 'utf8') };
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
}

test('setup warns when a panel role has fewer than two model families and still writes the rule', async () => {
  const sameFamily = `${claude.provider}/${claude.id}, inherit-parent`;
  const result = await runSetup(sameFamily, [claude]);
  const warnings = result.notices.filter((notice) => notice.level === 'warning').map((notice) => notice.message);
  expect(warnings).toEqual(['interrogate reviewers lists 2 entries from 1 model family. Entries count as seats, not as independent reviewers. Add a model from another family.']);
  expect(result.written).toBe(true);
  expect(result.rule).toContain(`interrogate reviewers: ${sameFamily}`);
});

test('setup stays silent when a panel role spans two model families', async () => {
  const result = await runSetup(`${claude.provider}/${claude.id}, ${gpt.provider}/${gpt.id}`, [claude, gpt] as (typeof claude)[]);
  expect(result.notices.filter((notice) => notice.level === 'warning')).toEqual([]);
  expect(result.written).toBe(true);
});

test('a single-seat panel gets no family warning', async () => {
  const result = await runSetup('inherit-parent', [claude]);
  expect(result.notices.filter((notice) => notice.level === 'warning')).toEqual([]);
  expect(result.written).toBe(true);
  expect(result.rule).toContain('interrogate reviewers: inherit-parent');
});
