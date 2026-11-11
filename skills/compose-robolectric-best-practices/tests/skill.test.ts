import { join, resolve } from 'node:path';

import { beforeAll, describe, expect, test } from 'vitest';
import { checkFiles, checkSkill, referenceFiles } from './support/check.ts';

const SKILL_DIR = resolve(import.meta.dirname, '..');
const PLANT_COMPILE = join(import.meta.dirname, 'fixtures/plant-compile');
const PLANT_RUN = join(import.meta.dirname, 'fixtures/plant-run');
const PLANT_WARN = join(import.meta.dirname, 'fixtures/plant-warn');

describe('skill', () => {
  let problems: string[] = [];
  beforeAll(() => {
    problems = checkFiles(SKILL_DIR, referenceFiles(SKILL_DIR), 'skill');
  });

  test('frontmatter, orphans, decision tree', () => {
    expect(checkSkill(SKILL_DIR)).toEqual([]);
  });

  test.for(referenceFiles(SKILL_DIR))('%s', (rel) => {
    expect(problems.filter((problem) => problem.startsWith(`${rel}:`) || !problem.includes('.md'))).toEqual([]);
  });
});

describe('gate catches planted mistakes', () => {
  let skillProblems = '';
  let compileProblems = '';
  let runProblems = '';
  let warnProblems = '';
  beforeAll(() => {
    warnProblems = checkFiles(PLANT_WARN, ['warn.md'], 'plant-warn').join('\n');
    skillProblems = checkSkill(PLANT_COMPILE).join('\n');
    compileProblems = checkFiles(PLANT_COMPILE, referenceFiles(PLANT_COMPILE), 'plant-compile').join('\n');
    runProblems = checkFiles(PLANT_RUN, referenceFiles(PLANT_RUN), 'plant-run').join('\n');
  });

  test.for(['frontmatter name nope does not match', 'core/orphan.md is not linked', 'decision tree path does not exist: core/missing.md'])('%s', (expected) => {
    expect(skillProblems).toContain(expected);
  });

  test.for([
    'core/a.md: broken link core/gone.md',
    'core/a.md:9 fence language "typescript" is not one of',
    'core/a.md:13 snippet is longer than 12 lines',
    'core/a.md:31 androidx.compose:compose-bom:2024.01.00 does not match the pinned 2026.09.00',
    'core/a.md:32 com.example:unknown:1.0 is not pinned',
    "core/a.md:52 error: Unresolved reference 'assertIsShownNow'",
    "core/b.md:13 error: Unresolved reference 'onNodeWithTxt'",
    'core/a.md:63 com.android.application:9.0.0 does not match the pinned 9.5.1',
  ])('%s', (expected) => {
    expect(compileProblems).toContain(expected);
  });

  test('a deprecated API fails the build', () => {
    expect(warnProblems).toContain("warn.md:9 error: 'fun createComposeRule(");
  });

  test('a failing test in a run block is reported with its fence line', () => {
    expect(runProblems).toContain('core/run.md:5 test FailingTest.fails failed: ');
  });

  test('a block that declares @Test without a runnable test is reported', () => {
    expect(runProblems).toContain('core/run.md:50 declares @Test but no test ran');
  });

  test('a block whose every test is skipped is reported', () => {
    expect(runProblems).toContain('core/run.md:58 declares @Test but no test ran');
  });

  test('a failing test in a compile-only block does not run', () => {
    expect(runProblems).not.toContain('core/run.md:30');
  });

  test('passing tests produce no problems', () => {
    expect(runProblems.split('\n')).toHaveLength(3);
  });
});
