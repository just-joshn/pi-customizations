import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Problem } from 'skill-gate';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { checkFiles, checkSkill, formatProblem, referenceFiles } from './support/check.ts';
import { hasAndroidSdk } from './support/harness.ts';
import { withLock } from './support/lock.ts';

const SKILL_DIR = resolve(import.meta.dirname, '..');
const PLANT_COMPILE = join(import.meta.dirname, 'fixtures/plant-compile');
const PLANT_RUN = join(import.meta.dirname, 'fixtures/plant-run');
const PLANT_WARN = join(import.meta.dirname, 'fixtures/plant-warn');

const HAS_ANDROID_SDK = hasAndroidSdk(process.env);
const SKIP_GRADLE = !HAS_ANDROID_SDK && process.env['REQUIRE_ANDROID_SDK'] !== '1';
const formatted = (problems: readonly Problem[]) => problems.map(formatProblem);

test('frontmatter, orphans, decision tree', () => {
  expect(checkSkill(SKILL_DIR)).toEqual([]);
});

describe.skipIf(SKIP_GRADLE)('skill examples (needs an Android SDK)', () => {
  let problems: Problem[] = [];
  beforeAll(() => {
    problems = checkFiles({ skillDir: SKILL_DIR, rels: referenceFiles(SKILL_DIR), label: 'skill' });
  });

  test('the build itself', () => {
    expect(formatted(problems.filter((problem) => problem.kind === 'skill'))).toEqual([]);
  });

  test.for(referenceFiles(SKILL_DIR))('%s', (rel) => {
    expect(formatted(problems.filter((problem) => problem.kind !== 'skill' && problem.rel === rel))).toEqual([]);
  });
});

