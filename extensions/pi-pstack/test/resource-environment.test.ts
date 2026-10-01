import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { startDetachedRpc } from '../scripts/detached-rpc-client.mjs';
import { skillCatalog } from '../src/catalog.ts';
import { cloudWorkerArguments } from '../src/cloud-worker.ts';
import { availableInEnvironment } from '../src/resource-environment.ts';
import { fixture, model, packageRoot } from './session-fixture.ts';

test('Origin retains its source cloud exclusion while remaining available locally', async () => {
  const path = join(packageRoot, 'host/skills/origin/SKILL.md');
  expect(availableInEnvironment(path, 'cloud')).toBe(false);
  expect(availableInEnvironment(path, 'local')).toBe(true);
  expect(await readFile(path, 'utf8')).toContain('disabled-environments:\n  - cloud');
});

test('cloud resource arguments and the real idle Pi CLI exclude Origin without launching a Task', async () => {
  const f = await fixture();
  try {
    const loader = new DefaultResourceLoader({ cwd: f.cwd, agentDir: join(f.root, 'loader-agent'), settingsManager: SettingsManager.inMemory({ packages: [packageRoot] }) });
    await loader.reload();
    const systemFile = join(f.root, 'system.md');
    await writeFile(systemFile, await skillCatalog(packageRoot, 'cloud'));
    const args = cloudWorkerArguments({ dir: join(f.root, 'sessions'), selected: { model: { ...model, provider: 'journey-test', id: 'recorder' }, thinkingLevel: 'off' }, loader, readonly: false }, systemFile);
    expect(args).not.toContain(join(packageRoot, 'host/skills/origin/SKILL.md'));
    expect(args).not.toContain(join(packageRoot, 'host/prompts/origin.md'));
    expect(await readFile(systemFile, 'utf8')).not.toContain('create-skill, goal, loop, origin');
    expect(await skillCatalog(packageRoot, 'local')).toContain('create-skill, goal, loop, origin');
    const handle = await startDetachedRpc({ directory: f.root, cwd: f.cwd, agentDir: join(f.root, 'cli-agent'), args: [...args, '-e', join(packageRoot, 'test/journey-provider.ts')] });
    try {
      const commands = await handle.send({ type: 'get_commands' });
      expect(commands.success).toBe(true);
      expect(JSON.stringify(commands)).not.toContain('"name":"origin"');
      expect(JSON.stringify(commands)).not.toContain('"name":"skill:origin"');
      expect(JSON.stringify(commands)).toContain('create-skill');
    } finally {
      await handle.close();
    }
  } finally {
    await f.close();
  }
}, 30000);

test('an untagged Origin duplicate inherits the authoritative cloud exclusion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-origin-duplicate-'));
  const path = join(directory, 'SKILL.md');
  try {
    await writeFile(path, '---\nname: origin\ndescription: User-scoped Origin copy\n---\nLocal login workflow.');
    expect(availableInEnvironment(path, 'cloud')).toBe(false);
    expect(availableInEnvironment(path, 'local')).toBe(true);
    await writeFile(path, '---\nname: unrelated\ndescription: Cloud-capable fixture\n---\nBody.');
    expect(availableInEnvironment(path, 'cloud')).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an untagged Origin prompt inherits exclusion from its filename identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-origin-prompt-'));
  const path = join(directory, 'origin.md');
  try {
    await writeFile(path, '---\ndescription: User-scoped Origin alias\n---\nLocal login workflow.');
    expect(availableInEnvironment(path, 'cloud')).toBe(false);
    expect(availableInEnvironment(path, 'local')).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('environment metadata is validated and does not hide unrestricted resources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-resource-env-'));
  const path = join(directory, 'SKILL.md');
  try {
    await writeFile(path, '---\nname: example\ndescription: Fixture\n---\nBody');
    expect(availableInEnvironment(path, 'cloud')).toBe(true);
    await writeFile(path, '---\nname: example\ndescription: Fixture\ndisabled-environments: true\n---\nBody');
    expect(() => availableInEnvironment(path, 'cloud')).toThrow('Invalid disabled-environments');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
