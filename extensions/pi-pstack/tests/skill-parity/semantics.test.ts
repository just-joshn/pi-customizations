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

describe('container workers (defect 3)', () => {
  const SHAPE = '`workspace: { mode: "container", inputCommit';

  test.for([
    ['skills/swarm/SKILL.md', 27, 'fallback'],
    ['skills/poteto-mode/playbooks/orchestrate.md', 10, 'fallback'],
    ['skills/poteto-mode/playbooks/multi-phase-plan.md', 71, 'fallback'],
    ['skills/poteto-mode/playbooks/shipping.md', 5, 'blocked'],
    ['skills/poteto-mode/playbooks/autopilot-full.md', 8, 'blocked'],
  ] as const)('%s:%i names the container shape and its ContainerUnavailable %s', ([file, n, outcome]) => {
    const text = line(file, n);
    expect(text).toContain(SHAPE);
    expect(text).toContain('`ContainerUnavailable`');
    if (outcome === 'fallback') expect(text).toMatch(/`ContainerUnavailable`[^.]*`workspace: \{ mode: "worktree", inputCommit/);
    else expect(text).toMatch(/`ContainerUnavailable`[^.]*blocked/);
  });

  test('poteto-mode defines the container shape and the refusal', () => {
    const text = line('skills/poteto-mode/SKILL.md', 97);
    expect(text).toContain(SHAPE);
    expect(text).toContain('`ContainerUnavailable`');
    expect(text).toMatch(/without one reports itself blocked/);
  });

  test('every container worker an engineering step requires names its shape and refusal', () => {
    const offenders = listMarkdown('skills')
      .filter((f) => !f.startsWith('skills/poteto-help/'))
      .flatMap((f) => gen(f).split('\n').map((text, i) => ({ at: `${f}:${i + 1}`, text })))
      .filter(({ text }) => /container worker|mode: "container"/.test(text) && !(text.includes(SHAPE) && text.includes('ContainerUnavailable')))
      .map(({ at }) => at);
    expect(offenders).toEqual([]);
  });
});

describe('no-comments scope transfer (defect 4)', () => {
  test('moves the scoped diff into the comment-sicko worktree and back as patches without committing caller work', () => {
    const step = line('skills/no-comments/SKILL.md', 19);
    expect(step).toMatch(/^1\. /);
    expect(step).toContain('`role: "comment-sicko"`');
    expect(step).not.toMatch(/commit or copy|git commit/i);
    expect(step).toContain('without committing');
    expect(step).toContain('`git diff <inputCommit> -- <scoped paths>`');
    expect(step).toContain('`git diff --no-index /dev/null <file>`');
    expect(step).toContain('`git apply --index');
    expect(step).toContain('`git apply`');
    expect(step).toContain('unrelated and uncommitted caller state untouched');
  });
});

describe('recurring watch loops (defect 5)', () => {
  test.for([
    ['skills/poteto-mode/playbooks/multi-phase-plan.md', 41, "until the plan's stop condition holds"],
    ['skills/poteto-mode/playbooks/autopilot-full.md', 22, 'until no delegated work is left'],
  ] as const)('%s:%i re-spawns the hourly sleep watch after each wake and re-arms after a restart', ([file, n, stop]) => {
    const text = line(file, n);
    expect(text).toContain('`watch.argv: ["sleep", "3600"]`');
    expect(text).toMatch(/spawn a fresh one after each wake/);
    expect(text).toContain(stop);
    expect(text).toMatch(/After a parent restart, re-arm it from/);
  });

  test('poteto-mode states a watch fires once and is re-armed after a parent restart', () => {
    const text = line('skills/poteto-mode/SKILL.md', 97);
    expect(text).toContain('A watch fires once.');
    expect(text).toContain('Spawn it again after each wake until the stop predicate holds.');
    expect(text).toMatch(/After a parent restart, re-arm each open watch loop from the run's `TODO.md` or plan/);
  });
});
