import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { readPersona } from '../src/personas.ts';
import { cursorToolNames, hostInstructions } from '../src/host.ts';
import { fixture, packageRoot, prompt } from './session-fixture.ts';

const upstreamPstack = join(packageRoot, 'upstream');
const upstreamTeamKit = join(packageRoot, 'upstream-team-kit');

async function getSubdirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter(e => !e.name.startsWith('.') && e.isDirectory()).map(e => e.name).toSorted();
}

test('skills inventory: all pstack, team-kit, and loop skills are accounted for', async () => {
  const upstreamPstackSkills = await getSubdirs(join(upstreamPstack, 'skills'));
  const upstreamKitSkills = await getSubdirs(join(upstreamTeamKit, 'skills'));
  const piSkills = await getSubdirs(join(packageRoot, 'skills'));
  const piHostSkills = await getSubdirs(join(packageRoot, 'host/skills'));

  expect(upstreamPstackSkills.length).toBe(47);
  expect(piSkills.includes('bro')).toBe(false);
  for (const slug of upstreamPstackSkills) {
    if (slug === 'bro') {
      const broPrompt = await readFile(join(packageRoot, 'prompts/bro.md'), 'utf8');
      expect(broPrompt.includes('$ARGUMENTS')).toBe(true);
    } else {
      expect(piSkills.includes(slug)).toBe(true);
    }
  }

  expect(upstreamKitSkills.length).toBe(18);
  for (const slug of upstreamKitSkills) {
    expect(piSkills.includes(slug)).toBe(true);
  }

  expect(piHostSkills.includes('loop')).toBe(true);
  expect(piSkills.length + piHostSkills.length).toBe(65);
});

test('cursor built-in facilities: host mappings are verified', async () => {
  const piHostSkills = await getSubdirs(join(packageRoot, 'host/skills'));
  expect(piHostSkills.includes('loop')).toBe(true);
  expect(existsSync(join(packageRoot, 'host/prompts/loop.md'))).toBe(true);

  const hostText = await readFile(join(packageRoot, 'src/host.ts'), 'utf8');
  expect(hostText.includes('create-skill')).toBe(true);
  expect(hostText.includes('/goal')).toBe(true);

  const modeText = await readFile(join(packageRoot, 'skills/poteto-mode/SKILL.md'), 'utf8');
  expect(modeText.includes('playbooks/autopilot-full.md')).toBe(true);
  expect(modeText.includes('playbooks/autopilot-stack.md')).toBe(true);
  expect(modeText.includes('references/bugbot-triage.md')).toBe(true);
});

test('generated resources: repository-relative references resolve in this checkout', async () => {
  const repositoryRoot = join(packageRoot, '..', '..');
  const directories = [...(await getSubdirs(join(packageRoot, 'skills'))).map(name => join(packageRoot, 'skills', name)),
    join(packageRoot, 'host', 'skills', 'loop')];
  const scanned: string[] = [];
  for (const directory of directories) {
    for (const name of await readdir(directory, { recursive: true })) {
      if (name.endsWith('.md') && !name.includes('node_modules')) scanned.push(join(directory, name));
    }
  }
  expect(scanned.length).toBeGreaterThanOrEqual(directories.length);
  const pattern = /(?:^|[^-\w])((?:pstack|extensions\/pi-pstack)\/skills\/[A-Za-z0-9._/<>*-]+)/g;
  const targets: string[] = [];
  for (const file of scanned) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const target = match[1].replace(/\/$/, '');
      expect(target.startsWith('pstack/'), `${file} still names the upstream repository path ${target}`).toBe(false);
      if (target.includes('<') || target.includes('*')) continue;
      targets.push(target);
      expect(existsSync(join(repositoryRoot, target)), `${file} references the missing path ${target}`).toBe(true);
    }
  }
  expect(targets.length).toBeGreaterThanOrEqual(8);
});

test('resource map: exactly 205 generated resources are verified with matching hashes', async () => {
  const mapPath = join(packageRoot, 'docs/resource-map.json');
  const resources = JSON.parse(await readFile(mapPath, 'utf8')) as { destination: string; sha256: string }[];
  expect(resources.length).toBe(205);

  for (const entry of resources) {
    const full = join(packageRoot, entry.destination);
    const content = await readFile(full);
    const hash = createHash('sha256').update(content).digest('hex');
    expect(hash).toBe(entry.sha256);
  }
});

