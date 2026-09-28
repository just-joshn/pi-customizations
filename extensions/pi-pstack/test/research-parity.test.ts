import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFile(join(root, path), 'utf8');

const playbooks = [
  'investigation',
  'bug-fix',
  'perf-issue',
  'hillclimb',
  'runtime-forensics',
  'trace-forensics',
  'feature',
  'refactoring',
  'prototype',
  'visual-parity',
  'authoring-a-skill',
  'eval',
  'babysit',
  'shipping',
  'autonomous-run',
  'orchestrate',
  'autopilot-full',
  'autopilot-stack',
  'session-pickup',
  'pause-safely',
  'multi-phase-plan',
  'worktree-cleanup',
  'opening-a-pr',
];
const principles = [
  'laziness-protocol',
  'foundational-thinking',
  'redesign-from-first-principles',
  'attack-the-premise',
  'subtract-before-you-add',
  'minimize-reader-load',
  'outcome-oriented-execution',
  'experience-first',
  'exhaust-the-design-space',
  'build-the-lever',
  'model-the-domain',
  'boundary-discipline',
  'type-system-discipline',
  'make-operations-idempotent',
  'migrate-callers-then-delete-legacy-apis',
  'separate-before-serializing-shared-state',
  'prove-it-works',
  'fix-root-causes',
  'sequence-verifiable-units',
  'test-behavior-not-implementation',
  'guard-the-context-window',
  'never-block-on-the-human',
  'encode-lessons-in-structure',
];
const roles = [
  'feature, refactoring',
  'bug-fix',
  'perf-issue',
  'hillclimb',
  'judgment and prose',
  'hardest tasks',
  'how explorer',
  'how explainer',
  'why investigators',
  'why synthesizer',
  'reflect tooling',
  'reflect judgment, divergent, synthesizer',
  'arena runners',
  'arena cross-judge pool',
  'swarm workers',
  'architect runners',
  'interrogate reviewers',
];
const transcriptConsumers = [
  'skills/recall/SKILL.md',
  'skills/automate-me/SKILL.md',
  'skills/show-me-your-work/SKILL.md',
  'skills/reflect/SKILL.md',
  'skills/poteto-mode/playbooks/eval.md',
  'skills/poteto-mode/playbooks/session-pickup.md',
  'skills/poteto-mode/playbooks/orchestrate.md',
  'skills/poteto-mode/scripts/worktree-audit.sh',
];

test('poteto-mode routes all 23 documented playbooks and 23 principles', async () => {
  const mode = await read('skills/poteto-mode/SKILL.md');
  expect((await readdir(join(root, 'skills/poteto-mode/playbooks'))).toSorted()).toEqual(playbooks.map((name) => `${name}.md`).toSorted());
  for (const name of playbooks) expect(mode.includes(`playbooks/${name}.md`)).toBe(true);
  expect((await readdir(join(root, 'skills'))).filter((name) => name.startsWith('principle-')).toSorted()).toEqual(principles.map((name) => `principle-${name}`).toSorted());
  for (const name of principles) expect(mode.includes(`**principle-${name}**`)).toBe(true);
});

test('setup keeps the documented 17 roles and four budget labels', async () => {
  const setup = await read('skills/setup-pstack/SKILL.md');
  const models = await read('src/models.ts');
  for (const role of roles) {
    expect(setup.includes(`\n${role}: `)).toBe(true);
    expect(models.includes(`["${role}", `)).toBe(true);
  }
  for (const label of ['unlimited — keep max', 'large — xhigh reasoning', 'medium — high reasoning', 'small — medium reasoning']) {
    expect(setup.includes(`\`${label}\``)).toBe(true);
    expect(models.includes(`"${label}"`)).toBe(true);
  }
});

test('documented agents, team-kit skills, helper scripts, and Benny pack are shipped', async () => {
  const personas = await read('src/personas.ts');
  for (const agent of ['poteto-agent', 'comment-sicko', 'ci-watcher', 'thermo-nuclear-code-quality-review']) expect(personas.includes(`['${agent}'`)).toBe(true);
  const skills = await readdir(join(root, 'skills'));
  for (const skill of ['deslop', 'control-ui', 'control-cli', 'workflow-from-chats', 'unslop', 'how', 'why', 'interrogate', 'arena', 'architect', 'swarm', 'show-me-your-work', 'recall', 'automate-me']) {
    expect(skills.includes(skill)).toBe(true);
  }
  const scripts = await readdir(join(root, 'skills/poteto-mode/scripts'));
  for (const script of ['watch-pr', 'orch', 'check-plan.mjs', 'worktree-audit.sh']) expect(scripts.includes(script)).toBe(true);
  expect((await readdir(join(root, 'upstream/docs/guide'))).filter((name) => /^\d\d-/.test(name)).length).toBe(10);
  expect((await readdir(join(root, 'upstream/automations/benny/skills'))).toSorted()).toEqual(['reproduce-and-fix-issues', 'setup-benny', 'triage-issue-reports']);
  expect(skills.some((skill) => skill.includes('benny') || skill.includes('triage'))).toBe(false);
});

