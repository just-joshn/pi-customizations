import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { PKG } from './helpers.ts';

const gen = (path: string) => readFileSync(join(PKG, 'generated', path), 'utf8');
const listMarkdown = (dir: string): string[] =>
  readdirSync(join(PKG, 'generated', dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.md'))
    .map((f) => `${dir}/${f}`);
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

describe('nested spawning (defect 2)', () => {
  const NEVER_SPAWN = [/cannot spawn workers/i, /\bnever spawn workers\b/i, /no `pstack_worker` tool, so (?:you|it) /, /workers? (?:can never|cannot|can't) spawn/i];

  test('no generated text claims workers can never spawn', () => {
    const files = ['agents/poteto.md', 'agents/comment-sicko.md', 'agents/general.md', ...listMarkdown('skills')];
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) for (const claim of NEVER_SPAWN) expect(`${file}: ${gen(file).match(claim)?.[0] ?? ''}`).toBe(`${file}: `);
  });

  test('workers lack pstack_worker by default, and capabilities.spawn grants it within three levels', () => {
    for (const text of [gen('agents/poteto.md'), line('skills/poteto-mode/SKILL.md', 97)]) {
      expect(text).toMatch(/no `pstack_worker` tool by default/i);
      expect(text).toContain('`capabilities.spawn: true`');
      expect(text).toMatch(/three levels/);
    }
    expect(gen('agents/poteto.md')).toContain('their wakes come to you');
  });

  test('orchestrate gives a sub-coordinator spawn and maps fork to a fresh worker from the source branch', () => {
    expect(line('skills/poteto-mode/playbooks/orchestrate.md', 11)).toContain('`capabilities.spawn: true`');
    const fork = line('skills/poteto-mode/playbooks/orchestrate.md', 12);
    expect(fork).toMatch(/^- \*\*Fork when new work needs a worker's built state,\*\*/);
    expect(fork).toContain('once that worker settles');
    expect(fork).toContain("`workspace.inputCommit` is the source worker's worktree `HEAD`");
    expect(fork).toContain('Steer a worker only for a follow-up on the same work.');
  });
});
