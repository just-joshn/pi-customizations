import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { modelConfigPath, projectModelConfigPath, readModelRule, resolveModel, roleNames } from '../src/models.ts';

const found = anthropicProvider()
  .getModels()
  .find((item) => item.reasoning);
if (!found) throw new Error('Pi Anthropic catalogue has no reasoning model.');
const model = found;
function context(overrides: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
  return { hasUI: false, model, thinkingLevel: 'medium', modelRegistry: { getAvailable: () => [model] }, ...overrides } as ExtensionCommandContext;
}

test('parent aliases, qualified models, and supported reasoning resolve', () => {
  const ctx = context();
  for (const alias of [undefined, 'auto', 'inherit-parent']) expect(resolveModel(alias, ctx)).toEqual({ model, thinkingLevel: 'medium' });
  expect(resolveModel(model.id, ctx).model).toBe(model);
  expect(resolveModel(`${model.provider}/${model.id}:high`, ctx).thinkingLevel).toBe('high');
});

test('missing defaults and unsupported reasoning report available choices', () => {
  expect(() => resolveModel('grok-4.7-xhigh-fast', context())).toThrow(/Unavailable.*setup-pstack/);
  expect(() => resolveModel(`${model.id}:garbage`, context())).toThrow(/Unknown thinking level/);
  const limited = { ...model, reasoning: false };
  const ctx = context({ model: limited, modelRegistry: { getAvailable: () => [limited] } as ExtensionCommandContext['modelRegistry'] });
  expect(() => resolveModel(`${model.id}:high`, ctx)).toThrow(/Supported thinking levels: off/);
  expect(resolveModel(model.id, ctx).thinkingLevel).toBe('off');
  expect(() => resolveModel('auto', context({ model: undefined }))).toThrow(/No parent model/);
});

test('an inherited reasoning level clamps to the nearest supported level', () => {
  const capped = { ...model, thinkingLevelMap: { high: null, xhigh: null, max: null } };
  const ctx = context({ model: capped, thinkingLevel: 'high', modelRegistry: { getAvailable: () => [capped] } as ExtensionCommandContext['modelRegistry'] });
  expect(resolveModel(capped.id, ctx).thinkingLevel).toBe('medium');
});

test('ambiguous IDs require a provider; exact IDs containing colons are retained', () => {
  const duplicate = { ...model, provider: 'other-provider' };
  const colon = { ...model, id: 'custom:model' };
  const ctx = context({ modelRegistry: { getAvailable: () => [model, duplicate, colon] } as ExtensionCommandContext['modelRegistry'] });
  expect(() => resolveModel(model.id, ctx)).toThrow(/Ambiguous/);
  expect(resolveModel(`other-provider/${model.id}`, ctx).model).toBe(duplicate);
  expect(resolveModel('custom:model', ctx).model).toBe(colon);
});

test('model rule reads propagate non-ENOENT errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-model-errors-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', directory);
  try {
    await mkdir(modelConfigPath(), { recursive: true });
    await expect(readModelRule()).rejects.toThrow(/EISDIR/);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

test('project role lines override the user rule while user comments and other roles are kept', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-model-errors-'));
  const project = await mkdtemp(join(tmpdir(), 'pstack-project-rule-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', directory);
  try {
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), '# pstack model configuration.\n# budget: unlimited (max)\nbug-fix: user-model\nswarm workers: user-swarm\n');
    await mkdir(dirname(projectModelConfigPath(project)), { recursive: true });
    await writeFile(projectModelConfigPath(project), '# project choices\nbug-fix: project-model\n');
    const merged = await readModelRule(project);
    expect(merged).toContain('# budget: unlimited (max)');
    expect(merged).toContain('bug-fix: project-model');
    expect(merged).toContain('swarm workers: user-swarm');
    expect(merged).not.toContain('bug-fix: user-model');
    expect(await readModelRule()).toContain('bug-fix: user-model');
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  }
});

test('the setup-pstack role table lists every role the tool writes, so a re-run does not drop one as retired', async () => {
  const skill = await readFile(new URL('../skills/setup-pstack/SKILL.md', import.meta.url), 'utf8');
  const fence = skill.match(/```[\s\S]*?```/g)?.find((block) => block.includes('feature, refactoring: ')) ?? '';
  const listed = fence.split('\n').flatMap((line) => (/^[a-z][a-z0-9 ,-]*: /.test(line) && !line.startsWith('description: ') ? [line.slice(0, line.indexOf(': '))] : []));
  expect(listed.toSorted()).toEqual([...roleNames].toSorted());
});