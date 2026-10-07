#!/usr/bin/env node
// Installs pi-s50 into a throwaway project through `pi install -l`, runs one bounded feature simulation through Pi,
// and checks that the coordinator owns `.s50/` while the skill stays thin. Needs `pi`, `git`, a configured model, and network access.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const REQUIRED = [
  'grilling',
  'domain-modeling',
  'codebase-design',
  'prototype',
  'tdd',
  'diagnosing-bugs',
  'frontend-design',
  'vercel-react-best-practices',
  'web-design-guidelines',
  'agent-browser',
  'triage',
  'improve-codebase-architecture',
  'setup-matt-pocock-skills',
];
const PROMPT =
  "Use the s50 skill to start an S50 feature run in this repository. Objective: print a greeting with the user's name. Consumer: cli:node bin/hello.mjs. Criteria: hello prints Hello, NAME. If no registry lock exists, refresh the registry first. Then follow the s50 loop for at most 8 more s50 tool calls and stop at the first human gate. Do not edit any files yourself.";

// Pi's JSON transcript repeats the whole system prompt, which is over 1 MB with a loaded agent directory, so the buffer must hold it.
const run = (cmd, args, cwd, timeout = 120_000) => execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const results = [];
const check = (ok, label) => results.push(`${ok ? 'PASS' : 'FAIL'} ${label}`);

const work = mkdtempSync(join(tmpdir(), 's50-harness-'));
const project = join(work, 'project');
mkdirSync(join(project, 'bin'), { recursive: true });
writeFileSync(join(project, 'bin/hello.mjs'), ['#!/usr/bin/env node', "console.info('hello');", ''].join('\n'));
writeFileSync(join(project, 'package.json'), '{"name":"hello","scripts":{"test":"node bin/hello.mjs"}}\n');
writeFileSync(join(project, '.gitignore'), '.agents/\n.pi/\nrun.jsonl\n');
run('git', ['init', '-q', '-b', 'main'], project);
run('git', ['add', '-A'], project);
run('git', ['-c', 'user.email=s50@example.test', '-c', 'user.name=s50', 'commit', '-qm', 'init'], project);

const pins = JSON.parse(readFileSync(join(PACKAGE, 'registry/skill-sources.json'), 'utf8'));
const checkouts = new Map();
for (const name of REQUIRED) {
  const { repository, commit, path } = pins[name];
  const key = `${repository}@${commit}`;
  if (!checkouts.has(key)) {
    const dir = join(work, `upstream-${checkouts.size}`);
    mkdirSync(dir);
    run('git', ['init', '-q'], dir);
    run('git', ['fetch', '-q', '--depth', '1', `https://github.com/${repository}`, commit], dir);
    run('git', ['checkout', '-q', 'FETCH_HEAD'], dir);
    checkouts.set(key, dir);
  }
  cpSync(join(checkouts.get(key), path.replace(/\/SKILL\.md$/, '')), join(project, '.agents/skills', name), { recursive: true });
}

run('pi', ['install', '-l', '--approve', PACKAGE], project);
const transcript = run('pi', ['-p', '--no-session', '--approve', '--mode', 'json', PROMPT], project, 900_000);
writeFileSync(join(project, 'run.jsonl'), transcript);

const events = transcript.split('\n').flatMap((line) => {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
});
const calls = events.filter((event) => event.type === 'tool_execution_start');
const s50Calls = calls.filter((call) => call.toolName === 's50').map((call) => call.args.argv);
const touchesState = /(>{1,2}\s*\.s50\b|\b(tee|rm|mv|cp|touch|sed\s+-i)\b[^|;&]*\.s50\b)/;
const writes = calls.filter((call) => ['edit', 'write'].includes(call.toolName) || (call.toolName === 'bash' && touchesState.test(call.args.command ?? '')));
check(
  s50Calls.some((argv) => argv[0] === 'feature'),
  'the agent started the run through the s50 tool',
);
check(writes.length === 0, 'the agent wrote no file and never touched .s50/ outside the tool');
const runFile = join(project, '.s50/run.json');
check(existsSync(runFile), 'the coordinator wrote .s50/run.json');
if (existsSync(runFile)) {
  const state = JSON.parse(readFileSync(runFile, 'utf8'));
  check(state.schemaVersion === 2 && state.mode === 'feature', `run.json is a schema 2 feature run (phase ${state.phase})`);
  check(state.status.kind === 'blocked', `the run stopped at a human gate (${state.status.gate?.kind ?? state.status.kind})`);
  const decisions = readFileSync(join(project, '.s50/decisions.jsonl'), 'utf8');
  check(decisions.includes('"invoked grilling"'), 'the coordinator logged the grilling invocation');
}
const skill = readFileSync(join(PACKAGE, 'skills/s50/SKILL.md'), 'utf8').split('\n---\n')[1] ?? '';
check(skill.split('\n').length <= 80, `the s50 skill body stays thin (${skill.split('\n').length} lines)`);

process.stdout.write(`${results.join('\n')}\nproject: ${project}\ns50 calls: ${JSON.stringify(s50Calls)}\n`);
process.exitCode = results.every((line) => line.startsWith('PASS')) ? 0 : 1;