describe.skipIf(SKIP_GRADLE)('gate catches planted mistakes (needs an Android SDK)', () => {
  let skillProblems = '';
  let compileProblems = '';
  let runProblems = '';
  let runList: string[] = [];
  let warnProblems = '';
  beforeAll(() => {
    warnProblems = formatted(checkFiles({ skillDir: PLANT_WARN, rels: ['warn.md'], label: 'plant-warn' })).join('\n');
    skillProblems = formatted(checkSkill(PLANT_COMPILE)).join('\n');
    compileProblems = formatted(checkFiles({ skillDir: PLANT_COMPILE, rels: referenceFiles(PLANT_COMPILE), label: 'plant-compile' })).join('\n');
    runList = formatted(checkFiles({ skillDir: PLANT_RUN, rels: referenceFiles(PLANT_RUN), label: 'plant-run' }));
    runProblems = runList.join('\n');
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

  test.for([
    'core/pins.md:7 org.jetbrains.kotlin.plugin.compose:2.0.0 does not match the pinned 2.4.21',
    'core/pins.md:8 com.android.application:8.0.0 does not match the pinned 9.5.1',
    'core/pins.md:14 org.robolectric:robolectric:4.10 does not match the pinned 4.17',
    'core/pins.md:15 org.robolectric:robolectric:4.11 does not match the pinned 4.17',
    'core/pins.md:16 junit:junit version $junitVersion is not a literal the gate can check',
    'core/pins.md:26 org.robolectric:robolectric:4.12 does not match the pinned 4.17',
    'core/pins.md:27 junit:junit:4.12 does not match the pinned 4.13.2',
    'core/pins.md:28 com.google.truth:truth:1.0 does not match the pinned 1.4.5',
    'core/pins.md:29 org.jetbrains.kotlinx:kotlinx-coroutines-test:1.0 does not match the pinned 1.11.0',
    'core/pins.md:32 com.android.application:8.0.0 does not match the pinned 9.5.1',
  ])('version form %s', (expected) => {
    expect(compileProblems).toContain(expected);
  });

  test.for([
    'core/pins2.md:7 org.jetbrains.kotlin.android:2.0.0 is not pinned',
    'core/pins2.md:11 org.robolectric:robolectric:4.10 does not match the pinned 4.17',
    'core/pins2.md:12 junit:junit:4.12 does not match the pinned 4.13.2',
    'core/pins2.md:19 prefer("1.0") is a version the gate cannot attribute to a dependency',
    'core/pins2.md:27 org.robolectric:robolectric:4.10 does not match the pinned 4.17',
    'core/pins2.md:29 androidx.compose:compose-bom:2024.01.00 does not match the pinned 2026.09.00',
  ])('version form %s', (expected) => {
    expect(compileProblems).toContain(expected);
  });

  test('two files whose names differ only in punctuation are both compiled', () => {
    expect(compileProblems).toContain("core/a-b.md:7 error: Unresolved reference 'thisDoesNotExist'");
  });

  test('an indented code block is reported', () => {
    expect(compileProblems).toContain('core/b.md: 1 indented code block(s)');
  });

  test('a reference file inside a directory named tests is checked', () => {
    expect(compileProblems).toContain('core/tests/hidden.md: broken link core/tests/gone.md');
  });

  test('a fence inside an HTML comment does not shift line numbers', () => {
    expect(compileProblems).toContain("core/comment.md:13 error: Unresolved reference 'commentNope'");
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

  test('a block that starts with a file annotation passes', () => {
    expect(runProblems).not.toContain('core/optin.md');
  });

  test('a file annotation over several lines keeps the package line below it', () => {
    expect(runProblems).not.toContain('core/optin2.md');
  });

  test('passing tests and compile-only blocks produce no problems', () => {
    expect(runList).toEqual([expect.stringContaining('core/run.md:5 test FailingTest.fails failed: '), 'core/run.md:50 declares @Test but no test ran', 'core/run.md:58 declares @Test but no test ran']);
  });
});

describe('gate reports a broken build', () => {
  test('a build that fails before tests run reports the Gradle failure', () => {
    vi.stubEnv('ANDROID_HOME', '/nonexistent-android-sdk');
    vi.stubEnv('ANDROID_SDK_ROOT', '/nonexistent-android-sdk');
    rmSync(join(tmpdir(), 'compose-robolectric-skill', 'plant-nosdk'), { recursive: true, force: true });
    try {
      const problems = formatted(checkFiles({ skillDir: PLANT_RUN, rels: ['core/optin.md'], label: 'plant-nosdk' }));
      expect(problems).toEqual([expect.stringContaining('gradle failed:')]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('gate lock', () => {
  const dir = join(tmpdir(), 'compose-robolectric-skill', 'lock-test');
  const lockFile = join(dir, 'gate.lock');
  const attempt = () => withLock({ lockFile, busy: () => 'busy', run: () => (existsSync(lockFile) ? `ran as ${readFileSync(lockFile, 'utf8')}` : 'ran unlocked') });

  test.for([
    ['a live owner', String(process.pid), 'busy'],
    ['an owner that no longer exists', String(2 ** 22 + 1), `ran as ${process.pid}`],
    ['no readable owner', 'not a pid', `ran as ${process.pid}`],
    ['an owner still writing its pid', '', 'busy'],
    ['no lock', undefined, `ran as ${process.pid}`],
  ] as const)('a lock with %s', ([, owner, expected]) => {
    mkdirSync(dir, { recursive: true });
    rmSync(lockFile, { force: true });
    if (owner !== undefined) writeFileSync(lockFile, owner);
    try {
      expect(attempt()).toBe(expected);
    } finally {
      rmSync(lockFile, { force: true });
    }
  });

  test('the lock is released after the run', () => {
    mkdirSync(dir, { recursive: true });
    attempt();
    expect(existsSync(lockFile)).toBe(false);
  });
});

test.for([
  [{ ANDROID_HOME: '/sdk' }, true],
  [{ ANDROID_SDK_ROOT: '/sdk' }, true],
  [{ ANDROID_HOME: '', ANDROID_SDK_ROOT: '/sdk' }, true],
  [{ ANDROID_HOME: '' }, false],
  [{}, false],
] as const)('hasAndroidSdk(%o) is %s', ([env, expected]) => {
  expect(hasAndroidSdk(env)).toBe(expected);
});
