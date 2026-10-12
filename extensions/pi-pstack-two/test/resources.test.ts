import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSkills, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { describe, expect, test } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'upstream.lock.json'), 'utf8')) as Lock;
const PATCHES = JSON.parse(readFileSync(join(root, 'scripts/patches.json'), 'utf8')) as { id: string; edits: { before: string; after: string }[] }[];

interface LockFile {
  source: string;
  target: string;
  transform: string;
  mode: string;
  sourceSha256: string;
  targetSha256: string;
  sourceFrontmatter?: string;
}
interface Lock {
  source: { repository: string; commit: string; pstackVersion: string; teamKitVersion: string };
  files: LockFile[];
  authored: string[];
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const PSTACK_HIDDEN = 51;
const TEAM_KIT = ['control-cli', 'control-ui', 'deslop'];
const STANDARD_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'disable-model-invocation']);

function loadPackageSkills() {
  return loadSkills({ cwd: tmpdir(), agentDir: join(tmpdir(), 'pi-pstack-two-no-agent-dir'), skillPaths: [join(root, 'skills')], includeDefaults: false });
}

function splitFrontmatter(text: string) {
  const match = /^---\n([\s\S]*?)\n---(\n[\s\S]*)?$/.exec(text);
  if (!match) throw new Error('file has no frontmatter block');
  return { frontmatter: match[1] ?? '', rest: match[2] ?? '' };
}

