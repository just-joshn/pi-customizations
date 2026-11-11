import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';
import { checkFile, checkSkill, referenceFiles, staleExceptions } from './support/check.ts';
import { exceptions } from './support/exceptions.ts';

const SKILL_DIR = resolve(import.meta.dirname, '..');
const PLANT_DIR = join(import.meta.dirname, 'fixtures/plant');

describe('skill', () => {
  test('exists', () => {
    expect(existsSync(join(SKILL_DIR, 'SKILL.md'))).toBe(true);
  });

  test('frontmatter, orphans, decision tree', () => {
    expect(checkSkill(SKILL_DIR)).toEqual([]);
  });

  test.for(referenceFiles(SKILL_DIR))('%s', (rel) => {
    expect(checkFile(SKILL_DIR, rel, exceptions)).toEqual([]);
  });

  test('every typecheck exception still fails', () => {
    expect(staleExceptions(SKILL_DIR, exceptions)).toEqual([]);
  });
});

describe('gate catches planted mistakes', () => {
  const skillProblems = checkSkill(PLANT_DIR, 'ROUTER.md').join('\n');
  const plantException = { file: 'core/more.md', blockContains: "from './pick'", codes: [2578, 2349], reason: 'plant' };
  const fileProblems = referenceFiles(PLANT_DIR)
    .flatMap((rel) => checkFile(PLANT_DIR, rel, [plantException]))
    .join('\n');

  test.for(['frontmatter is not valid YAML', 'core/orphan.md is not linked', 'decision tree path does not exist: core/nope.md'])('%s', (expected) => {
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
  ])('%s', (expected) => {
    expect(fileProblems).toContain(expected);
  });
});
