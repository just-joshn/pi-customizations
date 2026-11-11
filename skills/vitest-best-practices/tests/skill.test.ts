import { join, resolve } from 'node:path';

import { beforeAll, describe, expect, test } from 'vitest';
import { checkFile, checkSkill, referenceFiles } from './support/check.ts';
import { exceptions } from './support/exceptions.ts';

const SKILL_DIR = resolve(import.meta.dirname, '..');
const PLANT_DIR = join(import.meta.dirname, 'fixtures/plant');
const CLEAN_DIR = join(import.meta.dirname, 'fixtures/clean');

describe('skill', () => {
  test('frontmatter, orphans, decision tree', () => {
    expect(checkSkill(SKILL_DIR, 'SKILL.md', exceptions)).toEqual([]);
  });

  test.for(referenceFiles(SKILL_DIR))('%s', (rel) => {
    expect(checkFile(SKILL_DIR, rel, exceptions)).toEqual([]);
  });
});

describe('gate catches planted mistakes', () => {
  let skillProblems = '';
  let fileProblems = '';
  beforeAll(() => {
    // ROUTER.md, not SKILL.md, so Pi never discovers the fixture as a second skill.
    const missingFileException = { file: 'core/renamed.md', blockContains: 'x', codes: [2349], reason: 'plant' };
    skillProblems = checkSkill(PLANT_DIR, 'ROUTER.md', [missingFileException]).join('\n');
    const plantException = { file: 'core/more.md', blockContains: "from './pick'", codes: [2578, 2349], reason: 'plant' };
    fileProblems = referenceFiles(PLANT_DIR)
      .flatMap((rel) => checkFile(PLANT_DIR, rel, [plantException]))
      .join('\n');
  });

  test.for(['frontmatter is not valid YAML', 'core/orphan.md is not linked', 'decision tree path does not exist: core/nope.md', 'exception names a file that does not exist: core/renamed.md'])('%s', (expected) => {
    expect(skillProblems).toContain(expected);
  });

  test.for([
    'broken link core/titled-missing.md',
    'broken link core/angle missing.md',
    'broken link core/reference-missing.md',
    "has no exported member named 'bench'",
    "Property 'skp' does not exist",
    "'scoped' is deprecated",
    "Property 'sequential' does not exist",
    "Property 'lastCalls' does not exist",
    "Property 'withImplementationOnce' does not exist",
    "Property 'notARealApi' does not exist",
    "Property 'toBeNonsense' does not exist",
    "Property 'thenResolvesForever' does not exist",
    "Property 'toBeVisible' does not exist",
    "Cannot find name 'onTestFinishd'. Did you mean 'onTestFinished'?",
    "Cannot find name 'beforeEachOnce'. Did you mean 'beforeEach'?",
    "Property 'getByText' does not exist on type 'Promise",
    "Cannot find module '@testing-library/solid'",
    "Property 'toHaveClass' does not exist",
    "Property 'notInTheException' does not exist",
    "core/nested.md:6 TS2339 Property 'listNotReal' does not exist",
    "core/nested.md:14 TS2339 Property 'quoteNotReal' does not exist",
    'core/nested.md: broken link core/img/missing.png',
    "core/nested.md:20 TS2322 Type 'Element' is not assignable to type 'number'",
  ])('%s', (expected) => {
    expect(fileProblems).toContain(expected);
  });
});

describe('gate accepts valid examples', () => {
  test('browser, Solid, React examples type-check', () => {
    expect(checkFile(CLEAN_DIR, 'valid.md', [])).toEqual([]);
  });

  test('an exception whose error no longer occurs is reported', () => {
    const stale = { file: 'valid.md', blockContains: 'react element', codes: [2349], reason: 'stale on purpose' };
    expect(checkFile(CLEAN_DIR, 'valid.md', [stale])).toEqual(['valid.md: stale exception "react element" TS2349']);
  });
});
