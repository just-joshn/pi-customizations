import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { PKG } from './helpers.ts';

const gen = (path: string) => readFileSync(join(PKG, 'generated', path), 'utf8');
const line = (path: string, n: number) => gen(path).split('\n')[n - 1] ?? '';

describe('readonly investigators and reviewers (defect 1)', () => {
  test('why spawns every worker readonly with MCP kept and git/gh through bash_readonly', () => {
    const text = line('skills/why/SKILL.md', 13);
    expect(text).toContain('`workspace.mode: "readonly"`');
    expect(text).toContain('`capabilities.mcp: "inherit"`');
    expect(text).toContain('`bash_readonly`');
    expect(text).not.toContain('"worktree"');
    expect(text).toContain("Investigators still shouldn't write anything.");
  });

  test('a readonly worker has bash_readonly and reports through its final reply, not report.md', () => {
    expect(line('skills/poteto-mode/SKILL.md', 97)).toMatch(/`\{ mode: "readonly", path \}` for a worker limited to `read`, `grep`, `find`, `ls`, `bash_readonly`/);
    for (const role of ['poteto.md', 'comment-sicko.md', 'general.md']) expect(gen(`agents/${role}`)).toContain('A readonly worker cannot write files. Its final reply is its report');
    expect(gen('skills/reflect/SKILL.md')).toContain('Reviewers return findings in their final reply, which `collect` returns.');
  });

  test('how explorers and reflect reviewers stay readonly', () => {
    expect(gen('skills/how/SKILL.md')).toContain('`workspace.mode: "readonly"`');
    expect(gen('skills/reflect/SKILL.md')).toMatch(/`role: "reviewer"`, `workspace.mode: "readonly"`, and `capabilities.mcp: "inherit"`/);
  });
});
