#!/usr/bin/env node
// Runs pstack scenarios against a real model through the Pi CLI and records what the model did.
// Usage: live-e2e.mjs [--model provider/id] [--scenario poteto|delegate|nocomments|setup|all] [--out <dir>] [--tag <name>]
//                     [--rule <file>] [--providers claude-subscription]
// --rule copies a pstack-models.mdc into the throwaway agent directory first, for example to bound subagent cost.
// --providers loads extra provider packages so their models are available without driving the run.
// It needs credentials in the user's Pi auth.json. Each scenario uses a throwaway workspace, HOME, and agent
// directory, and auth.json is symlinked rather than copied. Pi writes refreshed OAuth tokens through that symlink,
// so an OAuth refresh during a live run updates the user's real auth.json, and its lock file sits beside the
// symlink rather than the real file; avoid running OAuth-provider scenarios while another Pi session refreshes.
// The model under test has bash and write tools, so it could read or overwrite the real auth.json through that
// symlink. Run it only with models and prompts you trust, and review the recorded tool calls in the evidence file.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSubagentModel } from '../src/task/models.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const cli = join(packageRoot, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const userAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');
const ROLES = [
  'feature, refactoring',
  'bug-fix',
  'perf-issue',
  'hillclimb',
  'judgment and prose',
  'hardest tasks',
  'how explorer',
  'how explainer',
  'why investigators',
  'why synthesizer',
  'reflect tooling',
  'reflect judgment, divergent, synthesizer',
  'arena runners',
  'arena cross-judge pool',
  'swarm workers',
  'architect runners',
  'interrogate reviewers',
];

const PROVIDER_PACKAGES = { 'claude-subscription': 'extensions/pi-anthropic-oauth' };

