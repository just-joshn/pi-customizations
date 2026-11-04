#!/usr/bin/env node
// Live Pi scenarios for this run's fixes, on a real model, in a throwaway agent directory that loads this checkout's
// pi-pstack and the Claude subscription provider. auth.json is symlinked from the user's agent directory, as
// extensions/pi-pstack/scripts/live-e2e.mjs does. Usage: node live-pi.mjs <scenario> [model]
// Writes evidence to .audit/pstack-native-parity-2026-11-04/pi/<scenario>.json.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = join(repo, 'extensions/pi-pstack');
const cli = join(pkg, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const out = join(repo, '.audit/pstack-native-parity-2026-11-04/pi');
const [scenario, model = 'claude-subscription/claude-sonnet-4-5'] = process.argv.slice(2);

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-live-')));
  const agentDir = join(root, 'agent');
  const work = join(root, 'work');
  for (const dir of [agentDir, work, join(root, 'home')]) mkdirSync(dir);
  symlinkSync(join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi/agent'), 'auth.json'), join(agentDir, 'auth.json'));
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: [pkg, join(repo, 'extensions/pi-anthropic-oauth')], quietStartup: true }));
  const git = (...args) => execFileSync('git', ['-C', work, ...args], { stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(work, 'README.md'), '# live\n');
  git('add', '-A');
  git('-c', 'user.email=live@example.com', '-c', 'user.name=live', 'commit', '-qm', 'LIVE-MARK first commit');
  const env = { ...process.env, HOME: join(root, 'home'), PI_CODING_AGENT_DIR: agentDir };
  for (const name of ['PI_CODING_AGENT_SESSION_DIR', 'PI_PSTACK_DEPTH', 'PI_PSTACK_AGENT', 'PI_PSTACK_PARENT_PID']) delete env[name];
  return { root, work, env };
}

function lines(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line !== '') onLine(JSON.parse(line));
    }
  };
}

function runJson(box, prompt, timeoutMs) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [cli, '--mode', 'json', '--no-session', '--model', model, prompt], { cwd: box.work, env: box.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const events = [];
    child.stdout.on(
      'data',
      lines((event) => events.push(event)),
    );
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ events, code });
    });
  });
}