async function validateSkillMetadata(skill: { name: string; description: string; filePath: string }) {
  expect(skill.name).toBeDefined();
  expect(skill.description).toBeDefined();
  expect(skill.description.length <= 1024).toBe(true);
  expect(skill.filePath.endsWith('SKILL.md')).toBe(true);

  const raw = await readFile(skill.filePath, 'utf8');
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(fmMatch).toBeDefined();
  const fm = fmMatch![1];

  for (const forbidden of ['mode:', 'icon:', 'color:', 'reminder:', 'paths:']) {
    expect(new RegExp(`^${forbidden}`, 'm').test(fm)).toBe(false);
  }

  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  expect(nameMatch?.[1].trim()).toBe(skill.name);
}

test('skills loader: all 65 skills discover cleanly with valid metadata and frontmatter', async () => {
  const f = await fixture();
  try {
    const { loader } = await f.open();
    const skills = loader.getSkills().skills;
    expect(skills.length).toBe(65);

    for (const skill of skills) {
      await validateSkillMetadata(skill);
    }
    expect(loader.getSkills().diagnostics).toEqual([]);
  } finally {
    await f.close();
  }
});

test('prompt templates: exist for all skills, preserve arguments, and instruct reading bundled skill', async () => {
  const piSkills = await getSubdirs(join(packageRoot, 'skills'));
  const promptFiles = (await readdir(join(packageRoot, 'prompts'))).filter(f => f.endsWith('.md'));

  for (const slug of piSkills) {
    if (slug === 'poteto-mode' || slug === 'setup-pstack') {
      expect(promptFiles.includes(`${slug}.md`)).toBe(false);
      continue;
    }

    expect(promptFiles.includes(`${slug}.md`)).toBe(true);
    const content = await readFile(join(packageRoot, 'prompts', `${slug}.md`), 'utf8');
    expect(content.startsWith('---')).toBe(true);
    expect(content.includes('$ARGUMENTS')).toBe(true);
    expect(content.includes(`Read ${slug}/SKILL.md in full`)).toBe(true);
  }

  const loopPrompt = await readFile(join(packageRoot, 'host/prompts/loop.md'), 'utf8');
  expect(loopPrompt.startsWith('---')).toBe(true);
  expect(loopPrompt.includes('$ARGUMENTS')).toBe(true);
});

test('session prompt execution: prompt templates and native /skill: load complete instructions', async () => {
  const f = await fixture();
  try {
    const { session, loader } = await f.open();
    const sampleSkills = [
      { name: 'how', needle: 'how explorer', arg: 'explore architecture' },
      { name: 'unslop', needle: 'Edit text to remove AI patterns', arg: 'clean prose' },
      { name: 'verify-this', needle: 'falsifiable claim', arg: 'verify cache' },
      { name: 'workflow-from-chats', needle: 'durable working preferences', arg: 'extract preferences' },
    ];

    for (const { name, needle, arg } of sampleSkills) {
      const skill = loader.getSkills().skills.find(s => s.name === name);
      expect(skill).toBeDefined();

      f.calls.push({ type: 'toolCall', id: `read-${name}`, name: 'read', arguments: { path: skill!.filePath } });
      await prompt(session, `/${name} ${arg}`);
      const reqJson = JSON.stringify(f.requests[f.requests.length - 1].messages);
      expect(reqJson.includes(needle)).toBe(true);
      expect(reqJson.includes(arg)).toBe(true);

      await prompt(session, `/skill:${name} ${arg}`);
      const nativeJson = JSON.stringify(f.requests[f.requests.length - 1].messages);
      expect(nativeJson.includes(needle)).toBe(true);
    }
  } finally {
    await f.close();
  }
});

async function checkMarkdownLinks(file: string, dir: string) {
  const text = await readFile(file, 'utf8');
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    const target = match[2].trim();
    const isIgnored = target.startsWith('http://') || target.startsWith('https://')
      || target.startsWith('#') || target.startsWith('mailto:') || target === 'url';
    if (isIgnored) continue;
    const clean = target.split('#')[0].split('?')[0];
    if (!clean) continue;
    const resolved = join(dir, clean);
    const exists = await stat(resolved).then(() => true, () => false);
    expect(exists).toBe(true);
  }
}

