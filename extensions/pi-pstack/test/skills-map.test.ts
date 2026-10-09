import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { loadAllSkills } from '../src/skills-map.ts';

const root = process.cwd();

describe('loadAllSkills', () => {
  test('loads every bundled and host skill with its path, body, and description', async () => {
    const skills = await loadAllSkills(root, 'local');
    for (const name of ['how', 'arena', 'poteto-mode', 'setup-pstack', 'origin', 'create-skill', 'goal']) {
      const skill = skills.get(name);
      expect(skill, name).toBeDefined();
      expect(skill?.path).toBe(join(root, name === 'how' || name === 'arena' || name === 'poteto-mode' || name === 'setup-pstack' ? 'skills' : 'host/skills', name, 'SKILL.md'));
      expect(skill?.body.length).toBeGreaterThan(0);
      expect(typeof skill?.description).toBe('string');
    }
  });

  test('every loaded entry is available in the requested environment and names are unique', async () => {
    const skills = await loadAllSkills(root, 'local');
    expect(skills.size).toBeGreaterThan(60);
    for (const [name, skill] of skills) {
      expect(skill.path.endsWith(`${name}/SKILL.md`), skill.path).toBe(true);
    }
  });
});