import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { buildDependencyManifest } from '../../adapters/dependencies.ts';
import { PKG } from './helpers.ts';

const generated = (...parts: string[]) => join(PKG, 'generated', ...parts);
const skillDirs = readdirSync(generated('skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

describe('inventory', () => {
  const deps = buildDependencyManifest(PKG);

  test('upstream source holds 34 primary skills, 24 principles, 23 playbooks, and 2 agents', () => {
    expect(deps.counts).toMatchObject({ primary: 34, principle: 24, playbooks: 23, agents: 2 });
  });

  test('generated skills cover every pstack skill plus the required team-kit set', () => {
    const pstack = deps.skills.filter((s) => s.origin === 'pstack');
    expect(pstack.filter((s) => s.kind === 'primary').every((s) => skillDirs.includes(s.name))).toBe(true);
    expect(skillDirs.filter((name) => name.startsWith('principle-'))).toHaveLength(24);
    expect(deps.requiredTeamKit.map((s) => s.name).sort()).toEqual(['control-cli', 'control-ui', 'deslop', 'verify-this']);
    expect(skillDirs.sort()).toEqual([...pstack.map((s) => s.name), 'control-cli', 'control-ui', 'deslop', 'verify-this'].sort());
  });

  test('generated poteto-mode keeps all 23 playbooks', () => {
    expect(readdirSync(generated('skills/poteto-mode/playbooks')).filter((f) => f.endsWith('.md'))).toHaveLength(23);
  });

  test('both upstream agents become worker roles beside the general role', () => {
    expect(['poteto.md', 'comment-sicko.md', 'general.md'].filter((f) => existsSync(generated('agents', f)))).toHaveLength(3);
  });

  test('every generated skill has a prompt alias of the same name', () => {
    expect(
      readdirSync(generated('prompts'))
        .map((f) => f.replace(/\.md$/, ''))
        .sort(),
    ).toEqual(skillDirs.sort());
  });
});
