import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/start-run.mjs', import.meta.url));
const playbooks = fileURLToPath(new URL('../../skills/poteto-mode/playbooks/', import.meta.url));
const names = readdirSync(playbooks).filter((name) => name.endsWith('.md')).sort();
const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-todo-'));
  temporary.push(dir);
  return dir;
}
function run(cwd: string, name: string, runId = 'test-run', extra: string[] = []) {
  return spawnSync(process.execPath, [script, '--playbook', name, '--title', 'Test run', '--run-id', runId, '--playbooks-dir', playbooks, ...extra], { cwd, encoding: 'utf8' });
}

function sourceSteps(source: string): string[] {
  const prose = source.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
  return [...prose.matchAll(/^\d+\. .*$(?:\n(?:[ \t].*|$))*/gm)].map((match) => match[0].trimEnd());
}

test('the source inventory contains all 23 playbooks', () => {
  expect(names).toHaveLength(23);
});

test.for(names)('copies every complete source step from %s into TODO.md', (filename) => {
  const cwd = project();
  const name = filename.slice(0, -3);
  const result = run(cwd, name);
  expect(result.status, result.stderr).toBe(0);
  const runDir = join(cwd, '.pi/pstack/runs/test-run');
  const todo = readFileSync(join(runDir, 'TODO.md'), 'utf8');
  const section = todo.split('## Original playbook steps\n')[1]!.split('\n\n## Task-specific work')[0]!;
  const actual = section.split(/(?=^- \[ \] \d+\. )/m).filter((step) => step.startsWith('- [ ] ')).map((step) => step.replace(/^- \[ \] /, '').trimEnd());
  const expected = sourceSteps(readFileSync(join(playbooks, filename), 'utf8'));
  expect(actual).toEqual(expected);
  expect(section.startsWith(expected.length === 0 ? `_${name}.md has no numbered steps.` : '- [ ] 1. ')).toBe(true);
  expect(todo.endsWith('## Task-specific work\n')).toBe(true);
  expect(JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'))).toMatchObject({
    schemaVersion: 1, runId: 'test-run', playbook: name, title: 'Test run',
    upstreamRevision: '5866df557357d005b3c0c9d3da0d9e739b4bdde3', inputCommit: null,
  });
});

test('keeps nested lines and continuation paragraphs without treating code as numbered steps', () => {
  const cwd = project();
  const source = '1. First step.\n   - Nested instruction.\n\nContinuation paragraph.\n\n2. Second step.\n   ```text\n   99. Example, not a step.\n   ```\n\n**Reply:** Not a step.\n';
  writeFileSync(join(cwd, 'custom.md'), source);
  const result = run(cwd, 'custom', 'continuation', ['--playbooks-dir', cwd]);
  expect(result.status, result.stderr).toBe(0);
  const todo = readFileSync(join(cwd, '.pi/pstack/runs/continuation/TODO.md'), 'utf8');
  expect(todo).toContain('- [ ] 1. First step.\n   - Nested instruction.\n\nContinuation paragraph.\n- [ ] 2. Second step.\n   ```text\n   99. Example, not a step.\n   ```');
  expect(todo).not.toContain('**Reply:**');
});

test('refuses to overwrite an existing run', () => {
  const cwd = project();
  expect(run(cwd, 'feature').status).toBe(0);
  const todo = join(cwd, '.pi/pstack/runs/test-run/TODO.md');
  writeFileSync(todo, 'Operator checkpoint\n');
  const result = run(cwd, 'bug-fix');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('EEXIST');
  expect(readFileSync(todo, 'utf8')).toBe('Operator checkpoint\n');
});

test.for(['../escape', 'UPPER', '', 'a'.repeat(41)])('rejects invalid run id %j without creating a run', (id) => {
  const cwd = project();
  const result = run(cwd, 'feature', id);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Invalid run id');
  expect(existsSync(join(cwd, '.pi'))).toBe(false);
});

test('rejects playbook path traversal', () => {
  const cwd = project();
  const result = run(cwd, '../feature');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Invalid playbook id');
  expect(existsSync(join(cwd, '.pi'))).toBe(false);
});

test('uses the git project root and records the parent session and input commit', () => {
  const cwd = project();
  execFileSync('git', ['init', '-q', cwd]);
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Initial', '--allow-empty']);
  const commit = execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const child = join(cwd, 'child');
  mkdirSync(child);
  const result = run(child, 'feature', 'git-run', ['--parent-session-file', '/tmp/parent-session.jsonl']);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(readFileSync(join(cwd, '.pi/pstack/runs/git-run/run.json'), 'utf8'))).toMatchObject({ inputCommit: commit, parentSessionFile: '/tmp/parent-session.jsonl' });
});

test.for(['opening-a-pr', 'orchestrate'])('a playbook without numbered steps says so and points at its rules (%s)', (name) => {
  const cwd = project();
  expect(run(cwd, name).status).toBe(0);
  const todo = readFileSync(join(cwd, '.pi/pstack/runs/test-run/TODO.md'), 'utf8');
  const section = todo.split('## Original playbook steps\n')[1]!.split('\n\n## Task-specific work')[0]!;
  expect(section).toMatch(new RegExp(`no numbered steps.*${name}\\.md`));
});
