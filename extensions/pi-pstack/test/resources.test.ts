import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSkills, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { describe, expect, test } from 'vitest';
import { slackEventText } from '../src/slack/trigger.ts';
import { loadAgentDefinitions } from '../src/task/agents.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_COUNT = 78;
const HIDDEN_COUNT = 60;
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
  // Cloud agents, cloud VMs, and Alt+Enter modes are Pi features now (Task environment cloud, /in-cloud, mode.ts).
  /~\/\.cursor|\.cursor\/|\.cursor-plugin|\.mdc\b|Option\+Enter|agent-transcripts|cursor\.com|github\.com\/cursor\/|api2\.cursor|update_state|SendToUser|add-plugin|Custom Mode|cursor-team-kit|Grok Bot/i;
/** Markdown with fenced code blocks blanked: link syntax inside a fence is example text, not a link (CommonMark). */
function outsideCodeFences(text: string): string {
  let fence: string | undefined;
  return text
    .split('\n')
    .map((line) => {
      const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence === undefined) {
        if (opener === undefined) return line;
        fence = opener;
        return '';
      }
      if (opener !== undefined && opener[0] === fence[0] && opener.length >= fence.length && line.trim() === opener) fence = undefined;
      return '';
    })
    .join('\n');
}

const OUTSIDE_DATA: { file: string; span: RegExp; reason: string }[] = [
  { file: 'README.md', span: /A `pstack-models\.mdc` from an earlier version is moved there once, without its frontmatter, and kept as `pstack-models\.mdc\.migrated`\./, reason: 'names the legacy rule file pi-pstack migrates' },
  { file: 'README.md', span: /`licenses\/cursor-team-kit\.LICENSE`/, reason: 'names the shipped MIT notice of the vendored team-kit skills and agents' },
];

const WHOLE_FILE_EXEMPT = new Map([
  ['docs/parity-status.md', 'records the upstream source, its host translations, and the host differences that remain'],
  ['docs/host-limits.md', 'names each irreducible host difference and the Pi file that encodes it'],
]);

function hostTermLines(file: string, text: string): string[] {
  if (WHOLE_FILE_EXEMPT.has(file)) return [];
  const exempt = OUTSIDE_DATA.filter((entry) => entry.file === file);
  return text.split('\n').flatMap((line, index) => {
    const rest = exempt.reduce((remaining, entry) => remaining.replace(entry.span, ''), line);
    return CURSOR_HOST_TERMS.test(rest) || /\bCursor\b/.test(rest) ? [`${file}:${index + 1}: ${line.trim().slice(0, 120)}`] : [];
  });
}

