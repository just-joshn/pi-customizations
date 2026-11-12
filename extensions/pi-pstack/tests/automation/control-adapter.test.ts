import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';
import { controlProbes, controlSkillProblem } from '../../src/automation/control-adapter.ts';
import { resolveSkill } from '../../src/automation/skills.ts';

let root: string;
let project: string;
let home: string;
let pkg: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'control-skill-')));
  project = join(root, 'repo', 'app');
  home = join(root, 'home');
  pkg = join(root, 'pkg');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(root, 'repo', '.git'));
  mkdirSync(home);
  mkdirSync(join(pkg, 'generated', 'skills', 'control-ui'), { recursive: true });
  writeFileSync(join(pkg, 'generated', 'skills', 'control-ui', 'SKILL.md'), '---\nname: control-ui\ndescription: x\n---\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const skill = (dir: string, name: string) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Drives the app.\n---\n`);
  return join(dir, name, 'SKILL.md');
};
const where = () => ({ projectRoot: project, home, packageRoot: pkg });

test.for([
  ['the project .pi/skills directory', () => skill(join(project, '.pi', 'skills'), 'control-target-app')],
  ['the project .agents/skills directory', () => skill(join(project, '.agents', 'skills'), 'control-target-app')],
  ['a .agents/skills directory of an ancestor up to the repository root', () => skill(join(root, 'repo', '.agents', 'skills'), 'control-target-app')],
  ['the user .pi/agent/skills directory', () => skill(join(home, '.pi', 'agent', 'skills'), 'control-target-app')],
  ['the user .agents/skills directory', () => skill(join(home, '.agents', 'skills'), 'control-target-app')],
  ['a nested directory under a skills location', () => skill(join(project, '.pi', 'skills', 'team', 'ui'), 'control-target-app')],
  ['the skills this package ships', () => skill(join(pkg, 'generated', 'skills'), 'control-target-app')],
] as const)('a project-owned control skill is found in %s', async ([, make]) => {
  const file = make();
  expect(resolveSkill('control-target-app', where())).toEqual({ ok: true, path: file });
  expect(controlSkillProblem('control-target-app', where())).toBeUndefined();
  await expect(controlProbes(project, { skillName: 'control-target-app', featureMapPath: 'f.md' }, { home, packageRoot: pkg }).controlAdapter()).resolves.toBe(true);
});

test('a skill outside every Pi skill location is not found, and the problem names where Pi looked', () => {
  skill(join(root, 'elsewhere'), 'control-target-app');
  skill(join(root, 'repo', '..', 'other', '.agents', 'skills'), 'control-target-app');
  const problem = controlSkillProblem('control-target-app', where());
  expect(problem).toContain('control skill control-target-app');
  expect(problem).toContain(join(project, '.pi', 'skills'));
  expect(problem).toContain(join(home, '.pi', 'agent', 'skills'));
});

test('the shipped control skills still resolve', () => {
  expect(controlSkillProblem('control-ui', where())).toBeUndefined();
});

test.for(['../../README', '..', '../skills/control-ui', '/etc/passwd', 'Control-UI', 'a b', '', 'x'.repeat(65), 'control-ui/../../../etc'])('the path-escape refusal holds for the skill name %j', (name) => {
  writeFileSync(join(root, 'README'), 'x');
  skill(join(project, '.pi', 'skills'), 'control-ui');
  const result = resolveSkill(name, where());
  expect(result).toMatchObject({ ok: false });
  expect(controlSkillProblem(name, where())).toMatch(/is not a skill name/);
});

test('a directory without a SKILL.md file is not a skill', () => {
  mkdirSync(join(project, '.pi', 'skills', 'control-target-app'), { recursive: true });
  expect(resolveSkill('control-target-app', where())).toMatchObject({ ok: false });
});
