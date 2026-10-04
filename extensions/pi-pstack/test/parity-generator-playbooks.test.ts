import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFile(join(root, 'skills', path), 'utf8');
const playbook = (name: string) => read(`poteto-mode/playbooks/${name}.md`);

test('generated resources do not retain Reference-only nouns and paths', async () => {
  for (const directory of ['skills', 'prompts'])
    for (const name of await readdir(join(root, directory), { recursive: true })) {
      if (!name.endsWith('.md') || name.startsWith('make-bot-ui/') || name.includes('node_modules')) continue;
      const text = await readFile(join(root, directory, name), 'utf8');
      expect(text, `${directory}/${name}`).toMatch(/\S/);
      for (const phrase of [new RegExp(['\\bCur', 'sor\\b'].join('')), /\.upstream\//, /cloud-agent URL/, /state\.vscdb/]) expect(text, `${directory}/${name}`).not.toMatch(phrase);
    }
});

test('native babysit replacements survive mixed-label cleanup', async () => {
  for (const text of [await read('poteto-mode/SKILL.md'), await playbook('babysit')]) {
    expect(text).toContain('Pi has no built-in babysit or autopilot skill, so this playbook is the only route');
    expect(text).not.toMatch(/built-in babysit skill/);
  }
});

test('recovery translates restart and cloud trail identifiers', async () => {
  expect(await read('poteto-mode/SKILL.md')).toContain('going offline, a Pi restart or reload, or imminent context compaction');
  expect(await playbook('orchestrate')).toContain('After a Pi restart or reload:');
  for (const text of [await read('poteto-mode/SKILL.md'), await playbook('session-pickup')]) expect(text).toContain('a cloud Task id (read its record with `TaskOutput` or `TaskAttach`)');
});

test('native store instructions do not restrict portable file ownership', async () => {
  const text = await playbook('orchestrate');
  expect(text).toContain('in the agent store directory the host contract names. Export `ORCH_STORE`');
  expect(text).toContain('or pass `--store <that directory>`, because `orch` fails without one.');
  expect(text).toContain('`orch gate park` writes them, `orch gate list` lists the open ones, and `orch gate resolve` records the answer.');
  expect(text).toContain('`status.md` is derived from `units.tsv` and `ledger.tsv` at each drain');
  expect(text).not.toContain('The files are read-only for humans and agents.');
});

test('cloud status uses native task records without changing lock recovery policy', async () => {
  const text = await playbook('orchestrate');
  expect(text).toContain('`TaskList` with `repository: true`, `TaskAttach` status reads (which reconcile a cloud record without sending a prompt), and `TaskOutput` without resume');
  expect(text).toContain('`orch` replaces a lock whose holder pid is gone.');
  expect(text).not.toContain('retry after a short backoff');
});

test('cleanup translates native directories and the absent chat sidebar only', async () => {
  const text = await playbook('worktree-cleanup');
  expect(text).toContain('`~/.pi/agent` growth (`sessions/` transcripts, `pstack-workers/` child transcripts and Task worktrees, and timer roots)');
  expect(text).toContain('Ask the user for that set, because Pi has no chat sidebar to read it from.');
  expect(text).toContain('`scratch:N` is untracked throwaway, safe to drop, but name the files.');
  expect(text).toContain('Clear only caches the user has not said to keep.');
  expect(text).not.toContain('Before deleting any simulator, runtime, or cache');
});

test('plan writes under the native store docs directory', async () => {
  expect(await playbook('multi-phase-plan')).toContain('write the file under `docs/` in the agent store directory the host contract names');
});

test('router keeps native forge URLs without adding a bot-UI routing requirement', async () => {
  const mode = await read('poteto-mode/SKILL.md');
  expect(mode).toContain('PR link as the URL from the resolved forge (`gh pr view` or `origin pr view`)');
  expect(mode).not.toContain('Bot buttons, bot dashboards, or a bot UI over a routine →');
});

test('create-skill native format guidance survives mixed-label cleanup', async () => {
  expect(await read('poteto-mode/SKILL.md')).toContain('follows the **create-skill** skill for SKILL.md structure and description rules (an imperative `Use when` or `Apply when` trigger clause is accepted)');
  expect(await readFile(join(root, 'host/skills/create-skill/SKILL.md'), 'utf8')).toContain('An imperative trigger clause such as `Use when ...`, `Use for ...`, or `Apply when ...` is the WHEN half and is accepted.');
  const offenders: string[] = [];
  for (const entry of await readdir(join(root, 'skills'), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('principle-') && !/^"?Apply \w+/.test((await read(`${entry.name}/SKILL.md`)).match(/^description: (.*)$/m)?.[1] ?? '')) offenders.push(entry.name);
  }
  expect(offenders).toEqual([]);
});

test('equivalent eval blinding and STACK-READY explanations remain', async () => {
  expect(await playbook('eval')).toContain("Override arena's output paths and worktree names with sanitized project-shaped names");
  expect(await playbook('autopilot-stack')).toContain('STACK-READY means self-proof receipts exist, CI is green, and babysit reports merge-ready at that exact head SHA, with the PR open and ready and nothing merged or armed.');
  expect(await playbook('autopilot-full')).toContain('granted only after verifier proof.');
  expect(await playbook('autopilot-full')).not.toContain("a row in the root's decision trail");
});
