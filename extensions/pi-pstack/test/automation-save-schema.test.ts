import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { registerAutomations } from '../src/automations.ts';

test('AutomationSave parameters are a top-level object schema for providers that reject allOf', async ({ onTestFinished }) => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-save-schema-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [registerAutomations],
  });
  await loader.reload();
  const tool = loader
    .getExtensions()
    .extensions.flatMap((extension) => [...extension.tools.values()])
    .find((entry) => entry.definition.name === 'AutomationSave');
  expect(tool).toBeDefined();
  const schema = tool?.definition.parameters as Record<string, unknown>;
  expect(schema['type']).toBe('object');
  expect(schema).not.toHaveProperty('allOf');
});
