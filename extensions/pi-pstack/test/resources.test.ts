import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSkills, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { describe, expect, test } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_COUNT = 79;
const HIDDEN_COUNT = 61;
const TEAM_KIT = [
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
  'no-inline-imports',
  'typescript-exhaustive-switch',
];
const INVOCABLE = [
  'check-compiler-errors',
  'control-cli',
  'control-ui',
  'create-skill',
  'deslop',
  'fix-ci',
  'fix-merge-conflicts',
  'get-pr-comments',
  'loop-on-ci',
  'make-pr-easy-to-review',
  'new-branch-and-pr',
  'review-and-ship',
  'run-smoke-tests',
  'setup-pstack',
  'verify-this',
  'weekly-review',
  'what-did-i-get-done',
  'workflow-from-chats',
];
const STANDARD_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'disable-model-invocation']);
const SHIPPED_ROOTS = ['skills', 'agents', 'docs', 'automations', 'README.md'];

function loadPackageSkills() {
  return loadSkills({ cwd: tmpdir(), agentDir: join(tmpdir(), 'pi-pstack-no-agent-dir'), skillPaths: [join(root, 'skills')], includeDefaults: false });
}

function shippedFiles(predicate: (path: string) => boolean): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.DS_Store') continue;
      if (entry.isDirectory()) walk(path);
      else if (predicate(path)) files.push(relative(root, path));
    }
  };
  for (const shipped of SHIPPED_ROOTS) {
    const path = join(root, shipped);
    if (statSync(path).isDirectory()) walk(path);
    else if (predicate(path)) files.push(shipped);
  }
  return files.sort();
}

/**
 * Words that name Cursor's host rather than something a Pi user has. Nothing shipped may name Cursor (lowercase
 * "cursor" is a text or loop cursor) except the spans listed in OUTSIDE_DATA, each on its own file with the reason.
 */
const CURSOR_HOST_TERMS =
  /~\/\.cursor|\.cursor\/|\.cursor-plugin|\.mdc\b|Option\+Enter|Alt\+Enter|agent-transcripts|cursor\.com|github\.com\/cursor\/|api2\.cursor|update_state|SendToUser|add-plugin|Custom Mode|cloud agent|cloud VM|cursor-team-kit|Grok Bot/i;
const OUTSIDE_DATA: { file: string; span: RegExp; reason: string }[] = [
  { file: 'README.md', span: /A `pstack-models\.mdc` from an earlier version is moved there once, without its frontmatter, and kept as `pstack-models\.mdc\.migrated`\./, reason: 'names the legacy rule file pi-pstack migrates' },
  { file: 'README.md', span: /`licenses\/cursor-team-kit\.LICENSE`/, reason: 'names the shipped MIT notice of the vendored team-kit skills and agents' },
];

function hostTermLines(file: string, text: string): string[] {
  const exempt = OUTSIDE_DATA.filter((entry) => entry.file === file);
  return text.split('\n').flatMap((line, index) => {
    const rest = exempt.reduce((remaining, entry) => remaining.replace(entry.span, ''), line);
    return CURSOR_HOST_TERMS.test(rest) || /\bCursor\b/.test(rest) ? [`${file}:${index + 1}: ${line.trim().slice(0, 120)}`] : [];
  });
}

