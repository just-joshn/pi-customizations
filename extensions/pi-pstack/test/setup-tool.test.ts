import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import type { ExtensionAPI, ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { modelConfigPath, roleNames, skillDefaultTable } from '../src/models.ts';
import { registerSetupTool } from '../src/setup-tool.ts';

const found = anthropicProvider()
  .getModels()
  .find((item) => item.reasoning);
if (!found) throw new Error('Pi Anthropic catalogue has no reasoning model.');
const model = found;

type ToolDefinition = Parameters<ExtensionAPI['registerTool']>[0];

function toolDefinition(): ToolDefinition {
  const tools: ToolDefinition[] = [];
  registerSetupTool({ registerTool: (tool: ToolDefinition) => tools.push(tool) } as unknown as ExtensionAPI);
  const definition = tools.find((entry) => entry.name === 'pstack_setup');
  if (!definition) throw new Error('pstack_setup was not registered.');
  return definition;
}

function toolContext(available = [model]): ExtensionToolContext {
  return { model, thinkingLevel: 'medium', modelRegistry: { getAvailable: () => available } } as unknown as ExtensionToolContext;
}

async function fixture(): Promise<{ directory: string; close: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-setup-tool-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', directory);
  return {
    directory,
    close: async () => {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function seedRule(text: string): Promise<void> {
  await mkdir(dirname(modelConfigPath()), { recursive: true });
  await writeFile(modelConfigPath(), text);
}

function ruleResult(definition: ToolDefinition, params: Record<string, unknown>, ctx: ExtensionToolContext) {
  return definition.execute('setup', params, undefined, undefined, ctx) as Promise<{
    content: { type: string; text: string }[];
    details: Record<string, unknown>;
    structuredContent: Record<string, unknown>;
  }>;
}

test('pstack_setup registers as a sequential model-only tool that writes configuration', () => {
  const definition = toolDefinition();
  expect(definition.exposure).toBe('model-only');
  expect(definition.executionMode).toBe('sequential');
  expect(definition.outputSchema).toBeDefined();
  expect(definition.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
});

test('the state action reports the rule path, current budget, working roles, dropped lines, and detected models', async () => {
  const f = await fixture();
  try {
    await seedRule('# budget: small (medium)\nswarm workers: inherit-parent\nretired-role: gone\n');
    const definition = toolDefinition();
    const state = await ruleResult(definition, { action: 'state' }, toolContext());
    const defaults = Object.fromEntries([...skillDefaultTable].map(([role, values]) => [role, values.join(', ')]));
    expect(state.details).toEqual({
      rulePath: modelConfigPath(),
      budget: 'small (medium)',
      roles: { ...defaults, 'swarm workers': 'inherit-parent' },
      dropped: ['retired-role: gone'],
      availableModels: [`anthropic/${model.id}`],
    });
    expect(state.structuredContent).toEqual(state.details);
    expect(JSON.parse(state.content[0]?.text ?? '{}')).toEqual(state.details);
  } finally {
    await f.close();
  }
});

test('a missing rule reports empty state without creating the file', async () => {
  const f = await fixture();
  try {
    const definition = toolDefinition();
    const state = await ruleResult(definition, { action: 'state' }, toolContext());
    expect(state.details).toMatchObject({ budget: null, dropped: [], availableModels: [`anthropic/${model.id}`] });
    await expect(readFile(modelConfigPath(), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await f.close();
  }
});

test('the write action records the supplied role values without re-flooring them and writes the reference rule shape', async () => {
  const f = await fixture();
  try {
    await seedRule(roleNames.map((role) => `${role}: ${model.provider}/${model.id}:low`).join('\n'));
    const definition = toolDefinition();
    const written = await ruleResult(definition, { action: 'write', budget: 'small — medium reasoning' }, toolContext());
    const result = await readFile(modelConfigPath(), 'utf8');
    expect(result).toMatch(/^# budget: small \(medium\)$/m);
    expect(result).toContain('# pstack model configuration. One line per role. Delete a line to fall back to the skill default.');
    expect(result).toContain('# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit Task `model`). Alias entries in a panel list still count toward its fan-out.');
    expect(result).toMatch(new RegExp(`^feature, refactoring: ${model.provider}/${model.id.replace('.', '\\.')}:low$`, 'm'));
    expect(written.details).toMatchObject({ written: true, budget: 'small (medium)' });
    expect(Object.keys(written.details['roles'] as Record<string, string>).toSorted()).toEqual([...roleNames].toSorted());
  } finally {
    await f.close();
  }
});

test('the write action applies role overrides literally after validating availability', async () => {
  const f = await fixture();
  try {
    await seedRule(roleNames.map((role) => `${role}: inherit-parent`).join('\n'));
    const definition = toolDefinition();
    const written = await ruleResult(
      definition,
      {
        action: 'write',
        budget: 'unlimited — max reasoning',
        roleOverrides: [{ role: 'interrogate reviewers', value: `${model.provider}/${model.id}, inherit-parent` }],
      },
      toolContext(),
    );
    const result = await readFile(modelConfigPath(), 'utf8');
    expect(result).toMatch(/^# budget: unlimited \(max\)$/m);
    expect(result).toContain(`interrogate reviewers: ${model.provider}/${model.id}, inherit-parent`);
    expect(written.details).toMatchObject({ written: true, budget: 'unlimited (max)' });
    expect(written.content[0]?.text).toContain(`Wrote ${modelConfigPath()} with budget unlimited (max).`);
  } finally {
    await f.close();
  }
});

test.for(['writeFile', 'rename'] as const)('configuration %s failure preserves the old rule and removes temporary files', async (operation) => {
  const f = await fixture();
  try {
    await seedRule(roleNames.map((role) => `${role}: inherit-parent`).join('\n'));
    const previous = await readFile(modelConfigPath(), 'utf8');
    const definition = toolDefinition();
    const failing = vi.spyOn(fs, operation).mockRejectedValue(new Error(`${operation} failure`));
    syncBuiltinESMExports();
    await expect(ruleResult(definition, { action: 'write', budget: 'small — medium reasoning' }, toolContext())).rejects.toThrow(new RegExp(`${operation} failure`));
    failing.mockRestore();
    syncBuiltinESMExports();
    expect(await readFile(modelConfigPath(), 'utf8')).toBe(previous);
    expect(await fs.readdir(dirname(modelConfigPath()))).toEqual(['models.mdc']);
  } finally {
    syncBuiltinESMExports();
    await f.close();
  }
});

test.for([
  { params: { action: 'write', budget: 'invalid' }, message: /Unknown budget 'invalid'/ },
  { params: { action: 'write', budget: 'unlimited — max reasoning', roleOverrides: [{ role: 'not-a-role', value: 'auto' }] }, message: /Unknown role 'not-a-role'/ },
  { params: { action: 'write', budget: 'unlimited — max reasoning', roleOverrides: [{ role: 'bug-fix', value: 'a, b' }] }, message: /bug-fix requires one model/ },
  { params: { action: 'write', budget: 'unlimited — max reasoning', roleOverrides: [{ role: 'bug-fix', value: '' }] }, message: /Empty model selection/ },
  { params: { action: 'write', budget: 'unlimited — max reasoning', roleOverrides: [{ role: 'bug-fix', value: 'grok-4.7-xhigh-fast' }] }, message: /Unavailable model/ },
] as const)('invalid write input rejects with $message', async ({ params, message }) => {
  const f = await fixture();
  try {
    await seedRule(roleNames.map((role) => `${role}: inherit-parent`).join('\n'));
    const definition = toolDefinition();
    await expect(ruleResult(definition, params, toolContext())).rejects.toThrow(message);
  } finally {
    await f.close();
  }
});

test('two thousand retired lines stay ordered in the state report', async () => {
  const f = await fixture();
  try {
    const retired = Array.from({ length: 2000 }, (_, index) => `retired-${index}: auto`);
    await seedRule(`${retired.join('\n')}\n`);
    const definition = toolDefinition();
    const state = await ruleResult(definition, { action: 'state' }, toolContext());
    expect(state.details["dropped"]).toEqual(retired);
  } finally {
    await f.close();
  }
});