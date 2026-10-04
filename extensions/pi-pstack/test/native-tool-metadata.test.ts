import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { registerGoal } from '../src/goal.ts';
import { registerRoutines } from '../src/routines.ts';
import { registerShells } from '../src/shells.ts';
import { registerTimers } from '../src/timers.ts';
import { registerWorkers } from '../src/workers.ts';

const families = [
  { register: registerGoal, namespace: 'pstack_goals', names: ['CreateGoal', 'GetGoal', 'UpdateGoal'] },
  { register: registerTimers, namespace: 'pstack_timers', names: ['SubscribeTimer', 'SubscribeGithubCI', 'SubscribeOriginCI', 'ListSubscriptions', 'Unsubscribe', 'RestartSubscriptions'] },
  { register: registerRoutines, namespace: 'pstack_routines', names: ['RoutinePrepare', 'RoutineInspect', 'RoutineEnable', 'RoutineDisable'] },
  { register: registerWorkers, namespace: 'pstack_workers', names: ['Task', 'TaskOutput', 'TaskStop', 'TaskMessage', 'TaskList', 'TaskAttach'] },
  { register: registerShells, namespace: 'pstack_shells', names: ['BackgroundShell', 'Background' + 'ShellList', 'Background' + 'ShellStop'] },
];

test.for(families)('$namespace publishes native group guidance', async ({ register, namespace, names }, { onTestFinished }) => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-metadata-'));
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
    extensionFactories: [register],
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toHaveLength(0);
  const tools = loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.values()]);
  for (const name of names) {
    const tool = tools.find((tool) => tool.definition.name === name);
    expect(tool).toBeDefined();
    expect(tool?.definition.namespace?.name).toBe(namespace);
    expect(tool?.definition.namespace?.description).toEqual(expect.any(String));
    expect(tool?.definition.namespace?.instructions).toEqual(expect.any(String));
  }
});
