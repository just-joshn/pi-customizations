import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSkills } from '@earendil-works/pi-coding-agent';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import subagentExtension from '../src/subagent/index.ts';
import { createWorld, loadPstack } from './core-host.ts';

const PATH_SEPARATOR = '/';
const root = fileURLToPath(new URL('..', import.meta.url));
const lock = z.object({ files: z.record(z.string(), z.string()) }).parse(JSON.parse(readFileSync(join(root, 'upstream.lock.json'), 'utf8')));
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
const withMechanisms = [...prose, join(root, 'docs', 'pi-mechanisms.md')];

// Each pattern names a Cursor or Claude Code mechanism that Pi replaces. `allow` admits lines that only name the
// mechanism to say what replaced it, or that refer to an external service that still exists under Pi.
const LINE_PREVIEW_CHARS = 160;
const bannedBase: { pattern: RegExp; why: string; allow?: RegExp }[] = [
  { pattern: /\bsub-agents?\b|\bsubagents\b/i, why: 'Pi has no sub-agents; use the packaged subagent tool', allow: /Pi has no sub-?agents/i },
  { pattern: /`Task`|\bTask (call|tool|spawn|subagent)s?\b/, why: 'Cursor Task tool; use the packaged subagent tool' },
  { pattern: /subagent_type|generalPurpose|run_in_background|cloud_base_branch|file_attachments|environment: "/, why: 'Cursor Task fields; use subagent parameters' },
  { pattern: /todolist|todo list|TodoWrite/i, why: 'Pi has no built-in to-dos; use TODO.md' },
  { pattern: /AskQuestion|AskUserQuestion/, why: 'Pi has no question popups; ask in plain text' },
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

const portedUpstreamFiles = new Set([
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
  'skills/poteto-mode/scripts/watch-pr/types.compile.ts',
  // statechart scripts/test reshaped for style-audit (split >800, immutability)
  // statechart scripts reshaped for style rules (immutability, input validation, error handling, file and function size)
  'skills/statechart/scripts/backends/cfg.ts',
  'skills/statechart/scripts/backends/mermaid.ts',
  'skills/statechart/scripts/backends/report.ts',
  'skills/statechart/scripts/frontends/config.ts',
  'skills/statechart/scripts/frontends/dot.ts',
  'skills/statechart/scripts/frontends/marks.ts',
  'skills/statechart/scripts/frontends/messages.ts',
  'skills/statechart/scripts/frontends/spec.ts',
  'skills/statechart/scripts/frontends/trace.ts',
  'skills/statechart/scripts/frontends/value.ts',
  'skills/statechart/scripts/frontends/view.ts',
  'skills/statechart/scripts/ir.ts',
  'skills/statechart/scripts/passes/annotate.ts',
  'skills/statechart/scripts/passes/label.ts',
  'skills/statechart/scripts/passes/lift.ts',
  'skills/statechart/scripts/passes/loop-check.ts',
  'skills/statechart/scripts/passes/paths.ts',
  'skills/statechart/scripts/passes/reach.ts',
  'skills/statechart/scripts/passes/region-check.ts',
  'skills/statechart/scripts/passes/regions.ts',
  'skills/statechart/scripts/pipeline.ts',
  'skills/statechart/scripts/run.ts',
  'skills/statechart/scripts/statechart.ts',
  'skills/statechart/scripts/test/messages.test.ts',
  'skills/statechart/scripts/worker.ts',
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

const skillNames = readdirSync(join(root, 'skills'));
// Skills this package adds for Pi, which upstream does not ship.
const piNativeSkills = new Set(['loop']);
// `/loop` is a Pi command, not a skill invocation, so it never needs the /skill: prefix.
const invokedSkillNames = skillNames.filter((name) => !piNativeSkills.has(name));
const banned = [...bannedBase, { pattern: new RegExp(`(^|[\\s\`("'])/(${invokedSkillNames.join('|')})\\b`), why: 'Pi invokes skills as /skill:<name>' }];

describe('the Pi port of pstack', () => {
  test('every skill loads through Pi with no diagnostics', () => {
    const { skills, diagnostics } = loadSkills({ cwd: root, agentDir: join(tmpdir(), 'pstack-v2-empty-agent'), skillPaths: [join(root, 'skills')], includeDefaults: false });
    expect(diagnostics).toEqual([]);
    const upstreamSkills = new Set(upstream.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path)).map((path) => path.split(PATH_SEPARATOR)[1]));
    expect(new Set(skills.map((skill) => skill.name))).toEqual(new Set([...upstreamSkills, ...piNativeSkills]));
  });

  test('every upstream file is still present', () => {
    // Split past the 800-line hard max; siblings replace these lock paths.
    const removed = new Set(['skills/statechart/scripts/test/chart.test.ts', 'skills/statechart/scripts/test/cli.test.ts']);
    const located = (path: string) => (path.startsWith('agents/') ? join(root, 'src', 'subagent', path) : join(root, path));
    expect(upstream.filter((path) => !removed.has(path) && !existsSync(located(path)))).toEqual([]);
  });

  test('unported upstream scripts are byte-identical', () => {
    const digest = (path: string) =>
      createHash('sha256')
        .update(readFileSync(join(root, path)))
        .digest('hex');
    const changed = upstream.filter((path) => !/\.(md|tsv)$/.test(path) && !portedUpstreamFiles.has(path)).filter((path) => digest(path) !== lock.files[path]);
    expect(changed).toEqual([]);
  });
});

const extractSubagentKeys = (line: string): string[] =>
  line
    .split(/(?=`(?:subagent|tmux_run|tmux_jobs)`)/)
    .filter((segment) => segment.startsWith('`subagent`'))
    .flatMap((segment) => [...segment.matchAll(/`(\w+): /g)].map(([, key = '']) => key));

describe('the Pi port of pstack, prose rules: mechanisms', () => {
  test('no prose or ported script names a Cursor or Claude Code mechanism', () => {
    const hits = scanned.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => banned.filter(({ pattern, allow }) => pattern.test(line) && !allow?.test(line)).map(({ why }) => `${relative(root, path)}:${index + 1} ${why}: ${line.trim().slice(0, LINE_PREVIEW_CHARS)}`)),
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

  test('no prose names pi_spawn, which the packaged subagent tool replaced', () => {
    const offenders = withMechanisms.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => (/pi_spawn/.test(line) ? [`${relative(root, path)}:${index + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });

  test('no prose sends the model to worker session files, since subagent workers run with no session', () => {
    const offenders = withMechanisms.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) => (/jobs\/[^/\s`]+\/session/.test(line) ? [`${relative(root, path)}:${index + 1}`] : [])),
    );
    expect(offenders).toEqual([]);
  });
});

const unknownSubagentKeys = (accepted: ReadonlySet<string>, filePath: string, line: string, index: number): string[] =>
  extractSubagentKeys(line)
    .filter((key) => !accepted.has(key))
    .map((key) => `${relative(root, filePath)}:${index + 1} ${key}`);

describe('the Pi port of pstack, prose rules: playbooks', () => {
  test('every `key: value` prose passes to subagent is a parameter subagent accepts', () => {
    const world = createWorld();
    const parameters = Object.keys(loadPstack(world, {}, subagentExtension).tool('subagent').parameters.properties);
    world.dispose();
    const accepted = new Set([...parameters, 'agent', 'task', 'cwd']);
    const offenders = withMechanisms.flatMap((filePath) =>
      readFileSync(filePath, 'utf8')
        .split('\n')
        .flatMap((line, index) => unknownSubagentKeys(accepted, filePath, line, index)),
    );
    expect(offenders).toEqual([]);
  });

  test('eval, arena, and interrogate candidates run on the neutral worker agent, so no role prompt steers or unblinds them', () => {
    const files = ['skills/poteto-mode/playbooks/eval.md', 'skills/arena/SKILL.md', 'skills/interrogate/SKILL.md'];
    const offenders = files.filter((file) => /poteto-agent/.test(readFileSync(join(root, file), 'utf8')) || !/`agent: "worker"`/.test(readFileSync(join(root, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('Autopilot-full runs owners as wake jobs, so the root verifies, ticks, and replaces stuck owners while they run', () => {
    const playbook = readFileSync(join(root, 'skills', 'poteto-mode', 'playbooks', 'autopilot-full.md'), 'utf8');
    expect(playbook).toMatch(/`subagent`[^.]*`wake: /);
    expect(playbook).toMatch(/`stop: "<job id>"`/);
    expect(playbook).not.toMatch(/aborts the owners' `subagent` call/);
  });

  test('Opening a PR puts the worktree inside the working directory, the only host directory the VM can edit', () => {
    expect(readFileSync(join(root, 'skills', 'poteto-mode', 'playbooks', 'opening-a-pr.md'), 'utf8')).toMatch(/worktree[^.]*inside the working directory/);
  });

  test('every checklist is a file named TODO.md, as Pi asks, under whichever directory holds it', () => {
    const offenders = [...prose, join(root, 'docs', 'pi-mechanisms.md')].filter((path) => /TODO\.[\w-]+\.md/.test(readFileSync(path, 'utf8'))).map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});

describe('the Pi port of pstack, links and names', () => {
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
