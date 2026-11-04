import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createPathSkills, loadPathSkills, matchPathSkills, pathSkillsSection } from '../src/path-skills.ts';

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'path-skills-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const command = (name: string, frontmatter: string, body = '# Rules\nUse strict types.') => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'SKILL.md');
  writeFileSync(file, `---\nname: ${name}\ndescription: x\n${frontmatter}\n---\n\n${body}\n`);
  return { name: `skill:${name}`, source: 'skill', sourceInfo: { path: file } };
};

test('only skills that declare paths or globs are path-scoped', () => {
  const skills = loadPathSkills([
    command('typed', 'paths: ["**/*.ts", "**/*.tsx"]'),
    command('globbed', 'globs: "**/*.md, **/*.mdx"'),
    command('nested', 'metadata:\n  paths: ["**/*.ts"]'),
    command('plain', ''),
    { name: 'plan', source: 'extension', sourceInfo: { path: join(root, 'typed/SKILL.md') } },
  ]);
  expect(skills.map((skill) => [skill.name, skill.globs])).toEqual([
    ['typed', ['**/*.ts', '**/*.tsx']],
    ['globbed', ['**/*.md', '**/*.mdx']],
    ['nested', ['**/*.ts']],
  ]);
});

test('a path matches a glob relative to the workspace, and a path outside it is ignored', () => {
  const skills = loadPathSkills([command('typed', 'paths: ["**/*.ts"]')]);
  expect(matchPathSkills(skills, ['src/a.ts', 'a.ts', 'src/a.tsx'], root).map((skill) => skill.name)).toEqual(['typed']);
  expect(matchPathSkills(skills, [join(root, 'src/a.ts')], root).map((skill) => skill.name)).toEqual(['typed']);
  expect(matchPathSkills(skills, ['../outside.ts'], root)).toEqual([]);
});

test('a session attaches a matching skill once, when a matching file is read or edited', () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
  const skills = loadPathSkills([command('typed', 'paths: ["**/*.ts"]')]);
  const pi = {
    on: (name: string, handler: (event: unknown, ctx: unknown) => void) => handlers.set(name, handler),
    getCommands: () => skills.map((skill) => ({ name: `skill:${skill.name}`, source: 'skill', sourceInfo: { path: skill.file } })),
  } as unknown as ExtensionAPI;
  const ctx = { cwd: root };

  const controller = createPathSkills(pi);
  handlers.get('session_start')?.({ type: 'session_start' }, ctx);
  expect(controller.section()).toBeUndefined();
  handlers.get('tool_call')?.({ type: 'tool_call', toolName: 'bash', input: { command: 'touch a.ts' } }, ctx);
  expect(controller.section()).toBeUndefined();
  handlers.get('tool_call')?.({ type: 'tool_call', toolName: 'read', input: { path: 'a.ts' } }, ctx);
  const section = controller.section();
  expect([section?.startsWith('<skill name="typed"'), section?.includes('Use strict types.')]).toEqual([true, true]);
  expect(controller.section()).toBeUndefined();
  handlers.get('session_start')?.({ type: 'session_start' }, ctx);
  handlers.get('tool_call')?.({ type: 'tool_call', toolName: 'edit', input: { path: 'b.ts' } }, ctx);
  expect(controller.section()).toContain('<skill name="typed"');
});

test('the section keeps the skill block shape and stops before the size cap', () => {
  const huge = command('huge', 'paths: ["**/*.ts"]', 'x'.repeat(50_000));
  const skills = loadPathSkills([huge]);
  expect(pathSkillsSection(skills)).toBeUndefined();
  expect(pathSkillsSection([])).toBeUndefined();
});

test('the shipped TypeScript skill attaches for .ts and .tsx paths and not for another extension', async () => {
  const { SKILLS_DIR } = await import('../src/paths.ts');
  const skills = loadPathSkills([{ name: 'skill:typescript-best-practices', source: 'skill', sourceInfo: { path: join(SKILLS_DIR, 'typescript-best-practices/SKILL.md') } }]);
  expect(skills.map((skill) => skill.globs)).toEqual([['**/*.ts', '**/*.tsx']]);
  expect(matchPathSkills(skills, ['src/a.ts', 'src/a.tsx'], '/work')).toHaveLength(1);
  expect(matchPathSkills(skills, ['src/a.md'], '/work')).toEqual([]);
});
