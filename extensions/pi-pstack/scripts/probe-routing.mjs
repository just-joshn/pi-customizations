import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [label, pstackRoot, fixture = '/tmp/pstack-probe'] = process.argv.slice(2);
if (!label || !pstackRoot) throw new Error('Usage: node probe-routing.mjs <label> <pstack-root> [fixture-repo]');
const repo = resolve(import.meta.dirname, '../../..');
const work = `/tmp/pstack-probe-${label}`;
const sessions = `${work}-sessions`;
const task = '/skill:poteto-mode add a slugify(text) function to src/text.js that lowercases, trims, and joins words with hyphens, with node:test tests';

rmSync(work, { recursive: true, force: true });
rmSync(sessions, { recursive: true, force: true });
cpSync(fixture, work, { recursive: true });
mkdirSync(sessions, { recursive: true });
const extensions = [join(repo, 'extensions/pi-anthropic-oauth/src/index.ts'), join(resolve(pstackRoot), 'src/index.ts')];
try {
  const resources = [...['skills', 'host/skills'].flatMap((path) => ['--skill', join(resolve(pstackRoot), path)]), ...['prompts', 'host/prompts'].flatMap((path) => ['--prompt-template', join(resolve(pstackRoot), path)])];
  execFileSync(
    'pi',
    [
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      ...extensions.flatMap((path) => ['-e', path]),
      ...resources,
      ...(process.env.PROBE_MODEL ? ['--model', process.env.PROBE_MODEL] : []),
      '--session-dir',
      sessions,
      '-p',
      process.env.PROBE_TASK ?? task,
    ],
    {
      cwd: work,
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: Number(process.env.PROBE_TIMEOUT_MS ?? 900_000),
    },
  );
} catch (error) {
  process.stdout.write(`probe run ended early: ${error.message.split('\n')[0]}\n`);
}

const file = readdirSync(sessions).find((name) => name.endsWith('.jsonl'));
if (!file) throw new Error(`No session transcript in ${sessions}`);
const entries = readFileSync(join(sessions, file), 'utf8').trim().split('\n').map(JSON.parse);
const assistant = entries.filter((entry) => entry.type === 'message' && entry.message.role === 'assistant').map((entry) => entry.message);
const calls = assistant.flatMap((message) => message.content.filter((part) => part.type === 'toolCall'));
const skillFile = /(?:skills|host\/skills)\/[\w-]+\/(?:SKILL\.md|playbooks\/[\w-]+\.md)/g;
const reads = new Set(calls.flatMap((call) => JSON.stringify(call.arguments).match(skillFile) ?? []));
const todos = calls.filter((call) => call.name === 'TodoWrite').flatMap((call) => call.arguments.todos.map((todo) => todo.content));
const feature = readFileSync(join(pstackRoot, 'skills/poteto-mode/playbooks/feature.md'), 'utf8');
const steps = [...feature.matchAll(/^\d+\. (.+)$/gm)].map((match) => match[1].trim());
const verbatim = steps.filter((step) => todos.some((todo) => todo.includes(step))).length;
const reply =
  assistant
    .at(-1)
    ?.content.filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n') ?? '';
const hedge = /not (?:implemented|supplied|available|reproduced|enabled|verified)|unavailable|unsupported|unmet|Cursor|skip(?:ped)?/gi;

const result = {
  label,
  model: process.env.PROBE_MODEL ?? 'default',
  toolCalls: calls.length,
  taskCalls: calls.filter((call) => call.name === 'Task').length,
  skillFilesRead: [...reads].toSorted(),
  featureStepsVerbatim: `${verbatim}/${steps.length}`,
  replyHedges: (reply.match(hedge) ?? []).length,
  transcript: join(sessions, file),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
