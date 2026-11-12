// The PR families on a real forge. Two parts. The live part runs the real pi binary with the scripted model against branches
// and PRs in the throwaway GitHub repository, so it runs only when PSTACK_REAL_FORGE=1 (the merge gate stays offline). The
// replay part always runs: it re-checks the facts the committed evidence recorded from the GitHub API, with the same fact
// checks and the same fact-breaking negative cases, and holds the record to its own claims (PR and run URLs in the sandbox
// repository, every check PASS, every negative detected, nothing left behind).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { type FactCheck, realFamilies } from './families/pr-real-forge.ts';
import { type Facts, REAL_FORGE_ENABLED, SANDBOX_REPO } from './fixtures/real-forge.ts';
import { engineAvailable, withContainerLock } from './lib/container-lock.ts';
import { validateSources } from './lib/check.ts';
import { finishRecord, type RealRecord, runRealFamily, writeRecord } from './lib/real-run.ts';

const EVIDENCE = join(import.meta.dirname, 'real-forge-evidence');

describe.skipIf(!REAL_FORGE_ENABLED)('real forge live', () => {
  for (const family of realFamilies) {
    describe.skipIf(family.requires === 'container' && !engineAvailable())(family.id, () => {
      test('every check passes against the GitHub API, every negative case is detected, and nothing is left on the forge', async () => {
        const record = family.requires === 'container' ? await withContainerLock(() => runRealFamily(family)) : await runRealFamily(family);
        finishRecord(family, record);
        console.log(record.table);
        console.log(`evidence record: ${writeRecord(record)}`);
        expect(record.timedOut, `pi stderr: ${record.piStderr}`).toBe(false);
        expect(record.facts.settled, 'the Actions runs finished before the facts were read').toBe(true);
        expect(record.results.filter((result) => result.verdict !== 'PASS').map((result) => `${result.verdict} ${result.id}: ${result.evidence}`)).toEqual([]);
        expect(record.negatives.filter((negative) => !negative.detected).map((negative) => negative.name)).toEqual([]);
        expect(record.cleanup.leftoverPrs).toEqual([]);
        expect(record.cleanup.leftoverBranches).toEqual([]);
      }, 2_400_000);
    });
  }
});

const recorded = (id: string): RealRecord | undefined => (existsSync(join(EVIDENCE, `${id}.json`)) ? (JSON.parse(readFileSync(join(EVIDENCE, `${id}.json`), 'utf8')) as RealRecord) : undefined);

function replay(facts: Facts, checks: FactCheck[], mutate?: (sandbox: string) => void): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'real-replay-'));
  try {
    writeFileSync(join(dir, 'real-facts.json'), JSON.stringify(facts));
    mutate?.(dir);
    const mutated = JSON.parse(readFileSync(join(dir, 'real-facts.json'), 'utf8')) as Facts;
    return checks.filter((entry) => {
      const outcome = entry.run(mutated);
      return 'skip' in outcome ? false : !outcome.ok;
    }).map((entry) => entry.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('real forge evidence replay', () => {
  test('a container worker with the forge capability pushed a branch to github.com: the commit the worker made is the one the GitHub API showed', () => {
    const push = JSON.parse(readFileSync(join(EVIDENCE, 'container-push.json'), 'utf8')) as Record<string, string | boolean>;
    expect(push['repo']).toBe(SANDBOX_REPO);
    expect(push['workspace']).toBe('container');
    expect(push['forgeCapability']).toBe(true);
    expect(push['tokenInjectedBy']).toBe('PSTACK_CONTAINER_FORGE_TOKEN');
    expect(push['sha']).toMatch(/^[0-9a-f]{40}$/);
    expect(push['apiSha']).toBe(push['sha']);
    expect(push['author']).toBe('container-worker');
    expect(String(push['ref'])).toMatch(/^refs\/heads\/pfprobe\//);
  });

  test('the evidence folder holds a record for every real-forge family', () => {
    mkdirSync(EVIDENCE, { recursive: true });
    expect(readdirSync(EVIDENCE).filter((name) => name.endsWith('.json') && name !== 'container-push.json').sort()).toEqual(realFamilies.map((family) => `${family.id}.json`).sort());
  });

  test.for(realFamilies.map((family) => family.id))('%s: every check cites a source span that resolves in the compiled skills', (id) => {
    const family = realFamilies.find((entry) => entry.id === id);
    expect(() => validateSources(family?.checks ?? [])).not.toThrow();
  });

  describe.for(realFamilies.map((family) => family.id))('%s', (id) => {
    const family = realFamilies.find((entry) => entry.id === id);
    const record = recorded(id);

    test('the recorded run lives in the sandbox repository: PR and Actions run URLs, a settled forge, nothing left behind', () => {
      expect(record, `no committed evidence for ${id}`).toBeDefined();
      const facts = (record as RealRecord).facts;
      expect(facts.repo).toBe(SANDBOX_REPO);
      expect(facts.settled).toBe(true);
      expect(facts.prs.length).toBeGreaterThan(0);
      for (const pr of facts.prs) {
        expect(pr.url).toBe(`https://github.com/${SANDBOX_REPO}/pull/${pr.number}`);
        expect(pr.runs.length).toBeGreaterThan(0);
        for (const run of pr.runs) expect(run.url).toMatch(new RegExp(`^https://github.com/${SANDBOX_REPO}/actions/runs/\\d+`));
      }
      expect((record as RealRecord).cleanup.leftoverPrs).toEqual([]);
      expect((record as RealRecord).cleanup.leftoverBranches).toEqual([]);
    });

    test('the live run passed every check and detected every negative case', () => {
      const run = record as RealRecord;
      expect(run.results.filter((result) => result.verdict !== 'PASS').map((result) => `${result.verdict} ${result.id}`)).toEqual([]);
      expect(run.results.length).toBeGreaterThan(10);
      expect(run.negatives.filter((negative) => !negative.detected).map((negative) => negative.name)).toEqual([]);
    });

    test('the recorded GitHub facts satisfy every fact check', () => {
      expect(replay((record as RealRecord).facts, family?.facts ?? [])).toEqual([]);
    });

    test('each fact-breaking negative case is caught by the fact checks on the recorded facts', () => {
      const ids = new Set((family?.facts ?? []).map((entry) => entry.id));
      const cases = (family?.negatives ?? []).filter((negative) => negative.fails.length > 0 && negative.fails.every((failure) => ids.has(failure)));
      expect(cases.length).toBeGreaterThan(5);
      const missed = cases.filter((negative) => {
        const caught = replay((record as RealRecord).facts, family?.facts ?? [], (dir) => negative.mutate(dir, undefined as never));
        return !negative.fails.every((failure) => caught.includes(failure));
      }).map((negative) => negative.name);
      expect(missed).toEqual([]);
    });
  });
});
