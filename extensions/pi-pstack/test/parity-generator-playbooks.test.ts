import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFile(join(root, 'skills', path), 'utf8');
const playbook = (name: string) => read(`poteto-mode/playbooks/${name}.md`);

async function generatedMarkdown(): Promise<string[]> {
  const paths: string[] = [];
  for (const directory of ['skills', 'prompts']) {
    for (const name of await readdir(join(root, directory), { recursive: true })) {
      if (name.endsWith('.md') && !name.startsWith('make-bot-ui/')) paths.push(join(directory, name));
    }
  }
  return paths.toSorted();
}

test('no generated skill, playbook, or prompt keeps a Reference-only noun or path', async () => {
  const offenders: string[] = [];
  const scanned = await generatedMarkdown();
  for (const path of scanned) {
    const text = await readFile(join(root, path), 'utf8');
    for (const phrase of [new RegExp(['\\bCur', 'sor\\b'].join('')), /\.upstream\//, /cloud-agent URL/, /state\.vscdb/]) {
      if (phrase.test(text)) offenders.push(`${path} ${phrase}`);
    }
  }
  expect(scanned).toContain('skills/poteto-mode/playbooks/babysit.md');
  expect(scanned).toContain('prompts/deslop.md');
  expect(offenders).toEqual([]);
});

test('the router and babysit playbook name no built-in babysit skill that Pi does not ship', async () => {
  const mode = await read('poteto-mode/SKILL.md');
  const babysit = await playbook('babysit');
  expect(mode).toContain('Pi has no built-in babysit or autopilot skill, so this playbook is the only route');
  expect(babysit).toContain('Pi has no built-in babysit or autopilot skill, so this playbook is the only route for these requests.');
  for (const text of [mode, babysit]) expect(text).not.toMatch(/built-in babysit skill/);
});

test('a pause or recovery trigger names a Pi restart or reload, never a Reference restart', async () => {
  expect(await read('poteto-mode/SKILL.md')).toContain('going offline, a Pi restart or reload, or imminent context compaction');
  expect(await playbook('orchestrate')).toContain('After a Pi restart or reload:');
});

test('pause-safely says explicit only contrasts with keep-going phrases and that compaction is automatic', async () => {
  expect(await playbook('pause-safely')).toContain('Explicit only contrasts with keep-going phrases, not with the compaction trigger, which is automatic.');
});

test('session pickup reads a cloud trail by Task id and verifies the inherited result before routing', async () => {
  const pickup = await playbook('session-pickup');
  expect(pickup).toContain('a cloud Task id (read its record with `TaskOutput` or `TaskAttach`)');
  expect(await read('poteto-mode/SKILL.md')).toContain('a cloud Task id (read its record with `TaskOutput` or `TaskAttach`)');
  const steps = pickup.split('\n').filter((line) => /^\d\. /.test(line));
  expect(steps[3]).toContain('Verify the inherited claims against the original goal on the real artifact');
  expect(steps[3]).toContain('Step 3 forbids redoing the work. This step checks the inherited result on the real artifact before routing and does not redo completed work.');
  expect(steps[4]).toContain('Route the remaining work to the matching playbook');
});

test('opening a PR names the playbooks that end in it, and each of them runs it', async () => {
  const named = ['bug-fix', 'perf-issue', 'hillclimb', 'feature', 'refactoring', 'visual-parity', 'authoring-a-skill'];
  const sentence = 'Invoked at the end of every playbook that ships a code change. Those are Bug fix, Perf issue, Hillclimb, Feature, Refactoring, Visual parity, and Authoring a skill.';
  expect(await playbook('opening-a-pr')).toContain(sentence);
  expect(await read('poteto-mode/SKILL.md')).toContain(sentence);
  const running: string[] = [];
  for (const name of (await readdir(join(root, 'skills/poteto-mode/playbooks'))).map((file) => file.replace(/\.md$/, ''))) {
    if (name !== 'opening-a-pr' && /Run \*\*Opening a PR\*\*/.test(await playbook(name))) running.push(name);
  }
  expect(running.toSorted()).toEqual(named.toSorted());
});

test('a subagent that opens a PR runs interrogate only for a contested design', async () => {
  expect(await playbook('opening-a-pr')).toContain('A subagent that opens a PR runs `interrogate` when its design is contested, then `/deslop` and `/no-comments`, and posts the URL.');
});

test('babysit defaults an undeclared request on a small or docs-only PR to check', async () => {
  expect(await playbook('babysit')).toContain('Undeclared defaults to `drive`, except that an undeclared request on a small or docs-only PR defaults to `check`.');
});

test('hillclimb logs to decisions.tsv with the show-me-your-work columns and no playbook names decision.tsv', async () => {
  const hillclimb = await playbook('hillclimb');
  expect(hillclimb).toContain("A `decisions.tsv` with that skill's columns (ts, phase, decision, why, evidence, result), one row per attempt.");
  expect(hillclimb).toContain(
    'Put the attempt id and hypothesis in the decision cell, the change with the before and after numbers and the delta in the evidence cell, and the tests, the verdict (kept or reverted), and the note in the result cell.',
  );
  for (const path of await generatedMarkdown()) expect({ path, names: /\bdecision\.tsv\b/.test(await readFile(join(root, path), 'utf8')) }).toEqual({ path, names: false });
});

test('worktree cleanup names the Pi agent directory, a user-supplied pinned set, and a size-listed confirmation before irreversible deletion', async () => {
  const cleanup = await playbook('worktree-cleanup');
  expect(cleanup).toContain('`~/.pi/agent` growth (`sessions/` transcripts, `pstack-workers/` child transcripts and Task worktrees, and timer roots)');
  expect(cleanup).toContain('Ask the user for that set, because Pi has no chat sidebar to read it from.');
  expect(cleanup).toContain("Before deleting any simulator, runtime, or cache, list each item with its size and get the user's confirmation. The deletion is irreversible.");
  expect(cleanup).toContain('Treat a worktree with any untracked or ignored files as work in progress until the user has seen the file names, never as safe to drop.');
});

test('orchestrate names the agent store, the ORCH_STORE export, and the orch writers that own each file', async () => {
  const text = await playbook('orchestrate');
  expect(text).toContain(
    'in the agent store directory the host contract names. Export `ORCH_STORE` as the path of that `orchestrate/<project-slug>/` directory before the first `orch` call, or pass `--store <that directory>`, because `orch` fails without one.',
  );
  expect(text).toContain('`orch gate park` writes them, `orch gate list` lists the open ones, and `orch gate resolve` records the answer.');
  expect(text).toContain('The files are read-only for humans and agents. Change them only through `orch`, because it fails closed on a hand edit that breaks the exact headers, column widths, gate blocks, or numbering.');
  expect(text).toContain('`status.md` is derived from `units.tsv`, `ledger.tsv`, `frontier.json`, and `gates.md` at each drain');
});

test('orchestrate reads cloud status through Task tools and recovers a stale lock without a second writer', async () => {
  const text = await playbook('orchestrate');
  expect(text).toContain('`TaskList` with `repository: true`, `TaskAttach` status reads (which reconcile a cloud record without sending a prompt), and `TaskOutput` without resume');
  expect(text).toContain("A lock held by a live pid blocks the write, so retry after a short backoff. If an unrelated process reused the dead holder's pid, run the command again with `--force` to steal the lock.");
});

test('orchestrate derives the frontier from the forge when Graphite is absent and checks heads against the forge', async () => {
  const text = await playbook('orchestrate');
  expect(text).toContain("The command derives the chain from `gt` when it is present and from the forge's PR base-branch chain (`gh pr list`) when it is not");
  expect(text).toContain("Run `git fetch` first and check each head against the forge's `headRefOid`");
  expect(text).toContain('Exactly one stacker per stack may restack, with `gt` when the repository uses it, serialized within its stack.');
});

test('the plan writes under the agent store docs directory the host contract names', async () => {
  expect(await playbook('multi-phase-plan')).toContain('write the file under `docs/` in the agent store directory the host contract names');
});

test('the router routes bot buttons and dashboards to make-bot-ui and names the resolved forge for PR links', async () => {
  const mode = await read('poteto-mode/SKILL.md');
  expect(mode).toContain('Bot buttons, bot dashboards, or a bot UI over a routine → the **make-bot-ui** skill.');
  expect(mode).toContain('PR link as the URL from the resolved forge (`gh pr view` or `origin pr view`)');
  expect(mode).not.toContain('PR link as `https://github.com');
});

test('the router limits create-skill to structure and description rules, and the principle descriptions use the imperative trigger clause it accepts', async () => {
  expect(await read('poteto-mode/SKILL.md')).toContain('follows the **create-skill** skill for SKILL.md structure and description rules (an imperative `Use when` or `Apply when` trigger clause is accepted)');
  expect(await readFile(join(root, 'host/skills/create-skill/SKILL.md'), 'utf8')).toContain('An imperative trigger clause such as `Use when ...`, `Use for ...`, or `Apply when ...` is the WHEN half and is accepted.');
  const offenders: string[] = [];
  for (const entry of await readdir(join(root, 'skills'), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('principle-')) continue;
    if (!/^"?Apply \w+/.test((await read(`${entry.name}/SKILL.md`)).match(/^description: (.*)$/m)?.[1] ?? '')) offenders.push(entry.name);
  }
  expect(offenders).toEqual([]);
});

test('the router lists arena and architect among the routed skills that keep their own subagent type', async () => {
  expect(await read('poteto-mode/SKILL.md')).toContain('Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`, `arena`, `architect`) set their own `subagent_type`');
});

test('eval overrides arena output paths so no blinded name contains a forbidden word', async () => {
  expect(await playbook('eval')).toContain("Override arena's output paths and worktree names with sanitized project-shaped names, because arena's defaults contain `arena` and `candidate`, which the blinding rules forbid.");
});

test('the autopilots define STACK-READY and a countersign', async () => {
  expect(await playbook('autopilot-stack')).toContain('STACK-READY means self-proof receipts exist, CI is green, and babysit reports merge-ready at that exact head SHA, with the PR open and ready and nothing merged or armed.');
  expect(await playbook('autopilot-full')).toContain("A countersign is the root's recorded approval of that one raise, a row in the root's decision trail that points at the verifier proof.");
});
