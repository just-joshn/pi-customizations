#!/usr/bin/env node
// Checks the 0.15.36-pi.12 behavior changes against a real model through the real Pi CLI in RPC mode, and prints
// what the model saw and did. It spends tokens and needs credentials in the user's Pi auth.json, which it symlinks
// into a throwaway agent directory the way extensions/pi-pstack/scripts/live-e2e.mjs does; read that script's header
// before running this. Usage: node live-check.mjs [provider/model]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageRoot = join(repoRoot, 'extensions/pi-pstack');
const cli = join(packageRoot, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const model = process.argv[2] ?? 'claude-subscription/claude-haiku-4-5';
const userAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent');

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-live-check-')));
  const agentDir = join(root, 'agent');
  const work = join(root, 'work');
  for (const dir of [agentDir, work, join(root, 'home')]) mkdirSync(dir);
  symlinkSync(join(userAgentDir, 'auth.json'), join(agentDir, 'auth.json'));
  const packages = [packageRoot, ...(model.startsWith('claude-subscription/') ? [join(repoRoot, 'extensions/pi-anthropic-oauth')] : [])];
  const [provider, id] = model.split('/');
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages, quietStartup: true, defaultProvider: provider, defaultModel: id }));
  // Subagents run on the parent model, so the check never bills a model it was not given.
  mkdirSync(join(agentDir, 'pstack'));
  writeFileSync(join(agentDir, 'pstack/pstack-models.md'), '# budget: small (medium)\nfeature, refactoring: inherit-parent\n');
  execFileSync('git', ['-C', work, 'init', '-q', '-b', 'main']);
  writeFileSync(join(work, 'calc.js'), 'export function add(a, b) {\n  return a + b;\n}\n');
  execFileSync('git', ['-C', work, 'add', '-A']);
  execFileSync('git', ['-C', work, '-c', 'user.email=live@example.com', '-c', 'user.name=live', 'commit', '-qm', 'calc']);
  return { root, work, env: { ...process.env, HOME: join(root, 'home'), PI_CODING_AGENT_DIR: agentDir } };
}

function rpc(box, answers) {
  const child = spawn(process.execPath, [cli, '--mode', 'rpc', '--no-session', '--model', model], { cwd: box.work, env: box.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  const waiters = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line === '') continue;
      const event = JSON.parse(line);
      events.push(event);
      if (event.type === 'extension_ui_request' && (event.method === 'select' || event.method === 'confirm')) {
        const answer = answers.shift();
        child.stdin.write(`${JSON.stringify({ type: 'extension_ui_response', id: event.id, ...(typeof answer === 'boolean' ? { confirmed: answer } : answer === undefined ? { cancelled: true } : { value: answer }) })}\n`);
      }
      for (const waiter of waiters.filter((candidate) => candidate.predicate(event))) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk.toString('utf8')));
  const waitFor = (predicate, ms = 240_000) =>
    new Promise((resolveWait, reject) => {
      const seen = events.find(predicate);
      if (seen !== undefined) return resolveWait(seen);
      const timer = setTimeout(() => reject(new Error(`timed out\n${stderr.slice(-2000)}`)), ms);
      waiters.push({
        predicate,
        resolve: (event) => {
          clearTimeout(timer);
          resolveWait(event);
        },
      });
    });
  const prompt = async (message) => {
    const mark = events.length;
    child.stdin.write(`${JSON.stringify({ type: 'prompt', message })}\n`);
    if (message.startsWith('/mode') || message === '/plan' || message === '/plan off') return events.slice(mark);
    await waitFor((event) => event.type === 'agent_settled' && events.indexOf(event) >= mark);
    return events.slice(mark);
  };
  const close = () =>
    new Promise((done) => {
      child.once('close', done);
      child.stdin.end();
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    });
  return { events, prompt, waitFor, close };
}

const replies = (events) =>
  events
    .filter((event) => event.type === 'message_end' && event.message?.role === 'assistant')
    .map((event) =>
      event.message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(''),
    )
    .filter((text) => text !== '');
const calls = (events) => events.filter((event) => event.type === 'tool_execution_end').map((event) => event.toolName);

