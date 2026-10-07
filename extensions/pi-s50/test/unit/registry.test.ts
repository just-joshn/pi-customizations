import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';
import { fixedClock } from '../../src/orchestrator/clock.ts';
import type { Command } from '../../src/orchestrator/coordinator.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { parseLeaderboardHtml } from '../../src/registry/fetch.ts';
import { buildSnapshot, S50_DEPENDENCIES } from '../../src/registry/lock.ts';
import { parseLeaderboardFile, parseSnapshot, verifySnapshot } from '../../src/registry/validate.ts';
import { fixturePath, loadLeaderboard, loadSources, registry, satisfiedAt } from './support.ts';

describe('top-50 eligibility', () => {
  test('all 18 dependencies lock from the captured leaderboard', () => {
    const snapshot = registry();
    expect(snapshot.skills.map((skill) => [skill.name, skill.rank])).toEqual([
      ['find-skills', 1],
      ['grill-me', 2],
      ['grill-with-docs', 3],
      ['improve-codebase-architecture', 4],
      ['agent-browser', 5],
      ['tdd', 6],
      ['frontend-design', 7],
      ['setup-matt-pocock-skills', 8],
      ['handoff', 9],
      ['triage', 10],
      ['prototype', 11],
      ['grilling', 12],
      ['vercel-react-best-practices', 16],
      ['domain-modeling', 17],
      ['teach', 18],
      ['codebase-design', 19],
      ['diagnosing-bugs', 42],
      ['web-design-guidelines', 47],
    ]);
    expect(snapshot.leaderboard.length).toBe(50);
    expect(verifySnapshot(snapshot)).toEqual([]);
  });

  test('a skill ranked 55 is ineligible', () => {
    const built = buildSnapshot({ leaderboard: loadLeaderboard(), sources: loadSources(), required: ['tdd', 'code-review'], snapshotTime: 't', source: 's' });
    expect(built).toEqual({ kind: 'ineligible', skills: ['code-review'] });
  });

  test('verifySnapshot flags a rank above the cutoff', () => {
    const snapshot = registry();
    const tampered = { ...snapshot, skills: snapshot.skills.map((skill) => (skill.name === 'tdd' ? { ...skill, rank: 51 } : skill)) };
    expect(verifySnapshot(tampered)).toEqual(['tdd rank 51 exceeds cutoff 50']);
  });

  test('triage records its setup prerequisite', () => {
    expect(registry().skills.find((skill) => skill.name === 'triage')?.prerequisites).toEqual(['setup-matt-pocock-skills']);
  });
});

describe('snapshot lifecycle', () => {
  test('skill leaving the top 50 makes a new snapshot ineligible', () => {
    const file = parseLeaderboardFile(JSON.parse(readFileSync(fixturePath('leaderboard.diagnosing-bugs-rank-51.json'), 'utf8')));
    if (file.kind === 'invalid') throw new Error(file.reason);
    const built = buildSnapshot({ leaderboard: file.value.entries, sources: loadSources(), required: S50_DEPENDENCIES, snapshotTime: 't', source: 's' });
    expect(built).toEqual({ kind: 'ineligible', skills: ['diagnosing-bugs'] });
  });

  const commands: readonly Command[] = [
    { kind: 'advance', to: 'REVERIFY_STALE' },
    { kind: 'invoke_skill', skill: 'tdd' },
    { kind: 'record_evidence', evidence: { claim: 'c', criterion: 'c', state: 'MEASURED', dependencies: [], method: 'cli', expected: 'e', observed: 'o', artifact: 'a' } },
    { kind: 'revision_changed', revision: 'r2', changedPaths: ['src/a.ts'] },
    { kind: 'record_finding', finding: { severity: 'low', trigger: 't', consequence: 'c', evidence: 'e', owner: 'o', reviewer: 'r', guidelines: null } },
    { kind: 'request_authorization', action: 'merge', scope: 'main' },
    { kind: 'freeze_revision' },
  ];

  test.for(commands)('$kind leaves run.skillRegistry unchanged', (command) => {
    const state = satisfiedAt('FREEZE_REVISION', 'REVERIFY_STALE');
    const outcome = apply(state, command, fixedClock());
    const after = outcome.kind === 'ok' ? outcome.state : state;
    expect(after.run.skillRegistry).toBe(state.run.skillRegistry);
    expect(after.run.skillRegistry.skills.find((skill) => skill.name === 'diagnosing-bugs')?.rank).toBe(42);
  });

  test('lock round-trips through the boundary parser', () => {
    const snapshot = registry();
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual({ kind: 'ok', value: snapshot });
  });

  test('parser rejects a lock with cutoff 60', () => {
    expect(parseSnapshot({ ...registry(), cutoff: 60 })).toEqual({ kind: 'invalid', reason: '$.cutoff: expected one of 50' });
  });
});

describe('skills.sh HTML parsing', () => {
  test('reads initialSkills from an escaped flight payload', () => {
    const html =
      // biome-ignore lint/security/noSecrets: synthetic test value
      '<script>self.__next_f.push([1,"{\\"view\\":\\"all-time\\",\\"initialSkills\\":[{\\"source\\":\\"vercel-labs/skills\\",\\"skillId\\":\\"find-skills\\",\\"installs\\":3727722},{\\"source\\":\\"mattpocock/skills\\",\\"skillId\\":\\"grill-me\\",\\"installs\\":1298039}]}"])</script>';
    expect(parseLeaderboardHtml(html)).toEqual({
      kind: 'ok',
      value: [
        { rank: 1, source: 'vercel-labs/skills', skillId: 'find-skills', installs: 3727722 },
        { rank: 2, source: 'mattpocock/skills', skillId: 'grill-me', installs: 1298039 },
      ],
    });
  });

  test('missing payload is invalid', () => {
    expect(parseLeaderboardHtml('<html></html>')).toEqual({ kind: 'invalid', reason: 'initialSkills payload not found' });
  });
});
