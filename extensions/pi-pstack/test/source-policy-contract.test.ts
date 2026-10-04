import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { roleNames } from '../src/models.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFile(join(root, path), 'utf8');
const contracts = [
  { path: 'skills/interrogate/SKILL.md', phrases: ['- The code itself', "If you're unsure about the intent, ask the user before proceeding.", 'open a separate PR to update the default table.'] },
  { path: 'skills/no-comments/SKILL.md', phrases: ['1. Spawn `Task` with `subagent_type: "Comment Sicko"`. Pass the scope.', 'Otherwise delete, report the constraint open, and sketch out-of-scope work.'] },
  { path: 'skills/why/SKILL.md', phrases: ['Two valid reasons:', 'Map each available MCP to one evidence category'] },
  { path: 'skills/reflect/SKILL.md', phrases: ['Backlog items file to whatever devex / backlog tracker your team uses automatically. Only the Accepted list waits for approval.'] },
  { path: 'skills/poteto-mode/SKILL.md', phrases: ['Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`) set', 'Invoked at the end of every other playbook.'] },
  {
    path: 'skills/poteto-mode/playbooks/opening-a-pr.md',
    phrases: ['A subagent that opens a PR runs `interrogate`, `/deslop`, and `/no-comments`, and posts the URL.', 'With Origin, pass `--status open`.', 'create a child with `origin pr create --status open --base <parent-branch>` or'],
  },
  { path: 'skills/poteto-mode/playbooks/babysit.md', phrases: ['Undeclared defaults to `drive`. Small or docs-only PRs get `check`, not `drive`.', '`origin pr thread list <pr>`, and'] },
  { path: 'skills/poteto-mode/playbooks/hillclimb.md', phrases: ['A `decision.tsv`, one row per attempt: id, hypothesis, change, before, after, delta, tests, verdict (kept or reverted), note.'] },
  {
    path: 'skills/poteto-mode/playbooks/multi-phase-plan.md',
    phrases: [
      '**Control skill.** Pick it by surface.',
      "<Deliver input only through the control skill's commands. Name the read-only diagnostics.>",
      '- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.',
    ],
  },
  {
    path: 'skills/poteto-mode/playbooks/orchestrate.md',
    phrases: ['while its canonical plain TSV and JSON stay readable without the CLI.', 'Recompute `frontier.json` from `gt` after every merge and stack mutation', 'Exactly one stacker per stack may run `gt`, serialized within its stack.'],
  },
];

for (const { path, phrases } of contracts) {
  test(`${path} preserves its source policy contract`, async () => {
    const source = await read(`upstream/${path}`);
    const generated = await read(path);
    for (const phrase of phrases) {
      expect(source).toContain(phrase);
      expect(generated).toContain(phrase);
    }
  });
}

const rejected = [
  { path: 'skills/principle-prove-it-works/SKILL.md', phrase: '**Delegation.** Trust artifacts, not self-reports.' },
  { path: 'skills/principle-sequence-verifiable-units/SKILL.md', phrase: 'breakage the plan scoped as temporary between boundaries is not red' },
  { path: 'skills/swarm/SKILL.md', phrase: 'Also drop a result that does not cover its named slice' },
  { path: 'skills/poteto-mode/playbooks/shipping.md', phrase: 'For a result from `verify-this`, map' },
  { path: 'skills/poteto-mode/playbooks/multi-phase-plan.md', phrase: 'Before capturing or storing screenshots or video from a privacy-sensitive workspace' },
  { path: 'skills/poteto-mode/playbooks/multi-phase-plan.md', phrase: 'Check whether the workspace is privacy-sensitive before capturing' },
  { path: 'skills/poteto-mode/playbooks/autonomous-run.md', phrase: 'Arm a `/goal` with `CreateGoal`' },
  { path: 'skills/poteto-mode/playbooks/autopilot-full.md', phrase: "a row in the root's decision trail" },
  { path: 'skills/poteto-mode/playbooks/autopilot-stack.md', phrase: "receipt of files touched and edits per focus area goes in the owner's report" },
  { path: 'skills/poteto-mode/playbooks/pause-safely.md', phrase: 'Explicit only contrasts with keep-going phrases' },
  { path: 'skills/poteto-mode/playbooks/worktree-cleanup.md', phrase: 'Treat a worktree with any untracked or ignored files as work in progress' },
  { path: 'skills/poteto-mode/playbooks/worktree-cleanup.md', phrase: 'Before deleting any simulator, runtime, or cache' },
  { path: 'skills/poteto-mode/playbooks/orchestrate.md', phrase: 'The files are read-only for humans and agents.' },
  { path: 'skills/poteto-mode/playbooks/orchestrate.md', phrase: 'Park each with `orch gate park` before asking' },
  { path: 'skills/poteto-mode/playbooks/orchestrate.md', phrase: 'retry after a short backoff' },
  { path: 'skills/poteto-mode/references/bugbot-triage.md', phrase: 'Under a full-autonomy grant, decide an `ask` finding' },
  { path: 'skills/interrogate/references/code-quality-review.md', phrase: 'Keep the two in sync.' },
];
for (const { path, phrase } of rejected) {
  test(`${path} does not add ${phrase}`, async () => {
    expect(await read(`upstream/${path}`)).not.toContain(phrase);
    expect(await read(path)).not.toContain(phrase);
  });
}

test('setup exposes exactly the source-defined role tuple, without port-added consumers', async () => {
  const source = await read('upstream/skills/setup-pstack/SKILL.md');
  const sourceRoles = [...source.matchAll(/^([\w ,-]+): (?:grok|claude|gpt)[^\n]+$/gm)].map((match) => match[1]);
  expect(sourceRoles).toHaveLength(17);
  expect(roleNames).toEqual(sourceRoles);
  for (const role of ['trail reviewer', 'figure-it-out judge', 'recall miners']) {
    expect(await read('skills/setup-pstack/SKILL.md')).not.toContain(`${role}:`);
  }
  for (const path of ['show-me-your-work', 'figure-it-out', 'recall']) {
    expect(await read(`skills/${path}/SKILL.md`)).not.toMatch(/(?:trail reviewer|figure-it-out judge|recall miners)` line/);
  }
});

test('helper manifests retain source dependency specifications', async () => {
  for (const path of ['package.json', 'bun.lock']) {
    const relative = `skills/poteto-mode/scripts/${path}`;
    expect(await read(relative)).toBe(await read(`upstream/${relative}`));
  }
});

test('session pickup keeps source route-before-verification ordering', async () => {
  const path = 'skills/poteto-mode/playbooks/session-pickup.md';
  for (const prefix of ['', 'upstream/']) {
    const text = await read(`${prefix}${path}`);
    expect(text).toMatch(/4\. Route the remaining work[\s\S]*5\. Verify the inherited claims/);
  }
});
