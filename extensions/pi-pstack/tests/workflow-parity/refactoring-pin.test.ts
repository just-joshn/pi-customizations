// Refactoring step 1: the behavior pin was in place and green before any structure moved. Real git histories in a temporary repository, the
// pin run for real with node --test; no scripted model.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import { refactoringFamily } from './families/build-measured.ts';
import { evaluate, type Outcome } from './lib/check.ts';
import { pinBeforeChange, parentSpawnCommits, workflowCommits } from './lib/checks.ts';
import type { RunView } from './lib/view.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const ADD = 'exports.add = (a, b) => a + b;\n';
const TWICE = "const { add } = require('./add.js');\nexports.twice = (x) => add(x, x);\n";
const pinOf = (module: string, call: string, expected: string) => `const test = require('node:test');\nconst assert = require('node:assert');\ntest('pins ${module}', () => assert.equal(${call}, ${expected}));\n`;
const ADD_PIN = pinOf('add', "require('../src/add.js').add(1, 2)", '3');
const TWICE_PIN = pinOf('twice', "require('../src/twice.js').twice(4)", '8');

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'wf-pin-'));
  base: string;
  constructor(baseFiles: Record<string, string>) {
    dirs.push(this.dir);
    this.git('init', '-q', '-b', 'main');
    this.base = this.commit(baseFiles, 'base');
  }
  git(...args: string[]): string {
    return execFileSync('git', ['-C', this.dir, '-c', 'user.name=t', '-c', 'user.email=t@x', ...args], { encoding: 'utf8' }).trim();
  }
  commit(files: Record<string, string | null>, message: string): string {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(this.dir, path, '..'), { recursive: true });
      if (content === null) rmSync(join(this.dir, path));
      else writeFileSync(join(this.dir, path), content);
    }
    this.git('add', '-A');
    this.git('commit', '-q', '-m', message);
    return this.git('rev-parse', 'HEAD');
  }
  /** The run as the checks see it: the delegate was spawned at `input` and its branch holds `commits`. */
  view(input: string, commits: string[]): RunView {
    this.git('branch', '-f', 'pstack-run/r/w', commits.at(-1) ?? input);
    const delegate = { id: 'w', assignment: { kind: 'pi', role: 'poteto', workspace: { mode: 'worktree', inputCommit: input } } };
    return { repo: this.dir, base: this.base, git: { branchCommits: { 'pstack-run/r/w': [...commits].reverse() } }, runs: [{ id: 'r', workers: [delegate] }], parent: { toolCalls: [] } } as unknown as RunView;
  }
}

const verdict = (outcome: Outcome): 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'SKIP' => ('ok' in outcome ? (outcome.ok ? 'PASS' : 'FAIL') : 'inconclusive' in outcome ? 'INCONCLUSIVE' : 'SKIP');
const evidence = (outcome: Outcome): string => ('ok' in outcome ? outcome.evidence : 'inconclusive' in outcome ? outcome.inconclusive : outcome.skip);
const TWICE_DIRECT = "exports.twice = (x) => x + x;\n";

describe('a pin that was green before the structure moved is accepted, however the workflow made it', () => {
  test('the delegate commits the pin, then the structural change', () => {
    const repo = new Repo({ 'src/add.js': ADD });
    const pin = repo.commit({ 'test/add.test.js': ADD_PIN }, 'test: pin add');
    const change = repo.commit({ 'src/add.js': 'exports.add = (a, b) => a - -b;\n' }, 'refactor: add');
    expect(verdict(pinBeforeChange(repo.view(repo.base, [pin, change])))).toBe('PASS');
  });

  test('the parent commits the pin before it spawns the delegate, and the delegate makes one focused commit', () => {
    const repo = new Repo({ 'src/add.js': ADD });
    const pin = repo.commit({ 'test/add.test.js': ADD_PIN }, 'test: pin add');
    const change = repo.commit({ 'src/add.js': 'exports.add = (a, b) => a - -b;\n' }, 'refactor: add');
    expect(verdict(pinBeforeChange(repo.view(pin, [change])))).toBe('PASS');
  });

  test('one delegate commit is enough when an existing test, green on the unchanged code, already executes what the commit changes', () => {
    const repo = new Repo({ 'src/add.js': ADD, 'test/add.test.js': ADD_PIN });
    const change = repo.commit({ 'src/add.js': 'exports.add = (a, b) => a - -b;\n' }, 'refactor: add');
    const outcome = pinBeforeChange(repo.view(repo.base, [change]));
    expect(verdict(outcome), evidence(outcome)).toBe('PASS');
  });

  test('independent changes are each checked against a pin that was green before that change', () => {
    const repo = new Repo({ 'src/add.js': ADD, 'src/twice.js': TWICE, 'test/add.test.js': ADD_PIN });
    const first = repo.commit({ 'src/add.js': 'exports.add = (a, b) => a - -b;\n' }, 'refactor: add');
    const pin = repo.commit({ 'test/twice.test.js': TWICE_PIN }, 'test: pin twice');
    const second = repo.commit({ 'src/twice.js': TWICE_DIRECT }, 'refactor: twice');
    expect(verdict(pinBeforeChange(repo.view(repo.base, [first, pin, second])))).toBe('PASS');
  });

  test('an independent second change with no pin of its own is refused although the first one was pinned', () => {
    const repo = new Repo({ 'src/add.js': ADD, 'src/twice.js': TWICE, 'test/add.test.js': ADD_PIN });
    const first = repo.commit({ 'src/add.js': 'exports.add = (a, b) => a - -b;\n' }, 'refactor: add');
    const second = repo.commit({ 'src/twice.js': TWICE_DIRECT }, 'refactor: twice');
    const outcome = pinBeforeChange(repo.view(repo.base, [first, second]));
    expect(verdict(outcome)).toBe('FAIL');
    expect(evidence(outcome)).toContain('src/twice.js');
  });
});

