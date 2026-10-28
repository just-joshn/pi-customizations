import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverAndLoadExtensions, loadSkills } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

test('KERN-014: Pi discovers and loads the declared extension without errors', async ({ onTestFinished }) => {
  const [cwd, agentDir, packageDir] = await Promise.all([mkdtemp(join(tmpdir(), 'pi-rea-cwd-')), mkdtemp(join(tmpdir(), 'pi-rea-agent-')), mkdtemp(join(tmpdir(), 'pi-rea-package-'))]);
  onTestFinished(async () => {
    await Promise.all([cwd, agentDir, packageDir].map((dir) => rm(dir, { recursive: true, force: true })));
  });
  await Promise.all([
    cp(join(PACKAGE_DIR, 'package.json'), join(packageDir, 'package.json')),
    cp(join(PACKAGE_DIR, 'src'), join(packageDir, 'src'), { recursive: true }),
    cp(join(PACKAGE_DIR, 'schemas'), join(packageDir, 'schemas'), { recursive: true }),
  ]);
  await cp(join(PACKAGE_DIR, 'node_modules'), join(packageDir, 'node_modules'), { recursive: true });
  const { errors, extensions } = await discoverAndLoadExtensions([packageDir], cwd, agentDir);
  expect(errors).toStrictEqual([]);
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as { pi: { extensions: string[] } };
  expect(extensions.map((loaded) => loaded.path)).toStrictEqual(manifest.pi.extensions.map((entry) => resolve(packageDir, entry)));
  expect(extensions).toHaveLength(1);
});

test('KERN-018: the declared skill path loads the REA workflow skill', async () => {
  const { skills, diagnostics } = loadSkills({
    cwd: PACKAGE_DIR,
    agentDir: join(tmpdir(), 'pi-rea-agent-empty'),
    skillPaths: [join(PACKAGE_DIR, 'skills')],
    includeDefaults: false,
  });
  expect(diagnostics).toStrictEqual([]);
  expect(skills.map((skill) => skill.name)).toContain('reverse-engineer-anything');
  const skill = skills.find((candidate) => candidate.name === 'reverse-engineer-anything');
  expect(skill?.description.length ?? 0).toBeGreaterThan(20);
});
