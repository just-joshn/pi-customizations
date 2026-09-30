import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { skillCatalog } from '../src/catalog.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

test('catalog maps skill, host skill, and playbook names to their files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pstack-catalog-'));
  try {
    for (const path of ['skills/how/SKILL.md', 'skills/poteto-mode/SKILL.md', 'skills/poteto-mode/playbooks/feature.md', 'skills/poteto-mode/playbooks/bug-fix.md', 'host/skills/goal/SKILL.md']) {
      await mkdir(join(dir, path, '..'), { recursive: true });
      await writeFile(join(dir, path), '');
    }
    expect(await skillCatalog(dir)).toBe(
      [
        `A workflow that names a skill, such as "the how skill", "/deslop", or a principle such as Prove It Works (principle-prove-it-works), means the file ${dir}/skills/<name>/SKILL.md. Read it in full before applying it and resolve its references relative to its directory. Skills: how, poteto-mode.`,
        `Host skills live at ${dir}/host/skills/<name>/SKILL.md: goal.`,
        `Playbooks live at ${dir}/skills/poteto-mode/playbooks/<name>.md: bug-fix, feature.`,
      ].join('\n'),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every name the shipped catalog lists resolves to an existing file', async () => {
  const catalog = await skillCatalog(root);
  const [skills, host, playbooks] = catalog.split('\n').map((line) => line.slice(line.lastIndexOf(': ') + 2, -1).split(', '));
  expect(skills).toContain('how');
  expect(skills).toContain('principle-prove-it-works');
  expect(skills).toContain('deslop');
  expect(host).toEqual(['create-skill', 'goal', 'loop', 'origin']);
  expect(playbooks).toHaveLength(23);
  for (const name of skills ?? []) expect(existsSync(join(root, 'skills', name, 'SKILL.md'))).toBe(true);
  for (const name of host ?? []) expect(existsSync(join(root, 'host/skills', name, 'SKILL.md'))).toBe(true);
  for (const name of playbooks ?? []) expect(existsSync(join(root, 'skills/poteto-mode/playbooks', `${name}.md`))).toBe(true);
});