function sandbox(model, ruleFile, providers) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-live-')));
  const agentDir = join(root, 'agent');
  const work = join(root, 'work');
  mkdirSync(agentDir);
  mkdirSync(work);
  mkdirSync(join(root, 'home'));
  symlinkSync(join(userAgentDir, 'auth.json'), join(agentDir, 'auth.json'));
  // Only the driver's provider loads, so default role models such as claude-opus-5-5-xhigh cannot bill a subscription unasked.
  const wanted = new Set([model.split('/')[0], ...providers]);
  const packages = [
    packageRoot,
    ...Object.entries(PROVIDER_PACKAGES)
      .filter(([provider]) => wanted.has(provider))
      .map(([, path]) => join(repoRoot, path)),
  ];
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages, quietStartup: true, defaultProvider: model.split('/')[0], defaultModel: model.split('/')[1] }));
  if (ruleFile !== undefined) {
    mkdirSync(join(agentDir, 'pstack'));
    writeFileSync(join(agentDir, 'pstack/pstack-models.mdc'), readFileSync(ruleFile));
  }
  const git = (...args) => execFileSync('git', ['-C', work, ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  return { root, agentDir, work, git, env: { ...process.env, HOME: join(root, 'home'), PI_CODING_AGENT_DIR: agentDir } };
}

function commitAll(box, message) {
  box.git('add', '-A');
  box.git('-c', 'user.email=live@example.com', '-c', 'user.name=live', 'commit', '-qm', message);
}

function runPi(box, model, prompt, timeoutMs) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawn(process.execPath, [cli, '--mode', 'json', '--no-session', '--model', model, prompt], { cwd: box.work, env: box.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const events = [];
    let buffer = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line !== '') events.push(JSON.parse(line));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ events, code, stderr: stderr.slice(-4000), seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

function toolCalls(events) {
  return events
    .filter((event) => event.type === 'message_end' && event.message?.role === 'assistant')
    .flatMap((event) => event.message.content.filter((part) => part.type === 'toolCall').map((part) => ({ name: part.name, arguments: part.arguments })));
}

function finalText(events) {
  const last = events.filter((event) => event.type === 'message_end' && event.message?.role === 'assistant').at(-1);
  return (last?.message.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .slice(0, 3000);
}

const playbookSteps = (name) =>
  readFileSync(join(packageRoot, `skills/poteto-mode/playbooks/${name}.md`), 'utf8')
    .split('\n')
    .filter((line) => /^\d+\. /.test(line))
    .map((line) => line.replace(/^\d+\. /, ''));

const SCENARIOS = {
  poteto: {
    requirement: 'LIVE-001',
    prompt: '/poteto-mode How does add in calc.js treat two numeric strings such as "2" and "3"? This is a read-only question; do not change any files.',
    prepare: (box) => {
      writeFileSync(join(box.work, 'calc.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
      commitAll(box, 'calc');
    },
    check: (calls, box) => {
      const steps = playbookSteps('investigation');
      const readPlaybook = calls.some((call) => call.name === 'read' && String(call.arguments.path ?? '').endsWith('poteto-mode/playbooks/investigation.md'));
      const todos = calls.find((call) => call.name === 'TodoWrite')?.arguments.todos ?? [];
      // A todo list is plain text, so Markdown emphasis marks (** and backticks) are dropped before comparing.
      const plain = (text) => text.replace(/\*\*|`/g, '');
      const verbatim = steps.map((step, index) => typeof todos[index]?.content === 'string' && plain(todos[index].content) === plain(step));
      const clean = execFileSync('git', ['-C', box.work, 'status', '--porcelain'], { encoding: 'utf8' }).trim() === '';
      return { readPlaybook, firstTodosAreStepsVerbatim: verbatim.every(Boolean), stepMatches: verbatim, workspaceUnchanged: clean, todos: todos.map((todo) => todo.content) };
    },
  },
  delegate: {
    requirement: 'LIVE-004',
    prompt: '/poteto-mode Delegate to one foreground poteto-agent: find what calc.js exports. Read-only.',
    prepare: (box) => {
      writeFileSync(join(box.work, 'calc.js'), 'export const add = (a, b) => a + b;\n');
      commitAll(box, 'calc');
    },
    check: (calls) => {
      // pstack 0.15.21: the parent puts poteto-mode's absolute SKILL.md path in every poteto-agent prompt.
      const skillPath = join(packageRoot, 'skills/poteto-mode/SKILL.md');
      const delegates = calls.filter((call) => call.name === 'Task' && call.arguments.subagent_type === 'poteto-agent');
      return {
        delegated: delegates.length > 0,
        everyPromptHasSkillPath: delegates.length > 0 && delegates.every((call) => String(call.arguments.prompt ?? '').includes(skillPath)),
        prompts: delegates.map((call) => String(call.arguments.prompt ?? '').slice(0, 400)),
      };
    },
  },
  nocomments: {
    requirement: 'LIVE-002',
    prompt: '/no-comments',
    prepare: (box) => {
      writeFileSync(join(box.work, 'util.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
      commitAll(box, 'util');
      writeFileSync(join(box.work, 'util.js'), '// This function adds two numbers together\nexport function add(a, b) {\n  // return the sum of a and b\n  return a + b;\n}\n');
    },
    check: (calls) => {
      const tasks = calls.filter((call) => call.name === 'Task');
      return { spawnedCommentSicko: tasks.some((call) => call.arguments.subagent_type === 'comment-sicko'), taskTypes: tasks.map((call) => call.arguments.subagent_type ?? '(default)') };
    },
  },
  setup: {
    requirement: 'LIVE-003',
    prompt:
      "/setup-pstack Use the large budget and keep the skill's mapping. For a role whose default model is not available, use the closest available model of the same family, else inherit-parent. Do not ask me anything; write the rule now.",
    prepare: () => undefined,
    check: (_calls, box, model) => {
      const rule = join(box.agentDir, 'pstack/pstack-models.mdc');
      const text = existsSync(rule) ? readFileSync(rule, 'utf8') : '';
      const missing = ROLES.filter((role) => !text.split('\n').some((line) => line.startsWith(`${role}:`)));
      const values = text
        .split('\n')
        .filter((line) => ROLES.some((role) => line.startsWith(`${role}:`)))
        .flatMap((line) => line.slice(line.indexOf(':') + 1).split(','))
        .map((value) => value.trim());
      const available = listModels(box);
      const parent = { provider: model.split('/')[0], id: model.split('/')[1] };
      const unresolved = values.filter((value) => {
        try {
          resolveSubagentModel(value, available, parent);
          return false;
        } catch {
          return true;
        }
      });
      return {
        ruleWritten: text !== '',
        alwaysApply: /alwaysApply: true/.test(text),
        missingRoles: missing,
        distinctValues: [...new Set(values)],
        unresolvedValues: unresolved,
        wroteCursorRule: existsSync(join(box.root, 'home/.cursor/rules/pstack-models.mdc')),
        rule: text,
      };
    },
  },
};

/** The models the throwaway agent directory exposes, with the thinking levels Pi supports for each, as Task sees them. */
function listModels(box) {
  const fixture = join(packageRoot, 'test/fixtures/list-models.ts');
  const output = execFileSync(process.execPath, [cli, '-p', '--offline', '--no-session', '-e', fixture, '/list-models'], { cwd: box.work, env: box.env, encoding: 'utf8' });
  return output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

async function runScenario(name, model, outDir, tag, ruleFile, providers) {
  const scenario = SCENARIOS[name];
  const box = sandbox(model, ruleFile, providers);
  try {
    scenario.prepare(box);
    const run = await runPi(box, model, scenario.prompt, 15 * 60_000);
    const calls = toolCalls(run.events);
    const result = {
      scenario: name,
      requirement: scenario.requirement,
      model,
      prompt: scenario.prompt,
      exitCode: run.code,
      seconds: run.seconds,
      checks: scenario.check(calls, box, model),
      toolCalls: calls.map((call) => ({ name: call.name, arguments: JSON.stringify(call.arguments).slice(0, 600) })),
      finalText: finalText(run.events),
      stderrTail: run.stderr,
    };
    writeFileSync(join(outDir, `live-${name}${tag === undefined ? '' : `-${tag}`}.json`), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${name}: ${JSON.stringify(result.checks)}\n`);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const model = option('--model', 'deepseek/deepseek-flash');
const outDir = resolve(option('--out', join(repoRoot, 'parity/pi-pstack-two/evidence')));
const chosen = option('--scenario', 'all');
const tag = option('--tag', undefined);
const ruleFile = argv.includes('--rule') ? resolve(option('--rule', '')) : undefined;
const providers = option('--providers', '').split(',').filter(Boolean);
mkdirSync(outDir, { recursive: true });
for (const name of chosen === 'all' ? Object.keys(SCENARIOS) : [chosen]) await runScenario(name, model, outDir, tag, ruleFile, providers);