function startRpc(box) {
  const child = spawn(process.execPath, [cli, '--mode', 'rpc', '--no-session', '--model', model], { cwd: box.work, env: box.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  const waiters = [];
  child.stdout.on(
    'data',
    lines((event) => {
      events.push({ at: Date.now(), ...event });
      for (const waiter of [...waiters]) {
        if (!waiter.test(event)) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.done(event);
      }
    }),
  );
  const waitFor = (test, ms) =>
    new Promise((done, fail) => {
      const seen = events.find(test);
      if (seen) return done(seen);
      const timer = setTimeout(() => fail(new Error('timed out')), ms);
      waiters.push({
        test,
        done: (event) => {
          clearTimeout(timer);
          done(event);
        },
      });
    });
  const close = () => {
    child.stdin.end();
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  };
  return { events, waitFor, send: (command) => child.stdin.write(`${JSON.stringify(command)}\n`), close };
}

const assistantMessages = (events) => events.filter((event) => event.type === 'message_end' && event.message?.role === 'assistant').map((event) => event.message);
const toolCalls = (events) => assistantMessages(events).flatMap((message) => message.content.filter((part) => part.type === 'toolCall').map((part) => ({ name: part.name, arguments: part.arguments })));
const texts = (events) =>
  assistantMessages(events).map((message) =>
    message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  );
const customs = (events, type) =>
  [
    ...events.filter((event) => event.type === 'message_end' && event.message?.role === 'custom' && event.message?.customType === type).map((event) => event.message.content),
    ...events.filter((event) => event.type === 'entry_appended' && event.entry?.type === 'custom_message' && event.entry?.customType === type).map((event) => event.entry.content),
  ].map((content) => (typeof content === 'string' ? content : JSON.stringify(content)));
const toolResults = (events, name) => events.filter((event) => event.type === 'tool_execution_end' && event.toolName === name).map((event) => ({ isError: event.isError, text: event.result.content.map((part) => part.text ?? '').join('') }));

const SCENARIOS = {
  // pstack worktree-cleanup step 1: "The transcript scan is slow, so background it."
  'background-it': async (box) => {
    const prompt = 'Run the command `sleep 8; echo SCAN-DONE-7731` as a slow scan. The scan is slow, so background it, and do not wait for it in the foreground. When it finishes, tell me the line it printed.';
    const run = await runJson(box, prompt, 5 * 60_000);
    return { exit: run.code, toolCalls: toolCalls(run.events), shellNotices: customs(run.events, 'pstack/shell'), texts: texts(run.events) };
  },
  // Cursor's Shell moves a long command to the background after 30 s; Pi's bash does not, so the host line routes long work to bash_background.
  'long-poller': async (box) => {
    writeFileSync(join(box.work, 'watch.sh'), '#!/usr/bin/env bash\n# Polls a fake CI until it reaches a verdict.\nfor i in $(seq 1 8); do echo "poll $i: pending"; sleep 5; done\necho "VERDICT: READY-9187"\n', { mode: 0o755 });
    const prompt = 'Babysit the fake CI: run ./watch.sh, which polls until a terminal verdict (it takes about 40 seconds), and tell me the verdict when it arrives. Watcher output drives wakeups; do not add a second sleep loop.';
    const run = await runJson(box, prompt, 5 * 60_000);
    return { exit: run.code, toolCalls: toolCalls(run.events), shellNotices: customs(run.events, 'pstack/shell'), texts: texts(run.events) };
  },
  // A readonly subagent, as how and why spawn them, must be able to run read-only shell commands.
  'readonly-git-log': async (box) => {
    const prompt =
      'Spawn exactly one Task subagent with subagent_type generalPurpose, readonly: true, run_in_background: false, and this prompt: "Run git log --oneline -1 with the bash tool and reply with its output only." Then tell me exactly what it replied.';
    const run = await runJson(box, prompt, 5 * 60_000);
    return { exit: run.code, toolCalls: toolCalls(run.events), taskResults: toolResults(run.events, 'Task'), texts: texts(run.events) };
  },
  // Cursor's loop skill: run the prompt once when the loop is armed, then on each wake.
  'loop-arm': async (box) => {
    const rpc = startRpc(box);
    try {
      rpc.send({
        type: 'prompt',
        message: 'Arm /loop, agent-paced, with wake_in 20s, whose prompt is: "Append the output of `date +%s` to ticks.txt with bash. On the second run, stop the loop." Follow the host instructions for arming a loop.',
      });
      await rpc.waitFor((event) => event.type === 'tool_execution_end' && event.toolName === 'Loop' && /stopped/i.test(JSON.stringify(event.result)), 4 * 60_000).catch(() => undefined);
      await new Promise((done) => setTimeout(done, 5000));
      const ticks = execFileSync('bash', ['-c', `cat ${join(box.work, 'ticks.txt')} 2>/dev/null | wc -l`], { encoding: 'utf8' }).trim();
      return { toolCalls: toolCalls(rpc.events), loopResults: toolResults(rpc.events, 'Loop'), ticks, texts: texts(rpc.events) };
    } finally {
      rpc.close();
    }
  },
  // Babysit's "watcher output drives wakeups" and the loop skill's event-gated dynamic mode.
  'event-watcher': async (box) => {
    const rpc = startRpc(box);
    try {
      rpc.send({
        type: 'prompt',
        message:
          'Wait until the file ready.flag exists in this directory, then tell me its content. Use /loop in dynamic mode: arm one event watcher that wakes you when the file appears, plus a long fallback heartbeat. Do not poll in a foreground loop and do not sleep in the foreground. End your turn after arming.',
      });
      await rpc.waitFor((event) => event.type === 'agent_settled' || event.type === 'agent_end', 3 * 60_000);
      const armedAt = Date.now();
      await new Promise((done) => setTimeout(done, 8000));
      writeFileSync(join(box.work, 'ready.flag'), 'FLAG-CONTENT-4242\n');
      await rpc.waitFor((event) => event.type === 'message_end' && event.message?.role === 'assistant' && JSON.stringify(event.message).includes('FLAG-CONTENT-4242'), 3 * 60_000).catch(() => undefined);
      return {
        toolCalls: toolCalls(rpc.events),
        shellNotices: customs(rpc.events, 'pstack/shell'),
        reportedAfterFlagMs: (rpc.events.find((event) => event.type === 'message_end' && JSON.stringify(event.message ?? {}).includes('FLAG-CONTENT-4242') && event.message?.role === 'assistant')?.at ?? 0) - armedAt,
        texts: texts(rpc.events),
      };
    } finally {
      rpc.close();
    }
  },
};

mkdirSync(out, { recursive: true });
const box = sandbox();
try {
  const result = await SCENARIOS[scenario](box);
  writeFileSync(join(out, `${scenario}.json`), `${JSON.stringify({ scenario, model, ...result }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ scenario, model, ...result }, null, 2).slice(0, 6000)}\n`);
} finally {
  rmSync(box.root, { recursive: true, force: true });
}