const results = [];
const record = (check, pass, detail) => {
  results.push({ check, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${check}\n  ${String(detail).replace(/\n/g, '\n  ').slice(0, 1500)}`);
};

const box = sandbox();
try {
  // Mode: the skill must still be in context two turns after entry, which a model can show without reading a file.
  {
    const session = rpc(box, []);
    await session.prompt('/mode tdd');
    await session.prompt('Reply with only the word READY. Do not call any tool.');
    await session.prompt('Reply with only the word STILL. Do not call any tool.');
    const third = await session.prompt(
      'Without calling any tool or reading any file, quote verbatim the first markdown heading line (starting with #) of the skill your current mode follows. If it is not in your context, reply exactly NOT IN CONTEXT.',
    );
    const quote = replies(third).at(-1) ?? '';
    record('mode skill stays in context on the third turn', calls(third).length === 0 && /#\s*TDD|#\s*Test-driven/i.test(quote), `tools: ${calls(third).join(',') || 'none'}; reply: ${quote}`);
    await session.prompt('/mode off');
    const after = await session.prompt('Did a message tell you that the user exited a custom mode? Answer YES or NO and quote it if yes. Do not call any tool.');
    record('exit notice reaches the model once after /mode off', /YES/i.test(replies(after).at(-1) ?? ''), replies(after).at(-1));
    await session.close();
  }
  // Task: Cursor's background launch text and completion notification, and the explore type.
  {
    const session = rpc(box, []);
    const launch = await session.prompt(
      'Use the Task tool once: description "Bg pong", subagent_type generalPurpose, run_in_background true, prompt "Reply with the single word ZING. Do not use tools." Then quote the Task result text verbatim and end your turn.',
    );
    const launchEnd = launch.find((event) => event.type === 'tool_execution_end' && event.toolName === 'Task');
    const launchText = (launchEnd?.result?.content ?? []).map((part) => part.text ?? '').join('');
    record('background launch text', launchText.startsWith("Subagent is running in the background. When you end your turn, you will be automatically sent the subagent's final response upon its completion"), launchText);
    const notice = await session.waitFor((event) => event.type === 'message_end' && event.message?.role === 'custom');
    const text = typeof notice.message.content === 'string' ? notice.message.content : notice.message.content.map((part) => part.text ?? '').join('');
    record(
      'completion notification text',
      text.startsWith('<system_notification>\nThe following task has finished. If you were already aware') &&
        text.includes('title: Reply with the single word ZING. Do not use tools.') &&
        text.includes('Perform any necessary follow-up actions'),
      text,
    );
    await session.waitFor((event) => event.type === 'agent_settled' && session.events.indexOf(event) > session.events.indexOf(notice));
    const explore = await session.prompt(
      'Use the Task tool once with subagent_type explore, run_in_background false, description "Find add", prompt "quick: find where the add function is defined in this repository and report the absolute path." Then reply with the path it reported.',
    );
    const exploreEnd = explore.find((event) => event.type === 'tool_execution_end' && event.toolName === 'Task');
    record('explore subagent runs and reports a path', exploreEnd?.isError === false && /calc\.js/.test(replies(explore).at(-1) ?? ''), replies(explore).at(-1));
    await session.close();
  }
  // Plan mode: CreatePlan writes Cursor's file, and the build prompt follows the run.
  {
    const session = rpc(box, ['No, propose changes']);
    await session.prompt('/plan');
    const planned = await session.prompt('Plan how to make add() in calc.js reject non-number arguments. Do not ask me questions; I accept sensible defaults. Present the plan with CreatePlan and include todos.');
    const end = planned.find((event) => event.type === 'tool_execution_end' && event.toolName === 'CreatePlan');
    const file = end?.result?.details?.planFile ?? '';
    const content = file !== '' && existsSync(file) ? readFileSync(file, 'utf8') : '';
    record("plan mode ends in CreatePlan with Cursor's file shape", /\.plan\.md$/.test(file) && /^<!-- [0-9a-f-]+ -->\n(---\ntodos:\n[\s\S]*?\nisProject: false\n---\n)?\S/.test(content), `${file}\n${content.slice(0, 600)}`);
    const review = await session.waitFor((event) => event.type === 'extension_ui_request' && event.method === 'select', 60_000).catch(() => undefined);
    record('the user is asked whether to build the plan', review?.options?.includes('Yes, build locally') === true, JSON.stringify(review?.options));
    record('no code edit happened in plan mode', readFileSync(join(box.work, 'calc.js'), 'utf8') === 'export function add(a, b) {\n  return a + b;\n}\n', calls(planned).join(','));
    await session.close();
  }
} finally {
  rmSync(box.root, { recursive: true, force: true });
}
const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed on ${model}`);
process.exit(failed.length === 0 ? 0 : 1);
