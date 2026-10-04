import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFile(join(root, path), 'utf8');
const guideDirectory = join(root, 'docs/guide');
const chapters = ['01-setup', '02-poteto-mode', '03-understand', '04-design', '05-build-and-clean', '06-verify-and-ship', '07-overnight', '08-principles', '09-make-it-yours', '10-recipes-and-pitfalls'];
const routedSkills = [
  'poteto-mode',
  'how',
  'why',
  'recall',
  'blast-radius',
  'architect',
  'arena',
  'swarm',
  'interrogate',
  'automate-me',
  'make-bot-ui',
  'setup-pstack',
  'reflect',
  'teach',
  'tdd',
  'no-comments',
  'typescript-best-practices',
  'figure-it-out',
  'show-me-your-work',
  'create-verification-skill',
  'maintain-verification-skill',
  'unslop',
  'technical-writing',
];

async function guideTexts() {
  const names = (await readdir(guideDirectory)).filter((name) => name.endsWith('.md')).sort();
  return Promise.all(names.map(async (name) => ({ name, text: await readFile(join(guideDirectory, name), 'utf8') })));
}

test('README lists every playbook in the playbooks directory', async () => {
  const readme = await read('README.md');
  const files = (await readdir(join(root, 'skills/poteto-mode/playbooks'))).filter((name) => name.endsWith('.md')).sort();
  expect(files).toHaveLength(23);
  for (const file of files) expect(readme).toContain(`(skills/poteto-mode/playbooks/${file})`);
});

test('README shows twenty one-line example prompts', async () => {
  const readme = await read('README.md');
  const section = readme.split('\n## Example prompts\n')[1]?.split('\n## ')[0] ?? '';
  const prompts = section.split('\n').filter((line) => line.startsWith('/'));
  expect(prompts).toHaveLength(20);
  expect(new Set(prompts).size).toBe(20);
});

test('README direct-use table has a row for each routed skill', async () => {
  const readme = await read('README.md');
  const table = readme.split('\n## Skills to use directly\n')[1]?.split('\n## ')[0] ?? '';
  for (const skill of routedSkills) expect(table).toContain(`(skills/${skill}/SKILL.md)`);
  expect(table).toContain('| [`/reflect`](skills/reflect/SKILL.md) | a long task landed and you want the recipe captured as a skill edit.');
});

test('README names make-bot-ui and its routine adapter', async () => {
  const readme = await read('README.md');
  expect(readme).toContain('[`/make-bot-ui`](skills/make-bot-ui/SKILL.md)');
  expect(readme).toContain('host/adapters/make-bot-ui/SKILL.md');
  expect(readme).toContain('RoutinePrepare');
});

test('README identifies the authoritative generated-resource inventory', async () => {
  const readme = await read('README.md');
  expect(readme).toContain('`skills/` and `prompts/` are generated from both snapshots.');
  expect(readme).toContain('[The resource map](docs/resource-map.json) lists every generated file and transformation.');
});

test('README links the Pi guide', async () => {
  const readme = await read('README.md');
  expect(readme).toContain('[pstack guide](docs/guide/README.md)');
});

test('the guide index links each of the ten shipped chapters', async () => {
  const index = await read('docs/guide/README.md');
  for (const chapter of chapters) {
    expect(existsSync(join(guideDirectory, `${chapter}.md`))).toBe(true);
    expect(index).toContain(`(./${chapter}.md)`);
  }
});

test('no guide page keeps a .upstream/ path or /add-plugin', async () => {
  for (const { name, text } of await guideTexts()) {
    expect(text, name).not.toContain('.upstream/');
    expect(text, name).not.toContain('/add-plugin');
    expect(text, name).not.toMatch(new RegExp(['cur', 'sor'].join(''), 'i'));
  }
});

test('the guide setup page uses Pi install and model rule paths', async () => {
  const setup = await read('docs/guide/01-setup.md');
  expect(setup).toContain('pi install ./extensions/pi-pstack');
  expect(setup).toContain('~/.pi/agent/pstack/models.mdc');
  expect(setup).toContain('.pi/skills/verify-<app>/');
});

test('every relative link in the guide resolves to a file', async () => {
  const missing: string[] = [];
  for (const { name, text } of await guideTexts()) {
    for (const match of text.matchAll(/\]\((\.[^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (!existsSync(join(guideDirectory, dirname(name), match[1]))) missing.push(`${name} -> ${match[1]}`);
    }
  }
  expect(missing.join('\n')).toBe('');
});

test('the guide links all twenty-three playbooks', async () => {
  const joined = (await guideTexts()).map((page) => page.text).join('\n');
  const files = (await readdir(join(root, 'skills/poteto-mode/playbooks'))).filter((name) => name.endsWith('.md'));
  const unlinked = files.filter((file) => !joined.includes(`skills/poteto-mode/playbooks/${file}`));
  expect(unlinked.join('\n')).toBe('');
});

test('the guide includes all twenty-four current-source principles', async () => {
  const principles = await read('docs/guide/08-principles.md');
  const index = await read('docs/guide/README.md');
  expect(principles).toContain('pstack ships 24 principles');
  expect(principles).toContain('## The 24, briefly');
  expect([...principles.matchAll(/^- \[[^\]]+\]\(\.\.\/\.\.\/skills\/principle-/gm)]).toHaveLength(24);
  expect(principles).toContain('[Explain the Number](../../skills/principle-explain-the-number/SKILL.md) names what limits a measured number and rules out that it measured something else, before anyone trusts or reports it.');
  expect(index).toContain('The 24 names that redirect an agent mid-task.');
});

test('the guide mentions make-bot-ui', async () => {
  const joined = (await guideTexts()).map((page) => page.text).join('\n');
  expect(joined).toContain('/make-bot-ui');
});

test('the guide verify page routes a full verify pass to swarm', async () => {
  expect(await read('docs/guide/06-verify-and-ship.md')).toContain('/swarm');
});

test('the guide overnight page arms /goal for the stop predicate', async () => {
  const overnight = await read('docs/guide/07-overnight.md');
  expect(overnight).toContain('/goal');
  expect(overnight).toContain('BackgroundShell');
});
