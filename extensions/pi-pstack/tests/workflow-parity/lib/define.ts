// Turns families into vitest cases: one scripted end-to-end run per family, then every negative case against that run.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import type { Family } from '../families/types.ts';
import { validateSources } from './check.ts';
import { realTmux, REAL_MODEL } from './driver.ts';
import { type FamilyRun, report, runFamily, writeEvidence } from './run.ts';
import { engineAvailable, withContainerLock, withStartupRetry } from './container-lock.ts';
import { tlcAvailable } from './tlc.ts';

export function defineFamilyTests(list: Family[]): void {
  for (const family of list) {
    const skip = (family.requires === 'tlc' && !tlcAvailable()) || (family.requires === 'container' && !engineAvailable());
    describe.skipIf(skip)(family.id, () => {
      let run: FamilyRun | undefined;
      beforeAll(async () => {
        run = family.requires === 'container' ? await withContainerLock(() => withStartupRetry(() => runFamily(family, 'scripted'))) : await runFamily(family, 'scripted');
        console.log(report(run));
        writeEvidence(run);
      }, family.requires === 'container' ? 1_800_000 : 300_000);
      afterAll(() => run?.cleanup());

      test('every check cites a source span that resolves in the compiled skills', () => {
        expect(() => validateSources(family.checks)).not.toThrow();
        expect(family.checks.every((entry) => entry.src.length > 0)).toBe(true);
      });

      test('scripted run: every check passes', () => {
        const results = run?.results ?? [];
        expect(run?.timedOut, `pi stderr: ${run?.piStderr}`).toBe(false);
        const known = new Set((family.knownDefects ?? []).map((entry) => entry.checkId));
        expect(results.filter((result) => result.verdict !== 'PASS' && !known.has(result.id)).map((result) => `${result.verdict} ${result.id}: ${result.evidence}`)).toEqual([]);
        expect(results.length).toBeGreaterThan(0);
      });

      test.for(family.knownDefects ?? [])('known product defect: $checkId', ({ checkId }) => {
        const result = run?.results.find((entry) => entry.id === checkId);
        expect(result, `check ${checkId} did not run`).toBeDefined();
        expect(result?.verdict, 'the defect is fixed: remove it from knownDefects').toBe('FAIL');
      });

      test('the run left no tmux session on its private server', () => {
        expect(realTmux(run?.tmuxSocket ?? 'pstack-test-wf-none')).toEqual([]);
      });

      test.for(family.negatives.map((negative) => negative.name))('negative: %s', (name) => {
        const outcome = run?.negatives.find((negative) => negative.name === name);
        expect(outcome, `negative ${name} did not run`).toBeDefined();
        expect(outcome?.failedChecks, `${name} must fail ${outcome?.expected.join(', ')}`).toEqual(expect.arrayContaining(outcome?.expected ?? []));
      });

      test.skipIf(REAL_MODEL === '')(
        `real model ${REAL_MODEL}: every check passes`,
        async () => {
          const real = family.requires === 'container' ? await withContainerLock(() => runFamily(family, 'real')) : await runFamily(family, 'real');
          console.log(report(real));
          writeEvidence(real);
          try {
            expect(real.timedOut, `pi stderr: ${real.piStderr}`).toBe(false);
            expect(real.results.filter((result) => result.verdict === 'FAIL').map((result) => `${result.id}: ${result.evidence}`)).toEqual([]);
          } finally {
            real.cleanup();
          }
        },
        1_000_000,
      );
    });
  }
}
