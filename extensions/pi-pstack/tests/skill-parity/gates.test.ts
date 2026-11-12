import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { fixture, run, treeHash } from './helpers.ts';

let cleanup = () => {};
afterEach(() => cleanup());

function withFixture() {
  const f = fixture();
  cleanup = f.cleanup;
  return f.root;
}

function edit(root: string, path: string, from: string, to: string) {
  const file = join(root, path);
  const text = readFileSync(file, 'utf8');
  expect(text).toContain(from);
  writeFileSync(file, text.replace(from, to));
}

describe('parity gate', () => {
  test('passes on the real tree', () => {
    const result = run('check-parity.mjs');
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  test('fails when generated text carries an unmapped Task call', () => {
    const root = withFixture();
    appendFileSync(join(root, 'generated/skills/how/SKILL.md'), '\nSpawn `Task` with `subagent_type: generalPurpose` for each angle.\n');
    const result = run('check-parity.mjs', ['--root', root]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unmapped Cursor primitive task-tool ("`Task`")');
    expect(result.stderr).toContain('unmapped Cursor primitive subagent-type ("subagent_type")');
  });
});

describe('upstream drift', () => {
  const howSource = 'vendor/upstream-pstack/skills/how/SKILL.md';

  test('a changed upstream phrase fails the expected-count check and leaves the generated tree alone', () => {
    const root = withFixture();
    edit(root, howSource, 'If the Task tool rejects a slug', 'If the Task tool refuses a slug');
    const before = treeHash(join(root, 'generated'));
    const result = run('compile-skills.mjs', ['--root', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('rule shared.task-tool-rejects expected 1 match(es), found 0');
    expect(treeHash(join(root, 'generated'))).toBe(before);
  });

  test('a new upstream instruction that needs an unmapped primitive fails the build', () => {
    const root = withFixture();
    edit(root, howSource, '## 1. Assess complexity\n', '## 1. Assess complexity\n\nConfirm the scope with `AskQuestion` first.\n');
    const result = run('compile-skills.mjs', ['--root', root]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/how\/SKILL\.md:\d+: unmapped Cursor primitive ask-question \("AskQuestion"\)/);
  });

  test('an unknown Cursor primitive fails the dependency check', () => {
    const root = withFixture();
    edit(root, howSource, '## 1. Assess complexity\n', '## 1. Assess complexity\n\nSwitch with `SwitchMode` before exploring.\n');
    const result = run('check-dependencies.mjs', ['--root', root, '--check']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/how\/SKILL\.md:\d+: unknown Cursor dependency or primitive "`SwitchMode`"/);
  });
});