describe('shipped resources', () => {
  test('publishes the complete source provenance without requiring an upstream checkout', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(manifest.pstackSource).toEqual({
      repository: 'https://github.com/cursor/plugins',
      revision: 'ae5650febf4320793844c12c4adaa937f417f8da',
      path: 'pstack',
      version: '0.15.36',
      lastChange: 'c742dd61706fbacc1b95f1a20b7b988cf096ce6c',
    });
  });

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
      const text = outsideCodeFences(readFileSync(join(root, file), 'utf8'));
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

  test('Benny operational skills freeze the thread from trigger.thread_ts or trigger.ts, the keys subscribe_slack sends (RES-015)', () => {
    for (const rel of ['automations/benny/skills/triage-issue-reports/SKILL.md', 'automations/benny/skills/reproduce-and-fix-issues/SKILL.md']) {
      expect(readFileSync(join(root, rel), 'utf8')).toContain('Set `SOURCE_THREAD_TS` to `trigger.thread_ts` when present. Otherwise use `trigger.ts`.');
    }
    const event = slackEventText('benny triage', 'triage it', 'C0SLACK', { ts: '1900000000.000100', user: 'U1', text: 'it drifts' });
    const block = event.split('<slack_event>')[1]?.split('</slack_event>')[0] ?? '{}';
    expect((JSON.parse(block) as { trigger: unknown }).trigger).toMatchObject({ source_channel_id: 'C0SLACK', ts: '1900000000.000100', thread_ts: '', user: 'U1', text: 'it drifts' });
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
    for (const rel of ['package.json', 'skills/poteto-mode/scripts/package.json', 'skills/statechart/scripts/package.json']) {
      const pkg = JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, unknown>;
      expect(String(pkg['name'])).not.toMatch(/cursor/i);
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = Object.keys((pkg[field] as Record<string, unknown> | undefined) ?? {});
        expect(deps.filter((dep) => dep === 'pstack' || /cursor/i.test(dep))).toEqual([]);
      }
    }
  });

  test('poteto-help cites this package on GitHub for every answer (HELP-LINK)', () => {
    const text = readFileSync(join(root, 'skills/poteto-help/SKILL.md'), 'utf8');
    expect(text).toContain('https://github.com/just-joshn/pi-customizations/blob/main/extensions/pi-pstack/');
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

  test("create-skill is Cursor's built-in create-skill with only host facts translated (CREATE-SKILL)", () => {
    // Section outline of ~/.cursor/skills-cursor/create-skill/SKILL.md as synced 2026-11-06T07:44Z (parity/pstack-linux-2026-11-05).
    const text = readFileSync(join(root, 'skills/create-skill/SKILL.md'), 'utf8');
    const outline = text
      .split('\n')
      .filter((line) => /^## (?!Extract|Report|Executive|Key|Recommendations|Commit|Form|Document|Utility scripts|Quick|Additional|Current|Old|Instructions|Examples$|Review|Providing)|^### (?:[A-Z0-9]|Verbatim)/.test(line))
      .filter((line) => !/^### (?:[A-Z][a-z]+ [a-z]+ [a-z]+ \(deprecated\))/.test(line));
    expect(outline.slice(0, 4)).toEqual(['## Before You Begin: Gather Requirements', '### Verbatim text from the user', '### Inferring from Context', '### Gathering Additional Information']);
    expect(outline.filter((line) => line.startsWith('### Phase'))).toEqual(['### Phase 1: Discovery', '### Phase 2: Design', '### Phase 3: Implementation', '### Phase 4: Verification']);
    expect([text.includes('Draft, test, iterate'), text.includes('trigger loop'), text.includes('persistent agent stores')]).toEqual([false, false, false]);
    expect(text).toContain('| Personal | ~/.pi/agent/skills/skill-name/ | Available in every project on this machine |');
    expect(text).toContain('| Project | .pi/skills/skill-name/ | Shared with anyone using the repository |');
    expect(hostTermLines('skills/create-skill/SKILL.md', text)).toEqual([]);
  });

  test('ships every team-kit soft-dep skill and agent as a literal inventory (RES-013)', () => {
    const missing = TEAM_KIT.filter((name) => !existsSync(join(root, 'skills', name, 'SKILL.md')));
    expect(missing).toEqual([]);
    expect(existsSync(join(root, 'agents/ci-watcher.md'))).toBe(true);
    expect(existsSync(join(root, 'agents/thermo-nuclear-code-quality-review.md'))).toBe(true);
  });

  test('thermo-nuclear agent keeps team-kit orchestration, and the explore type it names exists (RES-014)', () => {
    const text = readFileSync(join(root, 'agents/thermo-nuclear-code-quality-review.md'), 'utf8');
    // Upstream also names a "shell" type, which Cursor's own CLI does not offer either, so a parent adapts in both hosts.
    expect(text).toContain('run two `Task` calls in parallel — `subagent_type: "shell"` and `subagent_type: "explore"`');
    expect(loadAgentDefinitions().some((agent) => agent.type === 'explore')).toBe(true);
  });
});

test("ships cursor-team-kit's rule files unchanged and unwired, as Cursor ships plugin rules it never applies (RULES-PLUGIN)", () => {
  expect(readdirSync(join(root, 'rules')).toSorted()).toEqual(['no-inline-imports.mdc', 'typescript-exhaustive-switch.mdc']);
  expect(readFileSync(join(root, 'rules/typescript-exhaustive-switch.mdc'), 'utf8')).toBe(
    '---\ndescription: Use exhaustive switch handling for TypeScript unions and enums\nalwaysApply: true\n---\n\ntypescript-exhaustive-switch: In switch statements over discriminated unions or enums, use a `never` check in the default case so newly added variants cause compile-time failures until handled.\n',
  );
  expect(existsSync(join(root, 'skills/no-inline-imports')) || existsSync(join(root, 'skills/typescript-exhaustive-switch'))).toBe(false);
});