test('transcript consumers read the Pi session store, not Reference agent-transcripts', async () => {
  for (const path of transcriptConsumers) {
    const text = await read(path);
    expect(text.includes('Pi session')).toBe(true);
    expect(text.includes('.upstream/projects')).toBe(false);
    expect(text.includes('agent-transcripts')).toBe(false);
  }
  const recall = await read('skills/recall/SKILL.md');
  expect(recall.includes('`~/.pi/agent/sessions/<slug>/<timestamp>_<uuid>.jsonl`')).toBe(true);
  expect(recall.includes('`/Users/you/proj` becomes `--Users-you-proj--`')).toBe(true);
  expect((await read('skills/reflect/SKILL.md')).includes('<session-dir>/pstack-workers/*/*.jsonl')).toBe(true);
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

async function worktreeFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'pstack-worktrees-')));
  const main = join(directory, 'main');
  await mkdir(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  for (const name of ['from-main', 'own-session', 'idle']) git(main, 'worktree', 'add', '-q', '-b', name, join(directory, name));
  const sessions = join(directory, 'agent', 'sessions');
  const slug = (path: string) => `--${path.slice(1).replaceAll('/', '-')}--`;
  const worker = join(sessions, slug(main), 'pstack-workers', 'parent');
  await mkdir(worker, { recursive: true });
  await writeFile(join(worker, 'child.jsonl'), `{"type":"message","cwd":"${join(directory, 'from-main')}/src"}\n`);
  await mkdir(join(sessions, slug(join(directory, 'own-session'))), { recursive: true });
  await writeFile(join(sessions, slug(join(directory, 'own-session')), 's.jsonl'), `{"type":"session","cwd":"${join(directory, 'own-session')}"}\n`);
  return { directory, main, close: () => rm(directory, { recursive: true, force: true }) };
}

test('worktree audit dates agent activity from Pi sessions and worker transcripts', async () => {
  const f = await worktreeFixture();
  try {
    const output = execFileSync('bash', [join(root, 'skills/poteto-mode/scripts/worktree-audit.sh'), f.main], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: f.directory, PI_CODING_AGENT_DIR: join(f.directory, 'agent'), GH_TOKEN: 'invalid' },
    });
    const today = execFileSync('date', ['+%Y-%m-%d'], { encoding: 'utf8' }).trim();
    const rows = new Map(
      output
        .trim()
        .split('\n')
        .slice(1)
        .map((line) => line.split('\t'))
        .map((cells) => [cells[8].split('/').at(-1), cells]),
    );
    expect([...rows.keys()].toSorted()).toEqual(['from-main', 'idle', 'own-session']);
    expect(rows.get('from-main')?.slice(6, 8)).toEqual([today, 'verify-recent-chat']);
    expect(rows.get('own-session')?.slice(6, 8)).toEqual([today, 'verify-recent-chat']);
    expect(rows.get('idle')?.slice(6, 8)).toEqual(['-', 'review']);
  } finally {
    await f.close();
  }
});

test('host contract names the workspace session directory the transcript skills read', async () => {
  const { hostInstructions } = await import('../src/host.ts');
  const ctx = { cwd: '/w', sessionManager: { getSessionDir: () => '/agent/sessions/--w--', getSessionFile: () => '/agent/sessions/--w--/s.jsonl' } };
  const host = hostInstructions('/pkg', ctx as unknown as Parameters<typeof hostInstructions>[1], '');
  expect(host.includes('Workspace Pi session directory: /agent/sessions/--w--.')).toBe(true);
  expect(host.includes('Task child transcripts: /agent/sessions/--w--/pstack-workers/<parent-session-id>.')).toBe(true);
});

test('host contract maps upstream Reference facilities and tool names to Pi', async () => {
  const { hostInstructions } = await import('../src/host.ts');
  const ctx = { cwd: '/w', sessionManager: { getSessionDir: () => '/s', getSessionFile: () => '/s/f.jsonl' } };
  const host = hostInstructions('/pkg', ctx as unknown as Parameters<typeof hostInstructions>[1], '');
  for (const text of [
    'A Reference rule becomes an AGENTS.md context file',
    'guidance that must apply on every turn belongs in a context file',
    "where a workflow calls for Reference's create-skill",
    'classify the tools that pstack_context returns',
    'Glob is find',
    'appears in the transcript as a <skill name="..."> block',
  ]) {
    expect(host.includes(text)).toBe(true);
  }
  expect(host).toMatch(/Pi's format from \/.+\/docs\/skills\.md/);
});

test('local /loop ships as a Pi skill and template that the host contract names', async () => {
  const skill = await read('host/skills/loop/SKILL.md');
  expect(skill).toMatch(/^---\nname: loop\ndescription: .+\ndisable-model-invocation: true\n---\n/);
  for (const text of ['Usage: /loop [interval] <prompt>', 'notify_on_output: "^AGENT_LOOP_TICK_<purpose>"', 'notify_on_output: "^AGENT_LOOP_WAKE_<purpose>"', 'Background' + 'ShellStop']) expect(skill.includes(text)).toBe(true);
  expect((await read('host/prompts/loop.md')).includes('Read loop/SKILL.md in full under the pstack host skills directory')).toBe(true);
  const { hostInstructions } = await import('../src/host.ts');
  const ctx = { cwd: '/w', sessionManager: { getSessionDir: () => '/s', getSessionFile: () => '/s/f.jsonl' } };
  expect(hostInstructions('/pkg', ctx as unknown as Parameters<typeof hostInstructions>[1], '').includes('/loop is a Pi prompt template for the local loop skill')).toBe(true);
});
