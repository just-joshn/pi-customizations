import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFile(join(root, path), 'utf8');

const playbooks = [
  'investigation', 'bug-fix', 'perf-issue', 'hillclimb', 'runtime-forensics', 'trace-forensics', 'feature',
  'refactoring', 'prototype', 'visual-parity', 'authoring-a-skill', 'eval', 'babysit', 'shipping', 'autonomous-run',
  'orchestrate', 'autopilot-full', 'autopilot-stack', 'session-pickup', 'pause-safely', 'multi-phase-plan',
  'worktree-cleanup', 'opening-a-pr',
];
const principles = [
  'laziness-protocol', 'foundational-thinking', 'redesign-from-first-principles', 'attack-the-premise',
  'subtract-before-you-add', 'minimize-reader-load', 'outcome-oriented-execution', 'experience-first',
  'exhaust-the-design-space', 'build-the-lever', 'model-the-domain', 'boundary-discipline', 'type-system-discipline',
  'make-operations-idempotent', 'migrate-callers-then-delete-legacy-apis', 'separate-before-serializing-shared-state',
  'prove-it-works', 'fix-root-causes', 'sequence-verifiable-units', 'test-behavior-not-implementation',
  'guard-the-context-window', 'never-block-on-the-human', 'encode-lessons-in-structure',
];
const roles = [
  'feature, refactoring', 'bug-fix', 'perf-issue', 'hillclimb', 'judgment and prose', 'hardest tasks', 'how explorer',
  'how explainer', 'why investigators', 'why synthesizer', 'reflect tooling', 'reflect judgment, divergent, synthesizer',
  'arena runners', 'arena cross-judge pool', 'swarm workers', 'architect runners', 'interrogate reviewers',
];
const transcriptConsumers = [
  'skills/recall/SKILL.md', 'skills/automate-me/SKILL.md', 'skills/show-me-your-work/SKILL.md',
  'skills/reflect/SKILL.md', 'skills/poteto-mode/playbooks/eval.md', 'skills/poteto-mode/playbooks/session-pickup.md',
  'skills/poteto-mode/playbooks/orchestrate.md', 'skills/poteto-mode/scripts/worktree-audit.sh',
];

test('poteto-mode routes all 23 documented playbooks and 23 principles', async () => {
  const mode = await read('skills/poteto-mode/SKILL.md');
  assert.deepEqual((await readdir(join(root, 'skills/poteto-mode/playbooks'))).toSorted(), playbooks.map(name => `${name}.md`).toSorted());
  for (const name of playbooks) assert.ok(mode.includes(`playbooks/${name}.md`), `mode routes ${name}`);
  assert.deepEqual((await readdir(join(root, 'skills'))).filter(name => name.startsWith('principle-')).toSorted(), principles.map(name => `principle-${name}`).toSorted());
  for (const name of principles) assert.ok(mode.includes(`**principle-${name}**`), `mode cites ${name}`);
});

test('setup keeps the documented 17 roles and four budget labels', async () => {
  const setup = await read('skills/setup-pstack/SKILL.md');
  const models = await read('src/models.ts');
  for (const role of roles) assert.ok(setup.includes(`\n${role}: `) && models.includes(`["${role}", `), role);
  for (const label of ['unlimited — keep max', 'large — xhigh reasoning', 'medium — high reasoning', 'small — medium reasoning']) {
    assert.ok(setup.includes(`\`${label}\``) && models.includes(`"${label}"`), label);
  }
});

test('documented agents, team-kit skills, helper scripts, and Benny pack are shipped', async () => {
  const personas = await read('src/personas.ts');
  for (const agent of ['poteto-agent', 'comment-sicko', 'ci-watcher', 'thermo-nuclear-code-quality-review']) assert.ok(personas.includes(`['${agent}'`), agent);
  const skills = await readdir(join(root, 'skills'));
  for (const skill of ['deslop', 'control-ui', 'control-cli', 'workflow-from-chats', 'unslop', 'how', 'why', 'interrogate', 'arena', 'architect', 'swarm', 'show-me-your-work', 'recall', 'automate-me']) {
    assert.ok(skills.includes(skill), skill);
  }
  const scripts = await readdir(join(root, 'skills/poteto-mode/scripts'));
  for (const script of ['watch-pr', 'orch', 'check-plan.mjs', 'worktree-audit.sh']) assert.ok(scripts.includes(script), script);
  assert.equal((await readdir(join(root, 'upstream/docs/guide'))).filter(name => /^\d\d-/.test(name)).length, 10);
  assert.deepEqual((await readdir(join(root, 'upstream/automations/benny/skills'))).toSorted(), ['reproduce-and-fix-issues', 'setup-benny', 'triage-issue-reports']);
  assert.ok(!skills.some(skill => skill.includes('benny') || skill.includes('triage')));
});

test('transcript consumers read the Pi session store, not Reference agent-transcripts', async () => {
  for (const path of transcriptConsumers) {
    const text = await read(path);
    assert.ok(!text.includes('.upstream/projects') && !text.includes('agent-transcripts'), `${path} names no Reference transcript store`);
  }
  const recall = await read('skills/recall/SKILL.md');
  assert.ok(recall.includes('`~/.pi/agent/sessions/<slug>/<timestamp>_<uuid>.jsonl`'), 'recall names the Pi layout');
  assert.ok(recall.includes('`/Users/you/proj` becomes `--Users-you-proj--`'), 'recall names the Pi slug');
  assert.ok((await read('skills/reflect/SKILL.md')).includes('<session-dir>/pstack-workers/*/*.jsonl'), 'reflect lists Task child transcripts');
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
      encoding: 'utf8', stdio: 'pipe',
      env: { ...process.env, HOME: f.directory, PI_CODING_AGENT_DIR: join(f.directory, 'agent'), GH_TOKEN: 'invalid' },
    });
    const today = execFileSync('date', ['+%Y-%m-%d'], { encoding: 'utf8' }).trim();
    const rows = new Map(output.trim().split('\n').slice(1).map(line => line.split('\t')).map(cells => [cells[8].split('/').at(-1), cells]));
    assert.deepEqual([...rows.keys()].toSorted(), ['from-main', 'idle', 'own-session']);
    assert.deepEqual(rows.get('from-main')?.slice(6, 8), [today, 'verify-recent-chat']);
    assert.deepEqual(rows.get('own-session')?.slice(6, 8), [today, 'verify-recent-chat']);
    assert.deepEqual(rows.get('idle')?.slice(6, 8), ['-', 'review']);
  } finally { await f.close(); }
});

test('host contract names the workspace session directory the transcript skills read', async () => {
  const { hostInstructions } = await import('../src/host.ts');
  const ctx = { cwd: '/w', sessionManager: { getSessionDir: () => '/agent/sessions/--w--', getSessionFile: () => '/agent/sessions/--w--/s.jsonl' } };
  const host = hostInstructions('/pkg', ctx as unknown as Parameters<typeof hostInstructions>[1], '');
  assert.ok(host.includes('Workspace Pi session directory: /agent/sessions/--w--.'));
  assert.ok(host.includes('Task child transcripts: /agent/sessions/--w--/pstack-workers/<parent-session-id>.'));
});
