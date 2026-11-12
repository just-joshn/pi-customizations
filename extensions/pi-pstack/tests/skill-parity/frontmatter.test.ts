import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { frontmatterProblems } from '../../adapters/skill-transforms.ts';
import { PKG } from './helpers.ts';

const skills = readdirSync(join(PKG, 'generated/skills'));

describe('frontmatter', () => {
  test.for(skills)('%s has valid Agent Skills frontmatter whose name matches its directory', (name) => {
    const text = readFileSync(join(PKG, 'generated/skills', name, 'SKILL.md'), 'utf8');
    expect(frontmatterProblems(text, name, name)).toEqual([]);
  });

  test('the check rejects a Cursor-only field and a mismatched name', () => {
    const text = '---\nname: other\ndescription: d\npaths: ["**/*.ts"]\n---\nbody\n';
    expect(frontmatterProblems(text, 'mine', 'f')).toEqual(['f: frontmatter field "paths" is not an Agent Skills field', 'f: name "other" does not match directory "mine"']);
  });
});
