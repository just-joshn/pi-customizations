import { join } from 'node:path';

export interface RouteCase {
  id: string;
  prompt: string;
  expected: string;
  noPr?: boolean;
  previous?: { prompt: string; expected: string };
}

export const playbookCases: readonly RouteCase[] = [
  { id: 'investigation', prompt: 'Explain why a cache entry can survive logout. Do not change code.', expected: 'investigation', noPr: true },
  { id: 'bug-fix', prompt: 'Logout leaves a stale cache entry. Reproduce the defect and fix it.', expected: 'bug-fix' },
  { id: 'feature', prompt: 'Add a CSV export button to the existing reports screen.', expected: 'feature' },
  { id: 'refactoring', prompt: 'Split the parser module into smaller files without changing observable behavior.', expected: 'refactoring' },
  { id: 'perf-issue', prompt: 'An endpoint regressed from 100 ms to 1.2 seconds. Profile and fix this measured regression.', expected: 'perf-issue' },
  { id: 'hillclimb', prompt: 'Hillclimb parser throughput against a fixed workload. Iterate measured hypotheses, keeping only verified wins.', expected: 'hillclimb' },
  { id: 'runtime-forensics', prompt: 'The app is running and its idle CPU keeps rising. Attach instrumentation and diagnose it, without fixing anything.', expected: 'runtime-forensics', noPr: true },
  { id: 'trace-forensics', prompt: 'I supplied a captured .cpuprofile. Diagnose the CPU hotspot from that artifact; do not modify the app.', expected: 'trace-forensics', noPr: true },
  { id: 'prototype', prompt: 'Build a throwaway sketch to decide whether a virtual list fits this interaction before committing to an implementation.', expected: 'prototype', noPr: true },
  { id: 'visual-parity', prompt: 'Make this page match the supplied reference screenshot pixel for pixel.', expected: 'visual-parity' },
  { id: 'authoring-a-skill', prompt: 'Create a new agent skill with a SKILL.md for reviewing database migrations.', expected: 'authoring-a-skill' },
  { id: 'eval', prompt: 'Evaluate whether a revised agent prompt improves task behavior before promoting that prompt.', expected: 'eval' },
  { id: 'babysit', prompt: 'Get the checks green and address review comments on PR 12. Stop at merge-ready.', expected: 'babysit' },
  { id: 'shipping', prompt: 'Land the already-green PR stack. You have my merge grant, but independently verify each PR before landing it.', expected: 'shipping' },
  { id: 'autonomous-run', prompt: 'Use the Autonomous run playbook for this one task, with a checkable stop predicate rather than a standing program.', expected: 'autonomous-run' },
  { id: 'orchestrate', prompt: 'Own this multi-day migration program across many PRs and a fleet of independent agents under a standing coordinator.', expected: 'orchestrate' },
  { id: 'autopilot-full', prompt: 'Autopilot this queue of independent PRs through verification and authorized merges, with one owner per PR.', expected: 'autopilot-full' },
  { id: 'autopilot-stack', prompt: 'Autopilot this queue into a verified PR stack, but do not merge anything. I will land it.', expected: 'autopilot-stack' },
  { id: 'session-pickup', prompt: 'Take over this earlier agent session and resume its in-flight task from its transcript and branch.', expected: 'session-pickup' },
  { id: 'pause-safely', prompt: 'Pause the current work safely before this session ends and persist enough state for a later pickup.', expected: 'pause-safely' },
  { id: 'multi-phase-plan', prompt: 'Write the phased implementation plan for three dependent PRs. Do not start implementation yet.', expected: 'multi-phase-plan' },
  { id: 'worktree-cleanup', prompt: 'Reclaim disk from merged or abandoned worktrees and stale iOS simulators while preserving active work and user changes.', expected: 'worktree-cleanup' },
  { id: 'opening-a-pr', prompt: 'The isolated change is already verified and committed. Open its pull request; do not merge it.', expected: 'opening-a-pr' },
];

export const overrideCases: readonly RouteCase[] = [
  { id: 'large-feature', prompt: 'Add single sign-on across six services, migrate existing users, and coordinate the staged rollout. This is a large research-and-delivery task.', expected: 'figure-it-out' },
  { id: 'unattended-feature', prompt: 'Implement the new export feature while I sleep. I will audit your evidence and decision trail tomorrow.', expected: 'figure-it-out' },
  {
    id: 'new-task-readonly',
    previous: { prompt: 'Add a CSV export button to the reports screen.', expected: 'feature' },
    prompt: 'New task. Explain why the cache survives logout. Do not change any code and do not open a PR.',
    expected: 'investigation',
    noPr: true,
  },
];

export const routeCases = [...playbookCases, ...overrideCases];
export const routePath = (root: string, route: string) => (route === 'figure-it-out' ? join(root, 'generated/skills/figure-it-out/SKILL.md') : join(root, 'generated/skills/poteto-mode/playbooks', `${route}.md`));
