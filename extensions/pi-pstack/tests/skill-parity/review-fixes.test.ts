import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Api, Model } from '@earendil-works/pi-ai';
import { parse } from 'yaml';
import { describe, expect, test } from 'vitest';
import * as automationEvents from '../../adapters/automation-events.ts';
import { buildBrief } from '../../src/automation/dispatch.ts';
import { defaultCredentialFile } from '../../src/automation/credentials.ts';
import { parseEvent } from '../../src/automation/model.ts';
import * as webhook from '../../src/automation/webhook.ts';
import { parseModelsConfig, resolveRole } from '../../src/models.ts';
import { parseAssignment, THINKING_LEVELS } from '../../src/run-files.ts';
import { PKG } from './helpers.ts';

const gen = (path: string) => readFileSync(join(PKG, 'generated', path), 'utf8');
const line = (path: string, n: number) => gen(path).split('\n')[n - 1] ?? '';
const skillMarkdown = readdirSync(join(PKG, 'generated/skills'), { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.md'))
  .map((f) => `skills/${f}`);
const allLines = skillMarkdown.flatMap((f) => gen(f).split('\n').map((text, i) => ({ at: `${f}:${i + 1}`, text })));
const frontmatter = (text: string) => parse(/^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? '') as Record<string, unknown>;
const REFERENCE = 'skills/poteto-mode/references/worker-assignment.md';
const referenceExamples = () =>
  [...gen(REFERENCE).matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1] ?? '') as Record<string, unknown> & { workspace: { mode: string }; kind: string });

describe('A: poteto-mode workers and watches', () => {
  test('A1/A4: the worker-assignment reference holds a complete example per workspace mode and kind, each valid under parseAssignment', () => {
    const examples = referenceExamples();
    expect(new Set(examples.map((e) => e.workspace.mode))).toEqual(new Set(['worktree', 'readonly', 'container']));
    expect(new Set(examples.map((e) => e.kind))).toEqual(new Set(['pi', 'watch']));
    for (const example of examples) {
      if (example.workspace.mode === 'container') {
        expect(() => parseAssignment(example)).toThrow(/workspace/);
        expect(parseAssignment({ ...example, workspace: { mode: 'worktree', inputCommit: '4f2c1a9e0b7d3c5a8e6f1b2d4c9a7e3f5b1d8c6a' } })).toMatchObject({ kind: example.kind, role: example['role'] });
      } else expect(parseAssignment(example)).toEqual(example);
    }
  });

  test('A4: the Workers paragraph names every field the parser requires, says skills and thinkingLevel are required, and points at the reference', () => {
    const workers = line('skills/poteto-mode/SKILL.md', 97);
    const fields = new Set(referenceExamples().flatMap((e) => Object.keys(e)));
    for (const field of fields) expect(workers).toContain(`\`${field === 'brief' ? 'brief: "brief.md"' : field === 'watch' ? 'watch: { argv, cwd }' : field === 'schemaVersion' ? 'schemaVersion: 1' : field}\``);
    expect(workers).toMatch(/`skills` and `thinkingLevel` are required/);
    expect(workers).toContain('`references/worker-assignment.md`');
  });

  test.for([
    'skills/poteto-mode/playbooks/autopilot-full.md',
    'skills/poteto-mode/playbooks/multi-phase-plan.md',
    'skills/poteto-mode/playbooks/babysit.md',
    'skills/poteto-mode/playbooks/shipping.md',
    'skills/poteto-mode/playbooks/worktree-cleanup.md',
    'skills/poteto-mode/playbooks/autonomous-run.md',
    'skills/poteto-mode/playbooks/bug-fix.md',
    'skills/poteto-mode/playbooks/orchestrate.md',
  ])('A1: %s spawns its watch with role, an absolute cwd, and the reference', (file) => {
    const watch = gen(file)
      .split('\n')
      .filter((text) => text.includes('`kind: "watch"`'));
    expect(watch.length).toBeGreaterThan(0);
    for (const text of watch) {
      expect(text).toContain('`role: "watcher"`');
      expect(text).toContain('`watch.cwd: "<absolute repository root>"`');
      expect(text).toContain('`<pi-pstack>/generated/skills/poteto-mode/references/worker-assignment.md`');
    }
  });

  test('A1/A2: every watch.argv names scripts by absolute path', () => {
    const relative = allLines.flatMap(({ at, text }) =>
      [...text.matchAll(/`watch\.argv: (\[[^`]*\])`/g)].flatMap((m) =>
        [...(m[1] ?? '').matchAll(/(?:^|[\s"[])([\w.<>-]*\/[\w./<>-]+)/g)].map((p) => p[1] ?? '').filter((p) => !p.startsWith('/') && !p.startsWith('<pi-pstack>/') && !p.startsWith('<absolute')).map((p) => `${at} ${p}`),
      ),
    );
    expect(relative).toEqual([]);
  });

  test('A2: worktree-cleanup runs the audit script from the package by absolute path in the repository root', () => {
    const step = line('skills/poteto-mode/playbooks/worktree-cleanup.md', 3);
    expect(step).not.toMatch(/`scripts\/worktree-audit\.sh/);
    expect(step).toContain('then run `<pi-pstack>/generated/skills/poteto-mode/scripts/worktree-audit.sh [-b <pr-base-ref>] [repo-path]` from the repository root');
  });

  test('every <pi-pstack> path in generated text exists in the package', () => {
    const missing = allLines.flatMap(({ at, text }) =>
      [...text.matchAll(/<pi-pstack>\/([\w./-]+[\w-])/g)].map((m) => m[1] ?? '').filter((p) => !existsSync(join(PKG, p))).map((p) => `${at} ${p}`),
    );
    expect(missing).toEqual([]);
  });

  test('A3: orchestrate forks a container worker only from its pushed head and reports the fork blocked otherwise', () => {
    const fork = line('skills/poteto-mode/playbooks/orchestrate.md', 12);
    expect(fork).toContain('For a local worktree worker (`workspace.mode: "worktree"`), the new `workspace.inputCommit` is the source\'s worktree `HEAD`.');
    expect(fork).toContain('A source in a container has a checkout that is not visible here, so its brief has it push its branch before it settles, and the new `workspace.inputCommit` is that pushed head.');
    expect(fork).toContain('When the source has no pushed head, report the fork blocked.');
  });

  test('A5: poteto-mode locates the package root by `pi list`, not by a directory count', () => {
    const todo = line('skills/poteto-mode/SKILL.md', 127);
    expect(todo).not.toMatch(/directories above this file/);
    expect(todo).toContain('`<pi-pstack>` is the pi-pstack package root (`pi list` names it)');
  });

  test('A6: the multi-phase plan template has no relative path that breaks once copied to .pi/pstack/plans/', () => {
    const template = /````markdown\n([\s\S]*?)\n````/.exec(gen('skills/poteto-mode/playbooks/multi-phase-plan.md'))?.[1] ?? '';
    expect(template).toContain('# <Program> plan');
    expect([...template.matchAll(/`(\.{0,2}\/?[\w-]+\/[\w./-]*\.(?:md|sh|mjs|ts))`/g)].map((m) => m[1])).toEqual([]);
  });

  test('A7: no bare Loop or /loop step remains', () => {
    expect(line('skills/poteto-mode/playbooks/visual-parity.md', 8)).toMatch(/Run a watch loop per component until the diff is zero\.$/);
    expect(allLines.filter(({ text }) => /(?:^|\. )Loop per\b|(?<![\w/])\/loop\b/.test(text)).map(({ at }) => at)).toEqual([]);
  });
});
