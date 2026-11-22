#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');
const agentsDir = join(root, 'agents');
const rulesDir = join(root, 'rules');

const expectedPstackSkills = [
  'architect',
  'arena',
  'automate-me',
  'benchmark-checklist',
  'blast-radius',
  'bro',
  'correct',
  'create-formal-verification-skill',
  'create-verification-skill',
  'figure-it-out',
  'how',
  'in-your-own-words',
  'interrogate',
  'ketchup',
  'ketchup-video',
  'maintain-formal-verification-skill',
  'maintain-verification-skill',
  'make-bot-ui',
  'no-comments',
  'poteto-help',
  'poteto-mode',
  'recall',
  'reflect',
  'setup-pstack',
  'sharpen',
  'show-me-your-work',
  'statechart',
  'swarm',
  'tdd',
  'teach',
  'technical-writing',
  'typescript-best-practices',
  'unslop',
  'why',
];

const expectedPrinciples = [
  'principle-attack-the-premise',
  'principle-boundary-discipline',
  'principle-build-the-lever',
  'principle-encode-lessons-in-structure',
  'principle-exhaust-the-design-space',
  'principle-experience-first',
  'principle-explain-the-number',
  'principle-fix-root-causes',
  'principle-foundational-thinking',
  'principle-guard-the-context-window',
  'principle-laziness-protocol',
  'principle-make-operations-idempotent',
  'principle-migrate-callers-then-delete-legacy-apis',
  'principle-minimize-reader-load',
  'principle-model-the-domain',
  'principle-never-block-on-the-human',
  'principle-outcome-oriented-execution',
  'principle-prove-it-works',
  'principle-redesign-from-first-principles',
  'principle-separate-before-serializing-shared-state',
  'principle-sequence-verifiable-units',
  'principle-subtract-before-you-add',
  'principle-test-behavior-not-implementation',
  'principle-type-system-discipline',
];

const expectedTeamKitSkills = [
  'check-compiler-errors',
  'control-cli',
  'control-ui',
  'deslop',
  'fix-ci',
  'fix-merge-conflicts',
  'get-pr-comments',
  'loop-on-ci',
  'make-pr-easy-to-review',
  'new-branch-and-pr',
  'pr-review-canvas',
  'review-and-ship',
  'run-smoke-tests',
  'thermo-nuclear-code-quality-review',
  'verify-this',
  'weekly-review',
  'what-did-i-get-done',
  'workflow-from-chats',
];

const expectedAgents = ['poteto-agent.md', 'comment-sicko.md', 'ci-watcher.md', 'thermo-nuclear-code-quality-review.md'];

const expectedRules = ['no-inline-imports.md', 'typescript-exhaustive-switch.md'];

const expectedPlaybooks = [
  'authoring-a-skill',
  'autonomous-run',
  'autopilot-full',
  'autopilot-stack',
  'babysit',
  'bug-fix',
  'eval',
  'feature',
  'hillclimb',
  'investigation',
  'multi-phase-plan',
  'opening-a-pr',
  'pause-safely',
  'perf-issue',
  'prototype',
  'refactoring',
  'runtime-forensics',
  'session-pickup',
  'shipping',
  'trace-forensics',
  'visual-parity',
  'worktree-cleanup',
];

const portableFrontmatterKeys = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'disable-model-invocation']);

function frontmatterKeys(skillMd) {
  const text = readFileSync(skillMd, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return [...match[1].matchAll(/^([A-Za-z0-9_-]+):/gm)].map((m) => m[1]);
}

const present = new Set(readdirSync(skillsDir));
const allExpectedSkills = [...expectedPstackSkills, ...expectedPrinciples, ...expectedTeamKitSkills];
const missingSkills = allExpectedSkills.filter((n) => !present.has(n));
const missingAgents = expectedAgents.filter((a) => !existsSync(join(agentsDir, a)));
const missingRules = expectedRules.filter((r) => !existsSync(join(rulesDir, r)));
const playbookDir = join(skillsDir, 'poteto-mode', 'playbooks');
const missingPlaybooks = expectedPlaybooks.filter((p) => !existsSync(join(playbookDir, `${p}.md`)));

const failures = [];
if (missingSkills.length) failures.push(`missing skills: ${missingSkills.join(', ')}`);
if (missingAgents.length) failures.push(`missing agents: ${missingAgents.join(', ')}`);
if (missingRules.length) failures.push(`missing rules: ${missingRules.join(', ')}`);
if (missingPlaybooks.length) failures.push(`missing playbooks: ${missingPlaybooks.join(', ')}`);

for (const name of allExpectedSkills) {
  const skillMd = join(skillsDir, name, 'SKILL.md');
  if (!existsSync(skillMd) || readFileSync(skillMd, 'utf8').length < 20) {
    failures.push(`empty or missing SKILL.md: ${name}`);
    continue;
  }
  const keys = frontmatterKeys(skillMd);
  if (!keys) {
    failures.push(`missing frontmatter: ${name}`);
    continue;
  }
  if (!keys.includes('name') || !keys.includes('description')) {
    failures.push(`frontmatter missing name/description: ${name}`);
  }
  const nonPortable = keys.filter((k) => !portableFrontmatterKeys.has(k));
  if (nonPortable.length) {
    failures.push(`non-portable frontmatter in ${name}: ${nonPortable.join(', ')}`);
  }
}

const cursorLeftovers = [];
for (const agent of expectedAgents) {
  const text = readFileSync(join(agentsDir, agent), 'utf8');
  if (/\bTask\b/.test(text) || /cursor-team-kit plugin/.test(text) || /^model:\s*fast\s*$/m.test(text)) {
    cursorLeftovers.push(agent);
  }
}
if (cursorLeftovers.length) failures.push(`Cursor leftovers in agents: ${cursorLeftovers.join(', ')}`);

if (failures.length) {
  throw new Error(failures.join('\n'));
}

console.info(
  JSON.stringify(
    {
      pstackSkills: expectedPstackSkills.length,
      principles: expectedPrinciples.length,
      teamKitSkills: expectedTeamKitSkills.length,
      playbooks: expectedPlaybooks.length,
      agents: expectedAgents.length,
      rules: expectedRules.length,
      ok: true,
    },
    null,
    2,
  ),
);
