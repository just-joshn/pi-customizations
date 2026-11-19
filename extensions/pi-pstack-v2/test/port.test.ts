import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSkills } from '@earendil-works/pi-coding-agent';
import { describe, expect, test } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'upstream.lock.json'), 'utf8')) as { files: Record<string, string> };
const upstream = Object.keys(lock.files);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
// Skill scripts the port changed, or added, since an upstream-identical script may still say what upstream says.
const portedScripts = walk(join(root, 'skills'))
  .map((path) => relative(root, path))
  .filter((path) => /\/scripts\//.test(path) && /\.(sh|mjs|ts)$/.test(path) && lock.files[path] !== sha(join(root, path)));

// Agent personas under src/subagent/agents are Cursor-sourced; port bans apply to Pi-ported skills/docs only.
const prose = [...['skills', 'docs/guide'].flatMap((dir) => walk(join(root, dir))).filter((path) => /\.(md|tsv)$/.test(path)), join(root, 'README.md')];
const scanned = [...prose, ...portedScripts.map((path) => join(root, path))];

// Each pattern names a Cursor or Claude Code mechanism that Pi replaces. `allow` admits lines that only name the
// mechanism to say what replaced it, or that refer to an external service that still exists under Pi.
const banned: { pattern: RegExp; why: string; allow?: RegExp }[] = [
  { pattern: /\bsub-agents?\b|\bsubagents\b/i, why: 'Pi has no sub-agents; use the packaged subagent tool', allow: /Pi has no sub-?agents/i },
  { pattern: /`Task`|\bTask (call|tool|spawn|subagent)s?\b/, why: 'Cursor Task tool; use the packaged subagent tool' },
  { pattern: /subagent_type|generalPurpose|run_in_background|cloud_base_branch|file_attachments|environment: "/, why: 'Cursor Task fields; use subagent parameters' },
  { pattern: /todolist|todo list|TodoWrite/i, why: 'Pi has no built-in to-dos; use TODO.md' },
  { pattern: /AskQuestion|AskUserQuestion/, why: 'Pi has no question popups; ask in plain text' },
  { pattern: /(^|[\s`(])\/loop\b/, why: 'Cursor /loop; use tmux_run' },
  { pattern: /\bplan mode\b/i, why: 'Pi has no plan mode; write a plan file' },
  { pattern: /\b(in|to) the background\b|\bbackground (bash|shell|job|process|agent|task)/i, why: 'Pi has no background bash; use tmux_run', allow: /\bnever\b/i },
  { pattern: /\.cursor\b|\.mdc\b|cursor-plugin|\/add-plugin|~\/\.claude|Claude Code|\.claude-plugin/, why: 'Cursor or Claude Code path or command', allow: /names a Cursor or Claude Code mechanism/ },
  { pattern: /claude-(opus|sonnet|haiku|fable)-\d|grok-\d|composer-\d|\bfast mode\b|(?<!fail)-fast\b/i, why: 'Cursor model slug or fast mode; use provider/id and thinking' },
  { pattern: /\bCursor\b/, why: 'Cursor-only mechanism', allow: /Bugbot|cursor\/plugins|security review|built for Cursor|ported from Cursor|Each Cursor mechanism is replaced|names a Cursor or Claude Code mechanism/ },
  { pattern: /\bAsk mode\b/, why: 'Cursor Ask mode; use a readonly subagent' },
  { pattern: /SendToUser/, why: 'Cursor SendToUser; Pi has no equivalent' },
  { pattern: /agent-transcripts/, why: 'Cursor transcripts; read Pi sessions' },
  { pattern: /\b(nohup|setsid|disown)\b/, why: 'background bash; use tmux_run', allow: /\b(never|not|no|without|don't)\b/i },
  { pattern: /CLAUDE\.md|\.claude\//, why: 'Claude Code path; use AGENTS.md or the Pi agent directory' },
  { pattern: /cloud[- ]agent/i, why: 'Cursor cloud agents; use a worktree-backed subagent' },
  { pattern: /coordinator chat/i, why: 'Cursor chat; the session that runs the playbook' },
  { pattern: /\bpstack\/skills\//, why: 'upstream monorepo path; use the path relative to the skill directory' },
];

const skillNames = readdirSync(join(root, 'skills'));
banned.push({ pattern: new RegExp(`(^|[\\s\`("'])/(${skillNames.join('|')})\\b`), why: 'Pi invokes skills as /skill:<name>' });

describe('the Pi port of pstack', () => {
  test('every skill loads through Pi with no diagnostics', () => {
    const { skills, diagnostics } = loadSkills({ cwd: root, agentDir: join(tmpdir(), 'pstack-v2-empty-agent'), skillPaths: [join(root, 'skills')], includeDefaults: false });
    expect(diagnostics).toEqual([]);
    const upstreamSkills = new Set(upstream.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path)).map((path) => path.split('/')[1]));
    expect(new Set(skills.map((skill) => skill.name))).toEqual(upstreamSkills);
  });

  test('every upstream file is still present', () => {
    // Split past the 800-line hard max; siblings replace these lock paths.
    const removed = new Set(['skills/statechart/scripts/test/chart.test.ts', 'skills/statechart/scripts/test/cli.test.ts']);
    const located = (path: string) => (path.startsWith('agents/') ? join(root, 'src', 'subagent', path) : join(root, path));
    expect(upstream.filter((path) => !removed.has(path) && !existsSync(located(path)))).toEqual([]);
  });

  test('unported upstream scripts are byte-identical', () => {
    const ported = new Set([
      'skills/poteto-mode/scripts/worktree-audit.sh', // read Cursor chat transcripts; now reads Pi sessions
      'LICENSE', // adds cursor-team-kit's copyright beside pstack's
      'skills/pr-review-canvas/renderer.js', // style-audit immutability and no JSON.parse without zod
      'skills/pr-review-canvas/template.html', // assigns window.__PR_DIFFS__ so the injected script needs no JSON.parse
      // poteto watch-pr / bootstrap reshaped for style-audit (immutability, file size, zod)
      'skills/poteto-mode/scripts/bootstrap.ts',
      'skills/poteto-mode/scripts/bun.lock',
      'skills/poteto-mode/scripts/package.json',
      'skills/poteto-mode/scripts/watch-pr/cli.test.ts',
      'skills/poteto-mode/scripts/watch-pr/cli.ts',
      'skills/poteto-mode/scripts/watch-pr/fakes.test-helper.ts',
      'skills/poteto-mode/scripts/watch-pr/github.test.ts',
      'skills/poteto-mode/scripts/watch-pr/github.ts',
      'skills/poteto-mode/scripts/watch-pr/policy.test.ts',
      'skills/poteto-mode/scripts/watch-pr/policy.ts',
      'skills/poteto-mode/scripts/watch-pr/render.ts',
      'skills/poteto-mode/scripts/watch-pr/types.ts',
      // statechart scripts/test reshaped for style-audit (split >800, immutability)
      'skills/statechart/scripts/test/chart.test.ts',
      'skills/statechart/scripts/test/cli.test.ts',
      'skills/statechart/scripts/test/config-fuzz.test.ts',
      'skills/statechart/scripts/test/corpus.test.ts',
      'skills/statechart/scripts/test/differential.test.ts',
      'skills/statechart/scripts/test/drawn.ts',
      'skills/statechart/scripts/test/java.ts',
      'skills/statechart/scripts/test/labels.ts',
      'skills/statechart/scripts/test/pipeline.test.ts',
      'skills/statechart/scripts/test/plain-tlc.test.ts',
      'skills/statechart/scripts/test/render.test.ts',
      'skills/statechart/scripts/test/tlc-out.test.ts',
      'skills/statechart/scripts/test/tlc.ts',
    ]);
    const digest = (path: string) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
    const changed = upstream.filter((path) => !/\.(md|tsv)$/.test(path) && !ported.has(path)).filter((path) => digest(path) !== lock.files[path]);
    expect(changed).toEqual([]);
  });

  test('no prose or ported script names a Cursor or Claude Code mechanism', () => {
    const hits = scanned.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => banned.filter(({ pattern, allow }) => pattern.test(line) && !allow?.test(line)).map(({ why }) => `${relative(root, path)}:${index + 1} ${why}: ${line.trim().slice(0, 160)}`)),
    );
    expect(hits).toEqual([]);
  });

  test('only poteto-mode says when to call tmux_jobs wait, so no skill tells the agent to block until its workers finish', () => {
    const waitLines = (path: string) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => (/action: "wait"/.test(line) ? [`${relative(root, path)}:${index + 1}`] : []));
    const offenders = prose.filter((path) => relative(root, path) !== 'skills/poteto-mode/SKILL.md').flatMap(waitLines);
    expect(offenders).toEqual([]);
  });

  test('every checklist is a file named TODO.md, as Pi asks, under whichever directory holds it', () => {
    const offenders = [...prose, join(root, 'docs', 'pi-mechanisms.md')].filter((path) => /TODO\.[\w-]+\.md/.test(readFileSync(path, 'utf8'))).map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });

  test('every /skill:<name> in prose names a shipped skill', () => {
    const hits = prose.flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/\/skill:([A-Za-z0-9<>_-]+)/g)]
        .map(([, name = '']) => name.replace(/-+$/, ''))
        // A project-local placeholder such as /skill:verify-<app> names a skill the user writes.
        .filter((name) => !skillNames.includes(name) && !name.includes('<'))
        .map((name) => `${relative(root, path)} names /skill:${name}`),
    );
    expect(hits).toEqual([]);
  });

  test('every relative Markdown link in prose resolves', () => {
    const missingLinks = (path: string) =>
      [...readFileSync(path, 'utf8').matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)]
        .map(([, target = '']) => target.split('#')[0] ?? '')
        // A bare word such as `url` in a template is a placeholder, not a path.
        .filter((target) => /[./]/.test(target) && !/^([a-z][a-z0-9+.-]*:|\/)/i.test(target))
        .filter((target) => !existsSync(resolve(dirname(path), target)))
        .map((target) => `${relative(root, path)} links to missing ${target}`);
    const hits = prose.filter((path) => path.endsWith('.md')).flatMap(missingLinks);
    expect(hits).toEqual([]);
  });
});