describe('generated resources', () => {
  test('pins the upstream commit and versions (RES-002)', () => {
    expect(lock.source).toEqual({
      repository: 'https://github.com/cursor/plugins',
      commit: '1b6d44ff26d4e242f4e8f68c391e6d2f7ca16def',
      pstackVersion: '0.15.20',
      teamKitVersion: '1.2.0',
    });
  });

  test('every locked file exists with its recorded bytes and mode (RES-002)', () => {
    const drift = lock.files.filter((file) => {
      const path = join(root, file.target);
      if (!existsSync(path)) return true;
      const executable = (statSync(path).mode & 0o111) !== 0;
      return sha256(readFileSync(path)) !== file.targetSha256 || executable !== (file.mode === '100755');
    });
    expect(drift.map((file) => file.target)).toEqual([]);
    expect(lock.files).toHaveLength(166);
  });

  test('untransformed files equal their upstream bytes (RES-002)', () => {
    const changed = lock.files.filter((file) => file.transform === 'none' && file.sourceSha256 !== file.targetSha256);
    expect(changed.map((file) => file.target)).toEqual([]);
    const counts = new Map<string, number>();
    for (const file of lock.files) counts.set(file.transform, (counts.get(file.transform) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({
      none: 110,
      frontmatter: 55,
      'patch:worktree-audit-pi-transcripts': 1,
    });
  });

  test('frontmatter-normalized files keep the upstream body byte for byte (RES-002)', () => {
    let checked = 0;
    const mismatched = lock.files
      .filter((file) => file.transform === 'frontmatter')
      .filter((file) => {
        checked += 1;
        const { rest } = splitFrontmatter(readFileSync(join(root, file.target), 'utf8'));
        return sha256(`---\n${file.sourceFrontmatter}\n---${rest}`) !== file.sourceSha256;
      });
    expect(mismatched.map((file) => file.target)).toEqual([]);
    expect(checked).toBe(55);
  });

  test('patched files differ from upstream only by the declared patch (RES-002, WTA-001)', () => {
    for (const patch of PATCHES) {
      const file = lock.files.find((entry) => entry.transform === `patch:${patch.id}`);
      if (!file) throw new Error(`no locked file for patch ${patch.id}`);
      let text = readFileSync(join(root, file.target), 'utf8');
      for (const edit of patch.edits) text = text.replace(edit.after, edit.before);
      expect(sha256(text)).toBe(file.sourceSha256);
    }
  });

  test('loads 56 skills with no diagnostics and names equal to directories (RES-001)', () => {
    const { skills, diagnostics } = loadPackageSkills();
    expect(diagnostics).toEqual([]);
    expect(skills).toHaveLength(56);
    const renamed = skills.filter((skill) => skill.name !== skill.filePath.split('/').at(-2));
    expect(renamed.map((skill) => skill.name)).toEqual([]);
    expect(skills.map((skill) => skill.name)).toEqual(expect.arrayContaining(['poteto-mode', 'make-bot-ui', 'how', 'setup-pstack', 'create-skill', ...TEAM_KIT]));
  });

  test('keeps upstream descriptions and only Agent Skills fields at the top level (RES-001, RES-004)', () => {
    for (const file of lock.files.filter((entry) => entry.transform === 'frontmatter')) {
      const source = parseFrontmatter(`---\n${file.sourceFrontmatter}\n---\n`).frontmatter;
      const target = parseFrontmatter(readFileSync(join(root, file.target), 'utf8')).frontmatter;
      expect(target['description']).toBe(source['description']);
      expect(target['disable-model-invocation']).toBe(source['disable-model-invocation']);
      expect(Object.keys(target).filter((key) => !STANDARD_FIELDS.has(key))).toEqual([]);
    }
  });

  test('moves Cursor-only fields under metadata with a cursor- prefix (RES-004)', () => {
    const poteto = parseFrontmatter(readFileSync(join(root, 'skills/poteto-mode/SKILL.md'), 'utf8')).frontmatter;
    expect(poteto['metadata']).toEqual({
      'cursor-name': 'Poteto Mode',
      'cursor-mode': true,
      'cursor-icon': 'crown',
      'cursor-color': 'yellow',
      'cursor-reminder': "New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.",
    });
    const typescript = parseFrontmatter(readFileSync(join(root, 'skills/typescript-best-practices/SKILL.md'), 'utf8')).frontmatter;
    expect(typescript['metadata']).toEqual({ 'cursor-paths': ['**/*.ts', '**/*.tsx'] });
  });

  test('hides 51 pstack skills from model invocation and keeps the rest invocable (RES-003, RES-005)', () => {
    const { skills } = loadPackageSkills();
    const invocable = skills.filter((skill) => !skill.disableModelInvocation).map((skill) => skill.name);
    expect(invocable.toSorted()).toEqual(['control-cli', 'control-ui', 'create-skill', 'deslop', 'setup-pstack']);
    expect(skills.filter((skill) => skill.disableModelInvocation)).toHaveLength(PSTACK_HIDDEN);
  });

  test('ships the subagent definitions unchanged (RES-006)', () => {
    const agents = lock.files.filter((file) => file.target.startsWith('agents/'));
    expect(agents.map((file) => [file.target, file.transform])).toEqual([
      ['agents/comment-sicko.md', 'none'],
      ['agents/poteto-agent.md', 'none'],
    ]);
  });

  test('resolves every relative Markdown link in shipped skills (RES-007)', () => {
    const broken: string[] = [];
    for (const file of lock.files.filter((entry) => entry.target.startsWith('skills/') && entry.target.endsWith('.md'))) {
      const text = readFileSync(join(root, file.target), 'utf8');
      // Every relative target that names a file or folder (an extension or a trailing /); placeholders such as (url) are not links.
      for (const match of text.matchAll(/\]\((?![a-z]+:|#|\/)([^)#\s]+(?:\.[a-z0-9]+|\/))\)/gi)) {
        const target = resolve(dirname(join(root, file.target)), match[1] ?? '');
        if (!existsSync(target)) broken.push(`${file.target} -> ${match[1]}`);
      }
    }
    expect(broken).toEqual([]);
    expect(existsSync(join(root, 'docs/guide/01-setup.md'))).toBe(true);
  });

  test('ships Benny as files that never load as skills (RES-008)', () => {
    const benny = lock.files.filter((file) => file.target.startsWith('automations/benny/'));
    expect(benny.filter((file) => file.target.endsWith('SKILL.md'))).toHaveLength(3);
    const { skills } = loadPackageSkills();
    expect(skills.filter((skill) => skill.filePath.includes('/automations/'))).toEqual([]);
  });

  test('ships both MIT license texts (RES-009)', () => {
    const pstack = readFileSync(join(root, 'licenses/pstack.LICENSE'), 'utf8');
    const teamKit = readFileSync(join(root, 'licenses/cursor-team-kit.LICENSE'), 'utf8');
    expect(pstack).toContain('Copyright (c) 2026 Lauren Tan');
    expect(teamKit).toContain('MIT License');
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readme).toContain('licenses/pstack.LICENSE');
    expect(readme).toContain('licenses/cursor-team-kit.LICENSE');
  });

  test('authored files are declared and stay outside the upstream lock (HOST-003)', () => {
    expect(lock.authored).toEqual(['skills/create-skill/SKILL.md']);
    expect(lock.files.some((file) => file.target.startsWith('skills/create-skill/'))).toBe(false);
    const skill = parseFrontmatter(readFileSync(join(root, 'skills/create-skill/SKILL.md'), 'utf8'));
    expect(skill.frontmatter['name']).toBe('create-skill');
    const headings = skill.body.split('\n').filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## 1. Decide placement and name', '## 2. Write the frontmatter', '## 3. Write the body for an agent reader', '## 4. Draft, test, iterate', '## 5. Tune the description', '## 6. Finish']);
    expect(skill.body).toContain('`description` is one YAML scalar of at most 1024 characters. Quote it, or use `description: >-`');
    expect(skill.body).toContain('When a pstack skill says `.cursor/skills/`, use `.pi/skills/`.');
  });

  test('ships nothing outside the lock under generated roots (RES-002)', () => {
    const tracked = new Set([...lock.files.map((file) => file.target), ...lock.authored]);
    const extra: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.name === 'node_modules' || entry.name === '.DS_Store') continue;
        if (entry.isDirectory()) walk(path);
        else if (!tracked.has(relative(root, path))) extra.push(relative(root, path));
      }
    };
    for (const directory of ['skills', 'agents', 'docs/guide', 'automations', 'licenses']) walk(join(root, directory));
    expect(extra).toEqual([]);
    expect(tracked.size).toBe(167);
  });
});
