import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';
import type { Command } from '../../src/orchestrator/command.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { parseFrontmatter, parseLeaderboardHtml } from '../../src/registry/fetch.ts';
import { buildLock, OPTIONAL_SKILLS, REQUIRED_SKILLS } from '../../src/registry/lock.ts';
import { parseLeaderboardFile, parseLock, verifySnapshot } from '../../src/registry/validate.ts';
import { fixedClock } from '../support/clock.ts';
import { fixturePath, loadLeaderboard, loadSources, registry, satisfiedAt } from './support.ts';

describe('top-50 eligibility', () => {
  test('all 18 skills lock from the captured leaderboard', () => {
    const snapshot = registry();
    expect(snapshot.skills.map((skill) => [skill.name, skill.rank])).toEqual([
      ['grilling', 12],
      ['domain-modeling', 17],
      ['codebase-design', 19],
      ['prototype', 11],
      ['tdd', 6],
      ['diagnosing-bugs', 42],
      ['frontend-design', 7],
      ['vercel-react-best-practices', 16],
      ['web-design-guidelines', 47],
      ['agent-browser', 5],
      ['triage', 10],
      ['improve-codebase-architecture', 4],
      ['setup-matt-pocock-skills', 8],
      ['find-skills', 1],
      ['grill-me', 2],
      ['grill-with-docs', 3],
      ['handoff', 9],
      ['teach', 18],
    ]);
    expect(snapshot.leaderboard.length).toBe(50);
    expect(verifySnapshot(snapshot)).toEqual([]);
  });

  test('code-review at rank 55 is outside the strict registry', () => {
    expect([loadLeaderboard().find((entry) => entry.skillId === 'code-review')?.rank, registry().skills.some((skill) => skill.name === 'code-review')]).toEqual([55, false]);
  });

  test('S50 requires 13 skills with 5 optional ones', () => {
    expect([REQUIRED_SKILLS.length, OPTIONAL_SKILLS.length]).toEqual([13, 5]);
  });

  test('a leaderboard shorter than 50 entries fails closed', () => {
    const { lock } = buildLock({ leaderboard: loadLeaderboard().slice(0, 40), sources: loadSources(), snapshotTime: 't', source: 's' });
    expect(lock).toEqual({ kind: 'rejected', checkedAt: 't', source: 's', ineligible: ['leaderboard has 40 entries, fewer than 50'] });
  });

  test('verifySnapshot flags a rank above the cutoff', () => {
    const snapshot = registry();
    const tampered = { ...snapshot, skills: snapshot.skills.map((skill) => (skill.name === 'tdd' ? { ...skill, rank: 51 } : skill)) };
    expect(verifySnapshot(tampered)).toEqual(['tdd rank 51 exceeds cutoff 50']);
  });

  test('locked skills record their runtime prerequisites', () => {
    expect(
      registry()
        .skills.filter((skill) => skill.prerequisites.length > 0)
        .map((skill) => [skill.name, skill.prerequisites]),
    ).toEqual([
      ['web-design-guidelines', ['network:https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md']],
      ['agent-browser', ['cli:agent-browser on PATH']],
      ['triage', ['skill:setup-matt-pocock-skills writes docs/agents/issue-tracker.md']],
      ['find-skills', ['cli:skills (npx skills)']],
    ]);
  });
});

describe('snapshot lifecycle', () => {
  test('a required skill leaving the top 50 rejects the new lock', () => {
    const file = parseLeaderboardFile(JSON.parse(readFileSync(fixturePath('leaderboard.diagnosing-bugs-rank-51.json'), 'utf8')));
    if (file.kind === 'invalid') throw new Error(file.reason);
    const { lock } = buildLock({ leaderboard: file.value.entries, sources: loadSources(), snapshotTime: 't', source: 's' });
    expect(lock).toEqual({ kind: 'rejected', checkedAt: 't', source: 's', ineligible: ['diagnosing-bugs'] });
  });

  test('an optional skill leaving the top 50 is dropped from the new lock', () => {
    const demoted = loadLeaderboard().map((entry) => (entry.skillId === 'teach' ? { ...entry, rank: 51 } : entry.rank === 51 ? { ...entry, rank: 18 } : entry));
    const { lock, dropped } = buildLock({ leaderboard: demoted, sources: loadSources(), snapshotTime: 't', source: 's' });
    expect([lock.kind === 'approved' && lock.snapshot.skills.some((skill) => skill.name === 'teach'), dropped]).toEqual([false, ['teach']]);
  });

  const commands: readonly Command[] = [
    { kind: 'advance', to: 'REVERIFY_STALE' },
    { kind: 'invoke_skill', skill: 'tdd' },
    { kind: 'record_evidence', evidence: { claim: 'c', criterion: 'c', state: 'MEASURED', dependencies: [], method: 'cli', expected: 'e', observed: 'o', artifact: 'a' } },
    { kind: 'revision_changed', revision: 'r2', changedPaths: ['src/a.ts'] },
    { kind: 'record_finding', finding: { severity: 'low', trigger: 't', consequence: 'c', evidence: 'e', owner: 'o', reviewer: 'r' } },
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
    expect(parseLock(JSON.parse(JSON.stringify({ schemaVersion: 2, kind: 'approved', snapshot })))).toEqual({ kind: 'ok', value: { kind: 'approved', snapshot } });
  });

  test('a version 1 lock file migrates to an approved lock', () => {
    const snapshot = registry();
    expect(parseLock(JSON.parse(JSON.stringify(snapshot)))).toEqual({ kind: 'ok', value: { kind: 'approved', snapshot } });
  });

  test('parser rejects a lock with cutoff 60', () => {
    expect(parseLock({ schemaVersion: 2, kind: 'approved', snapshot: { ...registry(), cutoff: 60 } })).toEqual({ kind: 'invalid', reason: '$.snapshot.cutoff: expected one of 50' });
  });

  test('frontmatter policy follows disable-model-invocation', () => {
    expect([parseFrontmatter('---\nname: triage\ndisable-model-invocation: true\n---\nbody'), parseFrontmatter('---\nname: tdd\ndescription: x\n---\n')]).toEqual([
      { kind: 'ok', value: { name: 'triage', invocationPolicy: 'user' } },
      { kind: 'ok', value: { name: 'tdd', invocationPolicy: 'model' } },
    ]);
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

  test('captured skills.sh page parses to the committed leaderboard', () => {
    const html = readFileSync(fixturePath('skills-sh.2026-10-07.excerpt.html'), 'utf8');
    const parsed = parseLeaderboardHtml(html);
    expect(parsed.kind === 'ok' ? parsed.value.slice(0, 60) : parsed).toEqual(loadLeaderboard());
  });

  test('missing payload is invalid', () => {
    expect(parseLeaderboardHtml('<html></html>')).toEqual({ kind: 'invalid', reason: 'initialSkills payload not found' });
  });
});
