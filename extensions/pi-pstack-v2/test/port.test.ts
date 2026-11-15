import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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

const prose = ['skills', 'agents', 'docs/guide', 'rules'].flatMap((dir) => walk(join(root, dir))).filter((path) => /\.(md|tsv)$/.test(path));

// Each pattern names a Cursor or Claude Code mechanism that Pi replaces. `allow` admits lines that only name the
// mechanism to say what replaced it, or that refer to an external service that still exists under Pi.
const banned: { pattern: RegExp; why: string; allow?: RegExp }[] = [
  { pattern: /\bsub-?agents?\b/i, why: 'Pi has no sub-agents; spawn a Pi instance with pi_spawn', allow: /Pi has no sub-?agents/i },
  { pattern: /`Task`|\bTask (call|tool|spawn|subagent)s?\b/, why: 'Cursor Task tool; use pi_spawn' },
  { pattern: /subagent_type|generalPurpose|run_in_background|cloud_base_branch|file_attachments|environment: "/, why: 'Cursor Task fields; use pi_spawn parameters' },
  { pattern: /todolist|todo list|TodoWrite/i, why: 'Pi has no built-in to-dos; use TODO.md' },
  { pattern: /AskQuestion|AskUserQuestion/, why: 'Pi has no question popups; ask in plain text' },
  { pattern: /(^|[\s`(])\/loop\b/, why: 'Cursor /loop; use tmux_run' },
  { pattern: /\bplan mode\b/i, why: 'Pi has no plan mode; write a plan file' },
  { pattern: /\b(in|to) the background\b|\bbackground (bash|shell|job|process|agent|task)/i, why: 'Pi has no background bash; use tmux_run' },
  { pattern: /\.cursor\b|\.mdc\b|cursor-plugin|\/add-plugin|~\/\.claude|Claude Code|\.claude-plugin/, why: 'Cursor or Claude Code path or command' },
  { pattern: /claude-(opus|sonnet|haiku|fable)-\d|grok-\d|composer-\d|\bfast mode\b|(?<!fail)-fast\b/i, why: 'Cursor model slug or fast mode; use provider/id and thinking' },
  { pattern: /\bCursor\b/, why: 'Cursor-only mechanism', allow: /Bugbot|cursor\/plugins|security review|built for Cursor|ported from Cursor/ },
];

const skillNames = readdirSync(join(root, 'skills'));
banned.push({ pattern: new RegExp(`(^|[\\s\`(])/(${skillNames.join('|')})\\b`), why: 'Pi invokes skills as /skill:<name>' });

describe('the Pi port of pstack', () => {
  test('every skill loads through Pi with no diagnostics', () => {
    const { skills, diagnostics } = loadSkills({ cwd: root, agentDir: join(tmpdir(), 'pstack-v2-empty-agent'), skillPaths: [join(root, 'skills')], includeDefaults: false });
    expect(diagnostics).toEqual([]);
    const upstreamSkills = new Set(upstream.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path)).map((path) => path.split('/')[1]));
    expect(new Set(skills.map((skill) => skill.name))).toEqual(upstreamSkills);
  });

  test('every upstream file is still present', () => {
    expect(upstream.filter((path) => !existsSync(join(root, path)))).toEqual([]);
  });

  test('unported upstream scripts are byte-identical', () => {
    const ported = new Set([
      'skills/poteto-mode/scripts/worktree-audit.sh', // read Cursor chat transcripts; now reads Pi sessions
      'skills/poteto-mode/scripts/check-plan.mjs', // required a /loop marker; now the tmux_run heartbeat
      'skills/poteto-mode/scripts/check-plan.test.ts',
    ]);
    const changed = upstream
      .filter((path) => !/\.(md|tsv)$/.test(path) && !ported.has(path))
      .filter(
        (path) =>
          createHash('sha256')
            .update(readFileSync(join(root, path)))
            .digest('hex') !== lock.files[path],
      );
    expect(changed).toEqual([]);
  });

  test('no prose names a Cursor or Claude Code mechanism', () => {
    const hits = prose.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => banned.filter(({ pattern, allow }) => pattern.test(line) && !allow?.test(line)).map(({ why }) => `${relative(root, path)}:${index + 1} ${why}: ${line.trim().slice(0, 160)}`)),
    );
    expect(hits).toEqual([]);
  });
});
