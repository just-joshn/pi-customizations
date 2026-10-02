import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const modeDirectory = join(root, 'skills/poteto-mode');

async function markdownFiles(directory: string): Promise<string[]> {
  const names = await readdir(join(root, directory), { recursive: true });
  return names
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(directory, name))
    .toSorted();
}

async function playbook(name: string): Promise<string> {
  return readFile(join(modeDirectory, `playbooks/${name}.md`), 'utf8');
}

async function skeleton(): Promise<string> {
  const text = await playbook('multi-phase-plan');
  const match = text.match(/````markdown\n([\s\S]*?)\n````/);
  if (!match) throw new Error('multi-phase-plan.md has no skeleton fence');
  return `${match[1]}\n`;
}

function checkPlan(plan: string, cwd: string) {
  return spawnSync(process.execPath, ['scripts/check-plan.mjs', plan], { cwd, encoding: 'utf8' });
}

async function withPlan<T>(text: string, run: (path: string) => T): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-plan-'));
  try {
    const path = join(directory, 'plan.md');
    await writeFile(path, text);
    return run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('no generated skill or prompt names a repository-root pstack path in a command or git show', async () => {
  const offenders: string[] = [];
  for (const directory of ['skills', 'prompts']) {
    for (const path of await markdownFiles(directory)) {
      const text = await readFile(join(root, path), 'utf8');
      if (/extensions\/pi-pstack\/|(?<![\w/-])pstack\/skills\//.test(text)) offenders.push(path);
    }
  }
  expect(offenders).toEqual([]);
});

test('playbooks and references name no file-relative parent path, so every bundled path resolves from the poteto-mode skill directory', async () => {
  const unresolved: string[] = [];
  for (const path of [...(await markdownFiles('skills/poteto-mode/playbooks')), ...(await markdownFiles('skills/poteto-mode/references')), 'skills/poteto-mode/SKILL.md']) {
    const text = await readFile(join(root, path), 'utf8');
    for (const [, token] of text.matchAll(/`((?:\.\.\/|scripts\/|playbooks\/|references\/)[^`\s<>]*)[^`]*`/g)) {
      if (token?.startsWith('../') || !existsSync(join(modeDirectory, token ?? ''))) unresolved.push(`${path} ${token}`);
    }
  }
  expect(unresolved).toEqual([]);
});

test('the plan skeleton carries no relative parent path that would resolve against the written plan file', async () => {
  expect(await skeleton()).not.toContain('../');
});

test('the plan check command runs from the poteto-mode skill directory against a plan outside the repository', async () => {
  const text = await playbook('multi-phase-plan');
  expect(text).toContain('Run `node scripts/check-plan.mjs <plan.md>` with the working directory set to the poteto-mode skill directory that the host contract names, passing the plan as an absolute path');
  const result = await withPlan('# Not a plan\n', (path) => checkPlan(path, modeDirectory));
  expect({ status: result.status, named: /plan\.md:\d+: /.test(result.stdout + result.stderr) }).toEqual({ status: 1, named: true });
});

test('plan skeleton re-reads name the bundled copy and keep the trunk read the plan check requires', async () => {
  const plan = await skeleton();
  expect(plan).toContain('Read a file from trunk with `git show origin/main:<repo path>` when the target repository commits it. Otherwise read the bundled copy at the path the host contract names.');
  expect(plan).toContain('The program runs the bundled `playbooks/<execution playbook>.md` in the poteto-mode skill directory.');
  expect(plan).toContain('per the **swarm** skill');
  expect(plan).toContain('Which PRs get the **how** skill and the **interrogate** skill. The trail per the **show-me-your-work** skill.');
  expect(plan).toContain('Triage every Bugbot and security-reviewer comment per the bundled `references/bugbot-triage.md`');
});

test('the generated plan skeleton fails the plan check only for the unfilled model lane line', async () => {
  const result = await withPlan(await skeleton(), (path) => checkPlan(path, modeDirectory));
  expect(result.stdout.trim().split('\n').at(-1)).toBe('1 PR sections, 1 problems');
  expect(result.stderr.trim().split('\n')).toEqual([expect.stringMatching(/Verify, live lacks "Ten lanes on `<swarm workers model>` at the PR head" with the model filled in$/)]);
  expect(result.status).toBe(1);
});

test('the generated plan skeleton passes the plan check once the model lane line is filled', async () => {
  const filled = (await skeleton()).replace('Ten lanes on `<swarm workers model>`', 'Ten lanes on `test-model`');
  const result = await withPlan(filled, (path) => checkPlan(path, modeDirectory));
  expect(result.stdout.trim().split('\n').at(-1)).toBe('1 PR sections, 0 problems');
  expect(result.status).toBe(0);
});

test('plan skeleton keeps the trunk read, the 30-minute tick, and the review gate words the plan check pins', async () => {
  const plan = await skeleton();
  expect(plan).toContain('git show origin/main:');
  expect(plan).toMatch(/30[- ]minute/);
  const gate = plan.match(/- \[ \] Hold the review gate\.[^\n]*/)?.[0] ?? '';
  for (const word of ['screenshot', 'video', 'operator']) expect(gate).toContain(word);
});

test('both autopilots re-read their own playbook from trunk or the bundled copy, never a repository-root path', async () => {
  for (const name of ['autopilot-full', 'autopilot-stack']) {
    const text = await playbook(name);
    expect(text).toContain(
      `re-read this playbook. When the target repository commits it, read it from trunk with \`git show origin/main:<repo path>\`. Otherwise read the bundled \`playbooks/${name}.md\` in the poteto-mode skill directory the host contract names, then re-read the armed \`/goal\`.`,
    );
  }
});

test('the plan check names the missing goal marker and passes once the skeleton carries it', async () => {
  const filled = (await skeleton()).replace('Ten lanes on `<swarm workers model>`', 'Ten lanes on `test-model`');
  const without = filled.replaceAll('/goal', 'the goal');
  const missing = await withPlan(without, (path) => checkPlan(path, modeDirectory));
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain('Program checklist lacks "/goal"');
  const present = await withPlan(filled, (path) => checkPlan(path, modeDirectory));
  expect(present.status).toBe(0);
});
