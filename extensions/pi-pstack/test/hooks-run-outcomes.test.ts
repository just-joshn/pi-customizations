import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { additionalContexts, permissionAnswer, preToolUseVerdict } from '../src/subagents/hook-outcomes.ts';
import { type HookRun, runCommandHooks } from '../src/subagents/hook-run.ts';

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hook-run-'));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function hookRun(overrides: Partial<HookRun> = {}): HookRun {
  return { command: 'hook', code: 0, stdout: '', stderr: '', ...overrides };
}

test('the event payload reaches the hook on stdin and a JSON object on stdout comes back parsed', async () => {
  const cwd = await tempDir();
  const [run] = await runCommandHooks([{ command: 'cat' }], { tool_name: 'Bash', hook_event_name: 'PreToolUse' }, { cwd });
  expect(run).toEqual({
    command: 'cat',
    code: 0,
    stdout: '{"tool_name":"Bash","hook_event_name":"PreToolUse"}',
    stderr: '',
    json: { tool_name: 'Bash', hook_event_name: 'PreToolUse' },
  });
});

test('hooks run in the given cwd with CLAUDE_PROJECT_DIR set over the supplied environment', async () => {
  const cwd = await tempDir();
  const env = { PATH: process.env.PATH, FLAVOR: 'mint', CLAUDE_PROJECT_DIR: 'stale' };
  const [run] = await runCommandHooks([{ command: 'echo "$FLAVOR $CLAUDE_PROJECT_DIR"' }], {}, { cwd, env });
  expect(run?.stdout).toBe(`mint ${cwd}\n`);
});

test('a command shared by several hooks runs once and results keep first-seen order', async () => {
  const cwd = await tempDir();
  const counter = join(cwd, 'count.txt');
  const runs = await runCommandHooks([{ command: `echo tick >> '${counter}'` }, { command: 'echo second' }, { command: `echo tick >> '${counter}'` }], {}, { cwd });
  expect(runs.map((run) => run.command)).toEqual([`echo tick >> '${counter}'`, 'echo second']);
  expect(await readFile(counter, 'utf8')).toBe('tick\n');
});

test.for([
  { name: 'a failing hook keeps its stderr and exit code', command: 'echo nope >&2; exit 2', expected: { code: 2, stdout: '', stderr: 'nope\n' } },
  { name: 'JSON from a failing hook is not parsed', command: `echo '{"a":1}'; exit 1`, expected: { code: 1, stdout: '{"a":1}\n', stderr: '' } },
  { name: 'malformed JSON stays plain stdout', command: `echo '{bad'`, expected: { code: 0, stdout: '{bad\n', stderr: '' } },
  { name: 'non-object output is not parsed', command: `echo '[1]'`, expected: { code: 0, stdout: '[1]\n', stderr: '' } },
])('$name', async ({ command, expected }) => {
  const cwd = await tempDir();
  const [run] = await runCommandHooks([{ command }], {}, { cwd });
  expect(run).toEqual({ command, ...expected });
});

test('the timeout cap bounds a hook that asks for longer', async () => {
  const cwd = await tempDir();
  const [run] = await runCommandHooks([{ command: 'sleep 30', timeoutMs: 30_000 }], {}, { cwd, timeoutCapMs: 50 });
  expect(run?.code).toBe(124);
  expect(run?.stderr).toContain('terminated by timeout');
});

test.for([
  { name: 'exit code 2 denies with the stderr text', runs: [hookRun({ code: 2, stderr: ' not here \n' })], expected: { decision: 'deny', reason: 'not here' } },
  { name: 'exit code 2 without stderr uses the default reason', runs: [hookRun({ code: 2 })], expected: { decision: 'deny', reason: 'blocked by a PreToolUse hook' } },
  { name: 'other failures decide nothing', runs: [hookRun({ code: 1, stderr: 'boom', json: { decision: 'block' } })], expected: {} },
  { name: 'a successful hook with no JSON decides nothing', runs: [hookRun({ stdout: 'hi' })], expected: {} },
  { name: 'no hooks decide nothing', runs: [], expected: {} },
  {
    name: 'permissionDecision, reason and rewritten input are read from hookSpecificOutput',
    runs: [hookRun({ json: { hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'check it', updatedInput: { command: 'ls' } } } })],
    expected: { decision: 'ask', reason: 'check it', updatedInput: { command: 'ls' } },
  },
  { name: 'the legacy block decision denies with its reason', runs: [hookRun({ json: { decision: 'block', reason: 'legacy' } })], expected: { decision: 'deny', reason: 'legacy' } },
  { name: 'the legacy approve decision allows', runs: [hookRun({ json: { decision: 'approve' } })], expected: { decision: 'allow' } },
  { name: 'an unknown permissionDecision is ignored', runs: [hookRun({ json: { hookSpecificOutput: { permissionDecision: 'maybe' } } })], expected: {} },
  { name: 'a non-object hookSpecificOutput is ignored', runs: [hookRun({ json: { hookSpecificOutput: 'allow' } })], expected: {} },
  { name: 'an array updatedInput is ignored', runs: [hookRun({ json: { hookSpecificOutput: { permissionDecision: 'allow', updatedInput: [1] } } })], expected: { decision: 'allow' } },
])('pre-tool verdict: $name', ({ runs, expected }) => {
  expect(preToolUseVerdict(runs)).toEqual(expected);
});