describe('shipped resources', () => {
  test('loads every skill with no diagnostics and names equal to directories (RES-001)', () => {
    const { skills, diagnostics } = loadPackageSkills();
    expect(diagnostics).toEqual([]);
    expect(skills).toHaveLength(SKILL_COUNT);
    const renamed = skills.filter((skill) => skill.name !== skill.filePath.split('/').at(-2));
    expect(renamed.map((skill) => skill.name)).toEqual([]);
    expect(skills.map((skill) => skill.name)).toEqual(expect.arrayContaining(['poteto-mode', 'make-bot-ui', 'how', 'setup-pstack', 'create-skill', 'ketchup-video', 'statechart', ...TEAM_KIT]));
  });

  test('keeps only Agent Skills fields at the top level of skill frontmatter (RES-004)', () => {
    const extra = shippedFiles((path) => path.startsWith(join(root, 'skills')) && path.endsWith('/SKILL.md')).flatMap((path) => {
      const { frontmatter } = parseFrontmatter(readFileSync(join(root, path), 'utf8'));
      return Object.keys(frontmatter)
        .filter((key) => !STANDARD_FIELDS.has(key))
        .map((key) => `${path}: ${key}`);
    });
    expect(extra).toEqual([]);
    const poteto = parseFrontmatter(readFileSync(join(root, 'skills/poteto-mode/SKILL.md'), 'utf8')).frontmatter;
    expect(poteto['metadata']).toEqual({ icon: 'crown', color: 'yellow' });
    const typescript = parseFrontmatter(readFileSync(join(root, 'skills/typescript-best-practices/SKILL.md'), 'utf8')).frontmatter;
    expect(typescript['metadata']).toEqual({ paths: ['**/*.ts', '**/*.tsx'] });
  });

  test('hides workflow skills from model invocation and keeps team-kit plus setup invocable (RES-003, RES-005)', () => {
    const { skills } = loadPackageSkills();
    const invocable = skills.filter((skill) => !skill.disableModelInvocation).map((skill) => skill.name);
    expect(invocable.toSorted()).toEqual(INVOCABLE.toSorted());
    expect(skills.filter((skill) => skill.disableModelInvocation)).toHaveLength(HIDDEN_COUNT);
  });

  test('ships pstack and team-kit subagent definitions (RES-006)', () => {
    expect(readdirSync(join(root, 'agents')).toSorted()).toEqual(['ci-watcher.md', 'comment-sicko.md', 'poteto-agent.md', 'thermo-nuclear-code-quality-review.md']);
  });

  test('poteto-mode tells delegates where bundled skills live, and every principle it names is at ../<name>/SKILL.md (RES-010)', () => {
    const potetoMode = join(root, 'skills/poteto-mode/SKILL.md');
    const text = readFileSync(potetoMode, 'utf8');
    expect(text).toContain('Bundled skills live at `../<name>/SKILL.md` from this file');
    // Each Principles index entry names its leaf: an explicit (**principle-x**), else principle-<kebab title>.
    const index = text.slice(text.indexOf('Each leaf is the **principle-<title>** skill'), text.indexOf('\n## ', text.indexOf('Each leaf is the')));
    const leaves = [...index.matchAll(/^- \*\*([^*]+?)\.?\*\*(?: \(\*\*(principle-[a-z-]+)\*\*\))?/gm)].map(
      ([, title = '', explicit]) =>
        explicit ??
        `principle-${title
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, '')
          .replace(/ +/g, '-')}`,
    );
    expect(leaves.length).toBeGreaterThan(20);
    expect(leaves.filter((name) => !existsSync(resolve(dirname(potetoMode), '..', name, 'SKILL.md')))).toEqual([]);
  });

  test('resolves every relative Markdown link in shipped text (RES-007)', () => {
    const broken: string[] = [];
    for (const file of shippedFiles((path) => path.endsWith('.md'))) {
      const text = readFileSync(join(root, file), 'utf8');
      // Every relative target that names a file or folder (an extension or a trailing /); placeholders such as (url) are not links.
      for (const match of text.matchAll(/\]\((?![a-z]+:|#|\/)([^)#\s]+(?:\.[a-z0-9]+|\/))\)/gi)) {
        const target = resolve(dirname(join(root, file)), match[1] ?? '');
        if (!existsSync(target)) broken.push(`${file} -> ${match[1]}`);
      }
    }
    expect(broken).toEqual([]);
    expect(existsSync(join(root, 'docs/guide/01-setup.md'))).toBe(true);
  });

  test('ships Benny as files that never load as skills (RES-008)', () => {
    expect(shippedFiles((path) => path.includes('/automations/benny/') && path.endsWith('SKILL.md'))).toHaveLength(3);
    const { skills } = loadPackageSkills();
    expect(skills.filter((skill) => skill.filePath.includes('/automations/'))).toEqual([]);
  });

  test('ships both MIT license texts (RES-009)', () => {
    expect(readFileSync(join(root, 'licenses/pstack.LICENSE'), 'utf8')).toContain('Copyright (c) 2026 Lauren Tan');
    expect(readFileSync(join(root, 'licenses/cursor-team-kit.LICENSE'), 'utf8')).toContain('MIT License');
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readme).toContain('licenses/pstack.LICENSE');
    expect(readme).toContain('licenses/cursor-team-kit.LICENSE');
  });

  test('nothing depends on a Cursor plugin checkout: no sync script, lock, or host adapter (RES-011)', () => {
    for (const path of ['upstream.lock.json', 'scripts/sync-upstream.mjs', 'scripts/patches.json', 'docs/harness']) expect(existsSync(join(root, path)), path).toBe(false);
    const scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(Object.keys(scripts).filter((name) => name.includes('upstream'))).toEqual([]);
  });

  test('shipped text names Pi, not Cursor host features (RES-012)', () => {
    const offending = shippedFiles(() => true).flatMap((file) => hostTermLines(file, readFileSync(join(root, file), 'utf8')));
    const stale = OUTSIDE_DATA.filter(
      (entry) =>
        !readFileSync(join(root, entry.file), 'utf8')
          .split('\n')
          .some((line) => entry.span.test(line)),
    );
    expect({ offending, stale: stale.map((entry) => `${entry.file}: ${entry.reason}`) }).toEqual({ offending: [], stale: [] });
  });

  test('RES-012 catches host paths in any case, in README.md, and beside an exempt span', () => {
    expect(hostTermLines('skills/x/SKILL.md', 'See https://GitHub.com/Cursor/plugins/blob/main/pstack/README.md.')).toHaveLength(1);
    expect(hostTermLines('skills/x/SKILL.md', 'See https://cursor.com/changelog.')).toHaveLength(1);
    expect(hostTermLines('README.md', 'Install with /add-plugin pstack.')).toHaveLength(1);
    expect(hostTermLines('README.md', 'Theirs are in `licenses/cursor-team-kit.LICENSE`.')).toEqual([]);
    expect(hostTermLines('README.md', 'Theirs are in `licenses/cursor-team-kit.LICENSE`, and Cursor reads them.')).toHaveLength(1);
    expect(shippedFiles(() => true)).toContain('README.md');
  });

  test('create-skill covers builtin interview depth in Pi terms (gap-list item 3)', () => {
    const text = readFileSync(join(root, 'skills/create-skill/SKILL.md'), 'utf8');
    expect(text.startsWith('---\nname: create-skill\n')).toBe(true);
    for (const heading of [
      '## Before you begin: gather requirements',
      '### Verbatim text from the user',
      '## Writing effective descriptions',
      '### Tune the description (trigger loop)',
      '## Core authoring principles',
      '## Common patterns',
      '## Anti-patterns to avoid',
      '### Phase 4: Draft, test, iterate',
      '## Summary checklist',
    ]) {
      expect(text, heading).toContain(heading);
    }
    expect(text).toContain('~/.pi/agent/skills/');
    expect(text).toContain('.pi/skills/');
    expect(hostTermLines('skills/create-skill/SKILL.md', text)).toEqual([]);
    expect(Buffer.byteLength(text)).toBeGreaterThan(12_000);
  });

  test('ships every team-kit soft-dep skill and agent as a literal inventory (RES-013)', () => {
    const missing = TEAM_KIT.filter((name) => !existsSync(join(root, 'skills', name, 'SKILL.md')));
    expect(missing).toEqual([]);
    expect(existsSync(join(root, 'agents/ci-watcher.md'))).toBe(true);
    expect(existsSync(join(root, 'agents/thermo-nuclear-code-quality-review.md'))).toBe(true);
  });

  test('thermo-nuclear agent does not name Task types Pi lacks (RES-014)', () => {
    const text = readFileSync(join(root, 'agents/thermo-nuclear-code-quality-review.md'), 'utf8');
    expect(text).not.toMatch(/subagent_type:\s*"shell"/);
    expect(text).not.toMatch(/subagent_type:\s*"explore"/);
    expect(text).toContain('generalPurpose');
  });
});
