import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_EDGES: readonly { readonly file: string; readonly edge: string; readonly pattern: RegExp }[] = [
  // Invoke edges
  { file: 'skills/poteto-mode/playbooks/feature.md', edge: 'feature -> control-ui', pattern: /control-ui/i },
  { file: 'skills/poteto-mode/playbooks/feature.md', edge: 'feature -> control-cli', pattern: /control-cli/i },
  { file: 'skills/poteto-mode/playbooks/feature.md', edge: 'feature -> swarm', pattern: /\bswarm\b/i },
  { file: 'skills/poteto-mode/playbooks/hillclimb.md', edge: 'hillclimb -> swarm', pattern: /\bswarm\b/i },
  { file: 'skills/poteto-mode/playbooks/multi-phase-plan.md', edge: 'multi-phase-plan -> architect', pattern: /\barchitect\b/i },
  { file: 'skills/poteto-mode/playbooks/shipping.md', edge: 'shipping -> swarm', pattern: /\bswarm\b/i },
  { file: 'skills/poteto-mode/playbooks/opening-a-pr.md', edge: 'opening-a-pr -> technical-writing', pattern: /technical-writing/i },
  { file: 'automations/benny/skills/triage-issue-reports/SKILL.md', edge: 'benny-triage -> why', pattern: /\bwhy\b/i },
  { file: 'automations/benny/skills/triage-issue-reports/SKILL.md', edge: 'benny-triage -> unslop', pattern: /\bunslop\b/i },
  { file: 'automations/benny/skills/reproduce-and-fix-issues/SKILL.md', edge: 'benny-repro -> why', pattern: /\bwhy\b/i },
  { file: 'automations/benny/skills/reproduce-and-fix-issues/SKILL.md', edge: 'benny-repro -> unslop', pattern: /\bunslop\b/i },
  // Principle edges
  { file: 'skills/poteto-mode/playbooks/bug-fix.md', edge: 'bug-fix -> fix-root-causes', pattern: /fix-root-causes/i },
  { file: 'skills/poteto-mode/playbooks/perf-issue.md', edge: 'perf-issue -> explain-the-number', pattern: /explain-the-number/i },
  { file: 'skills/poteto-mode/playbooks/eval.md', edge: 'eval -> explain-the-number', pattern: /explain-the-number/i },
  { file: 'skills/poteto-mode/playbooks/eval.md', edge: 'eval -> guard-the-context-window', pattern: /guard-the-context-window/i },
  { file: 'skills/poteto-mode/playbooks/shipping.md', edge: 'shipping -> prove-it-works', pattern: /prove-it-works/i },
  { file: 'skills/poteto-mode/playbooks/autopilot-full.md', edge: 'autopilot-full -> prove-it-works', pattern: /prove-it-works/i },
  { file: 'skills/poteto-mode/playbooks/autopilot-full.md', edge: 'autopilot-full -> separate-before-serializing-shared-state', pattern: /separate-before-serializing-shared-state/i },
  { file: 'skills/poteto-mode/playbooks/opening-a-pr.md', edge: 'opening-a-pr -> sequence-verifiable-units', pattern: /sequence-verifiable-units/i },
  { file: 'skills/swarm/SKILL.md', edge: 'swarm -> separate-before-serializing-shared-state', pattern: /separate-before-serializing-shared-state/i },
  { file: 'skills/interrogate/SKILL.md', edge: 'interrogate -> prove-it-works', pattern: /prove-it-works/i },
  { file: 'skills/tdd/SKILL.md', edge: 'tdd -> test-behavior-not-implementation', pattern: /test-behavior-not-implementation/i },
  { file: 'skills/statechart/SKILL.md', edge: 'statechart -> prove-it-works', pattern: /prove-it-works/i },
  { file: 'skills/blast-radius/SKILL.md', edge: 'blast-radius -> prove-it-works', pattern: /prove-it-works/i },
  { file: 'skills/benchmark-checklist/SKILL.md', edge: 'benchmark-checklist -> explain-the-number', pattern: /explain-the-number/i },
  { file: 'skills/show-me-your-work/SKILL.md', edge: 'show-me-your-work -> prove-it-works', pattern: /prove-it-works/i },
  { file: 'skills/reflect/SKILL.md', edge: 'reflect -> encode-lessons-in-structure', pattern: /encode-lessons-in-structure/i },
  { file: 'skills/correct/SKILL.md', edge: 'correct -> encode-lessons-in-structure', pattern: /encode-lessons-in-structure/i },
  { file: 'automations/benny/skills/reproduce-and-fix-issues/SKILL.md', edge: 'benny-repro -> guard-the-context-window', pattern: /guard-the-context-window/i },
  { file: 'automations/benny/skills/reproduce-and-fix-issues/SKILL.md', edge: 'benny-repro -> sequence-verifiable-units', pattern: /sequence-verifiable-units/i },
  { file: 'automations/benny/skills/reproduce-and-fix-issues/SKILL.md', edge: 'benny-repro -> fix-root-causes', pattern: /fix-root-causes/i },
  { file: 'automations/benny/skills/reproduce-and-fix-issues/SKILL.md', edge: 'benny-repro -> prove-it-works', pattern: /prove-it-works/i },
  // Handoff edges
  { file: 'skills/poteto-mode/playbooks/runtime-forensics.md', edge: 'runtime-forensics -> perf-issue', pattern: /perf-issue|Perf issue/ },
  { file: 'skills/poteto-mode/playbooks/pause-safely.md', edge: 'pause-safely -> autonomous-run', pattern: /autonomous-run|Autonomous run/ },
  { file: 'skills/principle-fix-root-causes/SKILL.md', edge: 'fix-root-causes -> bug-fix', pattern: /bug-fix|Bug fix/ },
  { file: 'skills/principle-prove-it-works/SKILL.md', edge: 'prove-it-works -> create-verification-skill', pattern: /create-verification-skill/i },
  { file: 'skills/principle-guard-the-context-window/SKILL.md', edge: 'guard-the-context-window -> swarm', pattern: /\bswarm\b/i },
  { file: 'skills/principle-separate-before-serializing-shared-state/SKILL.md', edge: 'separate-before-serializing-shared-state -> swarm', pattern: /\bswarm\b/i },
  { file: 'skills/principle-attack-the-premise/SKILL.md', edge: 'attack-the-premise -> hillclimb', pattern: /hillclimb|Hillclimb/ },
];

describe('pstack behavior graph cross-file edge parity', () => {
  test('every required invoke, principle, and handoff edge is explicitly wired in its source file', () => {
    const missing = REQUIRED_EDGES.filter(({ file, pattern }) => !pattern.test(readFileSync(join(root, file), 'utf8'))).map(({ edge, file }) => `${edge} (${file})`);
    expect(missing).toEqual([]);
  });
});
