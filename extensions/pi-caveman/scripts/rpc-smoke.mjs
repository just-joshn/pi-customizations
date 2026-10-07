#!/usr/bin/env node
// Live end-to-end check of pi-caveman through Pi's RPC mode with a real model.
// Usage: node scripts/rpc-smoke.mjs [--model provider/id]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const modelIndex = process.argv.indexOf('--model');
const model = modelIndex === -1 ? null : process.argv[modelIndex + 1];
const work = mkdtempSync(join(tmpdir(), 'caveman-smoke-'));
const sessionDir = join(work, 'sessions');
mkdirSync(join(work, '.pi'), { recursive: true });
writeFileSync(join(work, '.pi', 'settings.json'), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
const env = { ...process.env, XDG_CONFIG_HOME: join(work, 'xdg'), XDG_DATA_HOME: join(work, 'data') };
delete env.CAVEMAN_DEFAULT_MODE;

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${label}${ok || !detail ? '' : `\n     ${detail}`}\n`);
};
const ESCAPE = String.fromCharCode(27);
const plain = (text) => (typeof text === 'string' ? text.replaceAll(new RegExp(`${ESCAPE}\\[[0-9;]*m`, 'g'), '') : text);

function eventPump(stream) {
  const events = [];
  const waiters = [];
  createInterface({ input: stream }).on('line', (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    events.push(event);
    for (const waiter of waiters.filter((w) => w.match(event))) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(event);
    }
  });
  const waitFor = (match, ms = 180_000) =>
    new Promise((resolvePromise, reject) => {
      const found = events.find(match);
      if (found) return resolvePromise(found);
      const timer = setTimeout(() => reject(new Error('timed out waiting for event')), ms);
      waiters.push({
        match,
        resolve: (event) => {
          clearTimeout(timer);
          resolvePromise(event);
        },
      });
    });
  return { events, waitFor };
}

function startPi(extraArgs) {
  const args = ['--mode', 'rpc', '--approve', '--session-dir', sessionDir, '-e', packageDir, ...(model ? ['--model', model] : []), ...extraArgs];
  const child = spawn('pi', args, { cwd: work, env, stdio: ['pipe', 'pipe', 'inherit'] });
  const { events, waitFor } = eventPump(child.stdout);
  let nextId = 0;
  const request = async (command) => {
    const id = `r${nextId++}`;
    const mark = events.length;
    child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    const response = await waitFor((event) => event.type === 'response' && event.id === id);
    return { response, since: () => events.slice(mark) };
  };
  const prompt = async (message) => {
    const { response, since } = await request({ type: 'prompt', message });
    if (response.data?.disposition !== 'handled') await waitFor((event) => event.type === 'agent_settled' && since().includes(event));
    await new Promise((r) => setTimeout(r, 200));
    return since();
  };
  const lastStatus = () => plain(events.filter((e) => e.type === 'extension_ui_request' && e.method === 'setStatus' && e.statusKey === 'caveman').at(-1)?.statusText);
  const notices = (list) => list.filter((e) => e.type === 'extension_ui_request' && e.method === 'notify').map((e) => e.message);
  const stop = () =>
    new Promise((r) => {
      child.on('exit', r);
      child.stdin.end();
      setTimeout(() => child.kill('SIGTERM'), 5000);
    });
  return { request, prompt, lastStatus, notices, stop, waitFor };
}

function sessionFile() {
  const files = readdirSync(sessionDir, { recursive: true }).filter((name) => String(name).endsWith('.jsonl'));
  return join(sessionDir, String(files[0]));
}

const upstream = JSON.parse(readFileSync(join(packageDir, 'UPSTREAM.json'), 'utf8'));

try {
  const pi = startPi([]);
  await pi.waitFor((e) => e.type === 'extension_ui_request' && e.method === 'setStatus' && e.statusKey === 'caveman');
  check(pi.lastStatus() === '[CAVEMAN]', 'fresh session starts in caveman with [CAVEMAN] badge', pi.lastStatus());

  const { response: commands } = await pi.request({ type: 'get_commands' });
  const names = new Set(commands.data.commands.map((c) => c.name));
  const missingSkills = upstream.skills.filter((skill) => !names.has(`skill:${skill}`));
  check(missingSkills.length === 0, `all ${upstream.skills.length} upstream skills discovered`, `missing: ${missingSkills.join(', ')}`);
  const wanted = ['caveman', 'ultracave', 'megacave', 'caveman-help', 'caveman-stats', 'caveman-commit', 'caveman-review', 'caveman-compress', 'caveman-init'];
  check(
    wanted.every((name) => names.has(name)),
    'slash commands and prompt templates registered',
    wanted.filter((n) => !names.has(n)).join(', '),
  );

  check(pi.notices(await pi.prompt('/caveman status')).includes('Caveman mode: caveman'), '/caveman status reports the mode');

  const firstTurn = await pi.prompt('Why does React re-render when I pass an inline object prop? Two sentences max.');
  const raw = readFileSync(sessionFile(), 'utf8');
  check(raw.includes('CAVEMAN MODE ACTIVE — mode: caveman'), 'ruleset injected as a system prompt section');
  check(raw.includes('"customType":"caveman-context"'), 'per-turn reinforcement stored as a hidden custom message');
  const reply = firstTurn.filter((e) => e.type === 'message_end' && e.message?.role === 'assistant').at(-1);
  process.stdout.write(`     reply: ${JSON.stringify(reply?.message?.content?.find((p) => p.type === 'text')?.text ?? '').slice(0, 300)}\n`);

  await pi.prompt('/ultracave');
  check(pi.lastStatus() === '[ULTRACAVE]', '/ultracave switches the badge', pi.lastStatus());
  await pi.prompt('Name one sorting algorithm.');
  check(readFileSync(sessionFile(), 'utf8').includes('CAVEMAN MODE ACTIVE — mode: ultracave'), 'switched ruleset reaches the model');

  const review = await pi.prompt('/caveman-review this snippet: const x = a.b.c;');
  check(
    review.some((e) => e.type === 'extension_ui_request' && e.statusKey === 'caveman' && plain(e.statusText) === '[CAVEMAN:REVIEW]'),
    'one-shot review shows [CAVEMAN:REVIEW]',
  );
  check(readFileSync(sessionFile(), 'utf8').includes('<skill name=\\"caveman-review\\"'), '/caveman-review expands the caveman-review skill');
  await pi.prompt('Thanks.');
  check(pi.lastStatus() === '[ULTRACAVE]', 'next prompt restores the displaced mode', pi.lastStatus());

  const stats = await pi.prompt('/caveman-stats');
  const statsMessage = stats.find((e) => e.type === 'message_end' && e.message?.customType === 'caveman-stats');
  const statsText = String(statsMessage?.message?.content ?? '');
  check(/Turns: {4}\d+/.test(statsText) && statsText.includes('Mode changed mid-session'), '/caveman-stats reports turns and per-mode attribution', statsText);
  process.stdout.write(`${statsText.replace(/^/gm, '     ')}\n`);

  const notes = join(work, 'notes.md');
  writeFileSync(
    notes,
    '# Project notes\n\nYou should always make sure to run the test suite before pushing any changes to the main branch. This is important because it helps catch bugs early and prevents broken builds from being deployed to production.\n\nThe application uses a microservices architecture. The API gateway handles all incoming requests and routes them to the appropriate service, and the configuration lives in `config/gateway.yaml`.\n',
  );
  const before = readFileSync(notes, 'utf8').length;
  const compress = await pi.prompt('/caveman-compress notes.md');
  const compressCall = compress.find((e) => e.type === 'tool_execution_end' && e.toolName === 'caveman_compress');
  const backup = join(work, 'data', 'caveman-compress', 'backups', basename(work), 'notes.original.md');
  check(compressCall !== undefined && !compressCall.isError, '/caveman-compress runs the caveman_compress tool', JSON.stringify(compressCall?.result?.content ?? null));
  check(readFileSync(notes, 'utf8').length < before && existsSync(backup), 'file shrank with an out-of-tree backup', `${readFileSync(notes, 'utf8').length} vs ${before}`);

  const crew = await pi.prompt(`Call the cavecrew tool once with agent "investigator" and task "In ${packageDir}/src, where is parseModeChange defined?". Then relay its answer.`);
  const crewCall = crew.find((e) => e.type === 'tool_execution_end' && e.toolName === 'cavecrew');
  const crewText = crewCall?.result?.content?.[0]?.text ?? '';
  check(crewCall !== undefined && !crewCall.isError && crewText.includes('parse.ts'), 'cavecrew investigator returns a path:line answer', crewText);
  process.stdout.write(`     cavecrew: ${JSON.stringify(crewText).slice(0, 300)}\n`);

  await pi.prompt('/megacave');
  check(pi.lastStatus() === '[MEGACAVE]', '/megacave switches the badge', pi.lastStatus());
  await pi.prompt('/ultracave');

  const { response: compacted } = await pi.request({ type: 'compact' });
  check(compacted.success === true, 'manual compaction succeeds', JSON.stringify(compacted));
  await pi.prompt('Name one data structure.');
  const afterCompaction = readFileSync(sessionFile(), 'utf8').split('"type":"compaction"').at(-1) ?? '';
  check(pi.lastStatus() === '[ULTRACAVE]' && afterCompaction.includes('"customType":"caveman-context"'), 'mode and reminder survive compaction', pi.lastStatus());

  await pi.prompt('stop caveman');
  check(pi.lastStatus() === undefined, 'natural-language "stop caveman" clears the badge', pi.lastStatus());

  await pi.stop();

  const resumed = startPi(['--continue']);
  await resumed.waitFor((e) => e.type === 'extension_ui_request' && e.method === 'setStatus' && e.statusKey === 'caveman');
  check(resumed.lastStatus() === undefined, 'explicit off survives a restart with --continue', resumed.lastStatus());
  await resumed.prompt('talk like caveman');
  check(resumed.lastStatus() === '[CAVEMAN]', 'natural-language "talk like caveman" re-activates', resumed.lastStatus());
  const { response: forks } = await resumed.request({ type: 'get_fork_messages' });
  const firstQuestion = forks.data.messages.find((m) => m.text.startsWith('Why does React'));
  await resumed.request({ type: 'fork', entryId: firstQuestion.entryId });
  await new Promise((r) => setTimeout(r, 300));
  check(resumed.lastStatus() === '[CAVEMAN]', 'a fork restores the mode stored on its branch', resumed.lastStatus());
  await resumed.stop();
} catch (error) {
  failures++;
  process.stdout.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.stdout.write(failures === 0 ? 'rpc smoke: all checks passed\n' : `rpc smoke: ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