async function verifyDirectoryLinks(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await verifyDirectoryLinks(full);
    } else if (entry.name.endsWith('.md')) {
      await checkMarkdownLinks(full, dir);
    }
  }
}

test('references and markdown links: all internal relative links and files resolve', async () => {
  const piSkills = await getSubdirs(join(packageRoot, 'skills'));
  const allDirs = [...piSkills.map(s => join(packageRoot, 'skills', s)), join(packageRoot, 'host/skills/loop')];

  for (const dir of allDirs) {
    await verifyDirectoryLinks(dir);
  }
});

function verifyScriptFile(relPath: string, type: 'sh' | 'mjs') {
  const full = join(packageRoot, relPath);
  if (type === 'sh') {
    expect(() => execFileSync('bash', ['-n', full])).not.toThrow();
  } else {
    expect(() => execFileSync('node', ['--check', full])).not.toThrow();
  }
}

test('scripts: permissions are executable, syntax is valid, and helpers execute correctly', async () => {
  const scriptsToCheck: { path: string; type: 'sh' | 'mjs' }[] = [
    { path: 'skills/show-me-your-work/scripts/log.sh', type: 'sh' },
    { path: 'skills/poteto-mode/scripts/worktree-audit.sh', type: 'sh' },
    { path: 'skills/poteto-mode/scripts/check-plan.mjs', type: 'mjs' },
  ];

  for (const { path: relPath, type } of scriptsToCheck) {
    const full = join(packageRoot, relPath);
    const s = await stat(full);
    expect((s.mode & 0o111) !== 0).toBe(true);
    verifyScriptFile(relPath, type);
  }

  const logDirectory = await mkdtemp(join(tmpdir(), 'pstack-decision-log-'));
  try {
    const testLog = join(logDirectory, 'decisions.tsv');
    const logSh = join(packageRoot, 'skills/show-me-your-work/scripts/log.sh');
    execFileSync('bash', [logSh, testLog, 'phase1', 'decision1', 'why1', '=formula-eval', 'result1']);
    const content = await readFile(testLog, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('ts\tphase\tdecision\twhy\tevidence\tresult');
    expect(lines[1].includes("'=formula-eval")).toBe(true);
  } finally { await rm(logDirectory, { recursive: true, force: true }); }
});

test('subagent personas resolve their mapped instruction files', async () => {
  const mappedSubagents = [
    { type: 'poteto-agent', files: ['upstream/agents/poteto-agent.md', 'skills/poteto-mode/SKILL.md'] },
    { type: 'comment-sicko', files: ['upstream/agents/comment-sicko.md'] },
    { type: 'Comment Sicko', files: ['upstream/agents/comment-sicko.md'] },
    { type: 'ci-watcher', files: ['upstream-team-kit/agents/ci-watcher.md'] },
    { type: 'thermo-nuclear-code-quality-review', files: [
      'upstream-team-kit/agents/thermo-nuclear-code-quality-review.md',
      'skills/thermo-nuclear-code-quality-review/SKILL.md',
    ] },
    { type: 'generalPurpose', files: [] },
  ];

  for (const { type, files } of mappedSubagents) {
    const persona = await readPersona(type);
    const contents = await Promise.all(files.map(file => readFile(join(packageRoot, file), 'utf8')));
    expect(persona.instructions).toBe(contents.join('\n'));
  }

  await expect(readPersona('unsupported-role')).rejects.toThrow(/Unsupported agent unsupported-role/);
});

test('host contract mappings: tool names, cursor facilities, and external dependencies', () => {
  expect(cursorToolNames.includes('Read is the read tool')).toBe(true);
  expect(cursorToolNames.includes('Shell is bash')).toBe(true);
  expect(cursorToolNames.includes('Grep is grep')).toBe(true);
  expect(cursorToolNames.includes('Glob is find')).toBe(true);

  const fakeCtx = {
    cwd: '/test/workspace',
    sessionManager: {
      getSessionDir: () => '/test/sessions',
      getSessionFile: () => '/test/sessions/current.jsonl',
    },
  };
  const instructions = hostInstructions('/pkg', fakeCtx as any, 'rule-content');
  expect(instructions.includes('pstack pi host contract')).toBe(true);
  expect(instructions.includes('/loop is a Pi prompt template')).toBe(true);
  expect(instructions.includes('create-skill')).toBe(true);
  expect(instructions.includes('models.mdc')).toBe(true);
});
