import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatSkillsForPrompt, loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

async function hiddenFlag(path: string): Promise<boolean> {
  const text = await readFile(join(root, path, 'SKILL.md'), 'utf8');
  return /^disable-model-invocation: true\s*$/m.test(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '');
}

async function directories(path: string): Promise<string[]> {
  return (await readdir(join(root, path), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

test('generation keeps every upstream model-invocation flag, so the generated flag matches its source for each skill', async () => {
  const mismatches: string[] = [];
  for (const source of ['upstream/skills', 'upstream-team-kit/skills']) {
    for (const name of await directories(source)) {
      if (name === 'bro') continue;
      if ((await hiddenFlag(`${source}/${name}`)) !== (await hiddenFlag(`skills/${name}`))) mismatches.push(name);
    }
  }
  expect(mismatches).toEqual([]);
});

test('setup-pstack is the only pstack skill the model may invoke on its own', async () => {
  const ambient: string[] = [];
  for (const name of await directories('upstream/skills')) if (name !== 'bro' && !(await hiddenFlag(`skills/${name}`))) ambient.push(name);
  expect(ambient).toEqual(['setup-pstack']);
});

test('typescript-best-practices stays hidden from the model and keeps no Cursor path trigger', async () => {
  expect(await hiddenFlag('skills/typescript-best-practices')).toBe(true);
  const text = await readFile(join(root, 'skills/typescript-best-practices/SKILL.md'), 'utf8');
  expect(text).not.toMatch(/^paths:/m);
});

test('the Pi skill loader reports every hidden skill as disabled and leaves it out of the model prompt', async () => {
  const { skills } = loadSkillsFromDir({ dir: join(root, 'skills'), source: 'pstack' });
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const hidden = ['architect', 'figure-it-out', 'show-me-your-work', 'teach', 'recall', 'blast-radius', 'typescript-best-practices'];
  for (const name of hidden) expect({ name, disabled: byName.get(name)?.disableModelInvocation }).toEqual({ name, disabled: true });
  const prompt = formatSkillsForPrompt(skills);
  for (const name of hidden) expect(prompt).not.toContain(`<name>${name}</name>`);
  expect(prompt).toContain('<name>setup-pstack</name>');
});

test('all 23 principle skills load as disabled and none reaches the model-visible skill list', async () => {
  const principles = (await directories('skills')).filter((name) => name.startsWith('principle-'));
  expect(principles).toHaveLength(23);
  const { skills } = loadSkillsFromDir({ dir: join(root, 'skills'), source: 'pstack' });
  const prompt = formatSkillsForPrompt(skills);
  for (const name of principles) {
    expect({ name, disabled: skills.find((skill) => skill.name === name)?.disableModelInvocation }).toEqual({ name, disabled: true });
    expect(prompt).not.toContain(`<name>${name}</name>`);
  }
});