test('deny beats ask beats allow across hooks and the decider supplies the reason', () => {
  const allow = hookRun({ json: { hookSpecificOutput: { permissionDecision: 'allow', permissionDecisionReason: 'fine' } } });
  const ask = hookRun({ json: { hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'unsure' } } });
  const deny = hookRun({ code: 2, stderr: 'forbidden' });
  expect(preToolUseVerdict([allow, ask])).toEqual({ decision: 'ask', reason: 'unsure' });
  expect(preToolUseVerdict([allow, ask, deny])).toEqual({ decision: 'deny', reason: 'forbidden' });
});

test('the last rewritten input wins even when an earlier hook decided', () => {
  const first = hookRun({ json: { hookSpecificOutput: { permissionDecision: 'deny', updatedInput: { n: 1 } } } });
  const second = hookRun({ json: { hookSpecificOutput: { updatedInput: { n: 2 } } } });
  expect(preToolUseVerdict([first, second])).toEqual({ decision: 'deny', updatedInput: { n: 2 } });
});

test.for([
  { name: 'exit code 2 denies with stderr', runs: [hookRun({ code: 2, stderr: 'no\n' })], expected: { behavior: 'deny', message: 'no' } },
  { name: 'exit code 2 without stderr uses the default message', runs: [hookRun({ code: 2 })], expected: { behavior: 'deny', message: 'denied by a PermissionRequest hook' } },
  {
    name: 'an allow answer carries its message and rewritten input',
    runs: [hookRun({ json: { hookSpecificOutput: { decision: { behavior: 'allow', message: 'ok', updatedInput: { path: '/x' } } } } })],
    expected: { behavior: 'allow', message: 'ok', updatedInput: { path: '/x' } },
  },
  { name: 'an unknown behavior is no answer', runs: [hookRun({ json: { hookSpecificOutput: { decision: { behavior: 'later' } } } })], expected: undefined },
  { name: 'a hook without a decision is no answer', runs: [hookRun({ json: { hookSpecificOutput: {} } }), hookRun()], expected: undefined },
  {
    name: 'a denial from any hook beats an earlier allow',
    runs: [hookRun({ json: { hookSpecificOutput: { decision: { behavior: 'allow' } } } }), hookRun({ json: { hookSpecificOutput: { decision: { behavior: 'deny', message: 'late' } } } })],
    expected: { behavior: 'deny', message: 'late' },
  },
  {
    name: 'with no denial the first answer decides',
    runs: [hookRun({ json: { hookSpecificOutput: { decision: { behavior: 'allow', message: 'first' } } } }), hookRun({ json: { hookSpecificOutput: { decision: { behavior: 'allow', message: 'second' } } } })],
    expected: { behavior: 'allow', message: 'first' },
  },
])('permission answer: $name', ({ runs, expected }) => {
  expect(permissionAnswer(runs)).toEqual(expected);
});

test('additional context is collected only from successful hooks that supply non-empty text', () => {
  const runs = [
    hookRun({ json: { hookSpecificOutput: { additionalContext: 'remember the lint rules' } } }),
    hookRun({ code: 1, json: { hookSpecificOutput: { additionalContext: 'from a failure' } } }),
    hookRun({ json: { hookSpecificOutput: { additionalContext: '' } } }),
    hookRun({ json: { hookSpecificOutput: { additionalContext: 7 } } }),
    hookRun({ json: { hookSpecificOutput: { additionalContext: 'second note' } } }),
  ];
  expect(additionalContexts(runs)).toEqual(['remember the lint rules', 'second note']);
});
