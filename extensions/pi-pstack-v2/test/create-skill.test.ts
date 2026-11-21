import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { validateSkillFile } from '../src/create-skill.ts';
import { createWorld, type Host, loadPstack, type World } from './core-host.ts';

let world: World;
let host: Host;

beforeEach(() => {
  world = createWorld();
  host = loadPstack(world);
});

afterEach(() => {
  world.dispose();
});

describe('validateSkillFile', () => {
  test('accepts a valid SKILL.md whose name matches its folder and whose relative links exist', () => {
    const dir = join(world.cwd, 'my-skill');
    mkdirSync(join(dir, 'references'), { recursive: true });
    writeFileSync(join(dir, 'references', 'guide.md'), '# Guide\n');
    const skillPath = join(dir, 'SKILL.md');
    writeFileSync(skillPath, '---\nname: my-skill\ndescription: Does a thing.\n---\n\nSee [guide](references/guide.md) and [docs](https://example.com).\n');
    expect(validateSkillFile(skillPath)).toEqual({ ok: true, errors: [] });
  });

  test('rejects mismatched folder name, missing description, and broken relative links', () => {
    const dir = join(world.cwd, 'actual-folder');
    mkdirSync(dir, { recursive: true });
    const skillPath = join(dir, 'SKILL.md');
    writeFileSync(skillPath, '---\nname: wrong-name\n---\n\nSee [missing](references/nope.md).\n');
    const result = validateSkillFile(skillPath);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('name "wrong-name" does not match directory "actual-folder"');
    expect(result.errors).toContain('frontmatter is missing required field: description');
    expect(result.errors).toContain('broken relative link: references/nope.md');
  });

  test('supports multiline YAML descriptions, rejects empty folded scalars, and ignores links inside code blocks', () => {
    const dir = join(world.cwd, 'yaml-skill');
    mkdirSync(dir, { recursive: true });
    const skillPath = join(dir, 'SKILL.md');
    writeFileSync(skillPath, '---\nname: yaml-skill\ndescription: |\n  First line.\n  Second line.\n---\n\nInline `[ex](missing.md)`.\n\n```md\n[fenced](also-missing.md)\n```\n');
    expect(validateSkillFile(skillPath)).toEqual({ ok: true, errors: [] });

    const emptyDir = join(world.cwd, 'empty-desc');
    mkdirSync(emptyDir, { recursive: true });
    const emptyPath = join(emptyDir, 'SKILL.md');
    writeFileSync(emptyPath, '---\nname: empty-desc\ndescription: >\n---\n\nBody.\n');
    expect(validateSkillFile(emptyPath).ok).toBe(false);
  });

  test('returns a clean error for directory paths and validates name/description independently', () => {
    const dir = join(world.cwd, 'dir-only');
    mkdirSync(dir, { recursive: true });
    expect(validateSkillFile(dir).ok).toBe(false);

    const numDir = join(world.cwd, 'num-name');
    mkdirSync(numDir, { recursive: true });
    const numPath = join(numDir, 'SKILL.md');
    writeFileSync(numPath, '---\nname: 123\ndescription: Valid description.\n---\n\nBody.\n');
    const res = validateSkillFile(numPath);
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('frontmatter is missing required field: name');
    expect(res.errors).not.toContain('frontmatter is missing required field: description');
  });
});

describe('create-skill command', () => {
  test('validate reports valid and invalid skills', async () => {
    const dir = join(world.cwd, 'sample-skill');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: sample-skill\ndescription: Sample.\n---\n\nBody.\n');
    await host.command('create-skill').handler('validate sample-skill', host.ctx());
    expect(host.notify).toHaveBeenLastCalledWith(expect.stringContaining('Valid skill:'), 'info');
  });

  test('passing a goal invokes the create-skill workflow via sendUserMessage', async () => {
    await host.command('create-skill').handler('deploy-checker for release gates', host.ctx());
    expect(host.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining('deploy-checker for release gates'));
  });
});
