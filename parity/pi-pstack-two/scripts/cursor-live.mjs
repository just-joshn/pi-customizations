#!/usr/bin/env node
// Runs the pi-pstack live scenarios (poteto, delegate, readonly) through cursor-agent, the Cursor reference.
// Usage: cursor-live.mjs --scenario poteto|delegate|readonly [--model <cursor slug>] [--tag <name>] [--out <dir>]
// HOME points at a throwaway directory that links only ~/.cursor, ~/.local, and ~/Library, so user-level skill
// copies under ~/.claude and ~/.codex (older pstack versions) cannot shadow the installed plugin.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(homedir(), '.cursor/plugins/cache/cursor-public/pstack');
const pluginSkills = () => join(plugin, readFileSync(join(here, '../fixtures/0.15.21/cursor-plugin-revision.txt'), 'utf8').trim(), 'skills');

const playbookSteps = () =>
  readFileSync(join(pluginSkills(), 'poteto-mode/playbooks/investigation.md'), 'utf8')
    .split('\n')
    .filter((line) => /^\d+\. /.test(line))
    .map((line) => line.replace(/^\d+\. /, ''));
const plain = (text) => text.replace(/\*\*|`/g, '').replace(/^\d+\.\s*/, '');

const SCENARIOS = {
  poteto: {
    requirement: 'LIVE-001',
    prompt: '/poteto-mode How does add in calc.js treat two numeric strings such as "2" and "3"? This is a read-only question; do not change any files.',
    files: { 'calc.js': 'export function add(a, b) {\n  return a + b;\n}\n' },
    check: (calls) => {
      const steps = playbookSteps();
      const reads = calls.filter((call) => call.kind === 'readToolCall').map((call) => String(call.args.path));
      const todos = calls.find((call) => call.kind === 'updateTodosToolCall')?.args.todos ?? [];
      const verbatim = steps.map((step, index) => typeof todos[index]?.content === 'string' && plain(todos[index].content) === plain(step));
      return {
        readPlaybook: reads.some((path) => path.endsWith('poteto-mode/playbooks/investigation.md')),
        playbookPaths: reads.filter((path) => path.includes('poteto-mode')),
        firstTodosAreStepsVerbatim: verbatim.every(Boolean),
        stepMatches: verbatim,
        todos: todos.map((todo) => todo.content),
      };
    },
  },
  delegate: {
    requirement: 'LIVE-004',
    prompt: '/poteto-mode Delegate to one foreground poteto-agent: find what calc.js exports. Read-only.',
    files: { 'calc.js': 'export const add = (a, b) => a + b;\n' },
    check: (calls) => {
      const delegates = calls.filter((call) => call.kind === 'taskToolCall' && JSON.stringify(call.args.subagentType ?? '').includes('poteto'));
      const prompts = delegates.map((call) => String(call.args.prompt ?? ''));
      return {
        delegated: delegates.length > 0,
        everyPromptHasSkillPath: prompts.length > 0 && prompts.every((prompt) => /\/poteto-mode\/SKILL\.md/.test(prompt)),
        prompts: prompts.map((prompt) => prompt.slice(0, 400)),
        subagentTypes: delegates.map((call) => call.args.subagentType),
      };
    },
  },
  readonly: {
    requirement: 'TASK-019',
    prompt:
      'Use the Task tool exactly once with subagent_type parity-reader (it has readonly: true in its agent frontmatter). The subagent must run each of these shell commands separately, exactly as written, and report verbatim each command, its exit code, and its output or error: (1) git log --oneline -1 (2) touch probe.txt (3) curl -sS -m 5 -o /dev/null -w "%{http_code}" https://example.com (4) echo x > /tmp/cursor-ro-written.txt. Do not run any of these commands yourself. Report the subagent results verbatim.',
    files: { 'a.txt': 'hi\n' },
    check: (_calls, work) => ({ probeFileCreated: existsSync(join(work, 'probe.txt')), tmpFileCreated: existsSync('/tmp/cursor-ro-written.txt') }),
  },
};

function cursorHome() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'cursor-home-')));
  for (const name of ['.cursor', '.local', 'Library']) symlinkSync(join(homedir(), name), join(home, name));
  return home;
}

function run(work, home, model, prompt) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawn('cursor-agent', ['-p', '--trust', '--force', '--output-format', 'stream-json', '--model', model, prompt], { cwd: work, env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr: stderr.slice(-2000), seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

function toolCalls(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === 'tool_call' && event.subtype === 'started')
    .map((event) => {
      const kind = Object.keys(event.tool_call).find((key) => key.endsWith('ToolCall')) ?? 'unknown';
      return { kind, args: event.tool_call[kind]?.args ?? {} };
    });
}

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const name = option('--scenario', 'poteto');
const model = option('--model', 'claude-opus-5-5-high');
const tag = option('--tag', undefined);
const outDir = resolve(option('--out', join(here, '../evidence')));
const scenario = SCENARIOS[name];
if (scenario === undefined) throw new Error(`unknown scenario ${name}`);

const work = realpathSync(mkdtempSync(join(tmpdir(), 'cursor-live-')));
const home = cursorHome();
try {
  for (const [file, text] of Object.entries(scenario.files)) writeFileSync(join(work, file), text);
  // Explicit project discovery avoids both older global skills and plugin discovery differences under isolated HOME.
  cpSync(pluginSkills(), join(work, '.cursor/skills'), { recursive: true });
  cpSync(join(pluginSkills(), '../agents'), join(work, '.cursor/agents'), { recursive: true });
  if (name === 'readonly')
    writeFileSync(
      join(work, '.cursor/agents/parity-reader.md'),
      '---\nname: parity-reader\ndescription: Read-only shell parity probe.\nreadonly: true\n---\nRun the requested probe commands and report their exact exit codes and outputs.\n',
    );
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work });
  execFileSync('git', ['add', '-A'], { cwd: work });
  execFileSync('git', ['-c', 'user.email=live@example.com', '-c', 'user.name=live', 'commit', '-qm', 'fixture'], { cwd: work });
  rmSync('/tmp/cursor-ro-written.txt', { force: true });
  const result = await run(work, home, model, scenario.prompt);
  const calls = toolCalls(result.stdout);
  const final = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((event) => event.type === 'result');
  const record = {
    host: 'cursor-agent',
    cursorAgentVersion: execFileSync('cursor-agent', ['--version'], { encoding: 'utf8' }).trim(),
    scenario: name,
    requirement: scenario.requirement,
    model,
    prompt: scenario.prompt,
    exitCode: result.code,
    seconds: result.seconds,
    checks: scenario.check(calls, work),
    toolCalls: calls.map((call) => ({ kind: call.kind, args: JSON.stringify(call.args).slice(0, 600) })),
    finalText: String(final?.result ?? '').slice(0, 3000),
    stderrTail: result.stderr,
  };
  mkdirSync(outDir, { recursive: true });
  const stem = `cursor-${name}${tag === undefined ? '' : `-${tag}`}`;
  writeFileSync(join(outDir, `${stem}.json`), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(outDir, `${stem}.jsonl`), result.stdout);
  writeFileSync(join(outDir, `${stem}.stderr.txt`), result.stderr);
  process.stdout.write(`${name}: ${JSON.stringify(record.checks)}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