describe('a pin that was not shown green before the structure moved is refused', () => {
  test('missing pin: no test exists on the code before the change', () => {
    const repo = new Repo({ 'src/add.js': ADD });
    const change = repo.commit({ 'src/add.js': 'exports.add = (a, b) => a - -b;\n' }, 'refactor: add');
    const outcome = pinBeforeChange(repo.view(repo.base, [change]));
    expect(verdict(outcome)).toBe('FAIL');
    expect(evidence(outcome)).toMatch(/no test ran/);
  });

  test('unverified pin: the characterization test is red on the unchanged code', () => {
    const repo = new Repo({ 'src/add.js': ADD });
    const pin = repo.commit({ 'test/add.test.js': pinOf('add', "require('../src/add.js').add(1, 2)", '4') }, 'test: pin add');
    const change = repo.commit({ 'src/add.js': 'exports.add = (a, b) => a - -b;\n' }, 'refactor: add');
    const outcome = pinBeforeChange(repo.view(repo.base, [pin, change]));
    expect(verdict(outcome)).toBe('FAIL');
    expect(evidence(outcome)).toMatch(/red/);
  });

  test('the characterization test and the structural change in one commit do not prove a pin before the change', () => {
    const repo = new Repo({ 'src/add.js': ADD });
    const combined = repo.commit({ 'test/add.test.js': ADD_PIN, 'src/add.js': 'exports.add = (a, b) => a - -b;\n' }, 'refactor: add with its test');
    const outcome = pinBeforeChange(repo.view(repo.base, [combined]));
    expect(verdict(outcome)).toBe('FAIL');
    expect(evidence(outcome)).toMatch(/one commit/);
  });

  test('a green pin that never executes the changed file is no pin for it', () => {
    const repo = new Repo({ 'src/add.js': ADD, 'src/twice.js': TWICE, 'test/add.test.js': ADD_PIN });
    const change = repo.commit({ 'src/twice.js': TWICE_DIRECT }, 'refactor: twice');
    const outcome = pinBeforeChange(repo.view(repo.base, [change]));
    expect(verdict(outcome)).toBe('FAIL');
    expect(evidence(outcome)).toContain('src/twice.js');
  });

  test('a later commit that edits the pin loosens it', () => {
    const repo = new Repo({ 'src/add.js': ADD });
    const pin = repo.commit({ 'test/add.test.js': ADD_PIN }, 'test: pin add');
    const change = repo.commit({ 'src/add.js': 'exports.add = (a, b) => a - -b;\n' }, 'refactor: add');
    const loosened = repo.commit({ 'test/add.test.js': pinOf('add', "require('../src/add.js').add(1, 2)", '3') + '// edited\n' }, 'test: tweak the pin');
    expect(verdict(pinBeforeChange(repo.view(repo.base, [pin, change, loosened])))).toBe('FAIL');
  });

  test('a workflow with no structural commit changed nothing to pin', () => {
    const repo = new Repo({ 'src/add.js': ADD });
    const pin = repo.commit({ 'test/add.test.js': ADD_PIN }, 'test: pin add');
    expect(verdict(pinBeforeChange(repo.view(repo.base, [pin])))).toBe('FAIL');
  });
});

describe('a run with no delegate yields a verdict, never an exception', () => {
  const repo = new Repo({ 'src/add.js': ADD });
  const noDelegate = { repo: repo.dir, base: repo.base, git: { branchCommits: {} }, runs: [{ id: 'r', workers: [] }], parent: { toolCalls: [] } } as unknown as RunView;

  test('the commits of a workflow with no delegate are empty', () => {
    expect(parentSpawnCommits(noDelegate)).toEqual([]);
    expect(workflowCommits(noDelegate)).toEqual([]);
  });

  test('the pin check fails and says why', () => {
    const outcome = pinBeforeChange(noDelegate);
    expect(verdict(outcome)).toBe('FAIL');
    expect(evidence(outcome)).toMatch(/no poteto worker/);
  });
  test('every refactoring check that reaches the delegate answers FAIL with a reason of its own, and none throws', () => {
    const ids = ['refactoring.pin-lands-first-and-holds', 'refactoring.small-steps-keep-the-pin-green', 'refactoring.behavior-is-unchanged', 'refactoring.old-api-deleted-callers-migrated', 'refactoring.reader-load-is-lower-and-no-new-behavior'];
    const results = evaluate(refactoringFamily.checks.filter((entry) => ids.includes(entry.id)), noDelegate);
    expect(results.map((result) => result.id)).toEqual(ids);
    expect(results.map((result) => result.verdict)).toEqual(ids.map(() => 'FAIL'));
    expect(results.filter((result) => /threw/.test(result.evidence))).toEqual([]);
  });
});
