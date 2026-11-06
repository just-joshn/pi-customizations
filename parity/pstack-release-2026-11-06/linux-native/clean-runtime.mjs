// Wire-protocol adaptation of test/e2e/harness.ts: real Pi, LF-only framing,
// correlated get_commands, scripted prompts, agent_settled, and child transcript checks.
// Imports are stdlib-only; no checkout runtime module participates in the consumer run.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, evidence] = process.argv.slice(2);
const work = join(root, 'work');
const home = join(root, 'home');
const agentDir = join(home, '.pi/agent');
const packageRoot = realpathSync(join(work, 'node_modules/@justjoshn/pi-pstack'));
const pi = join(work, 'node_modules/.bin/pi');
const env = { HOME: home, PATH: `${join(work, 'node_modules/.bin')}:${process.env.PATH}`, LANG: 'C.UTF-8', CI: '1', PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' };
const text = (content) => typeof content === 'string' ? content : content.filter((part) => part.type === 'text').map((part) => part.text).join('');
const script = (steps) => `run the script\n@@script ${JSON.stringify(steps)}`;
const checks = {};
const save = (name, value) => writeFileSync(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);

assert.ok(packageRoot.startsWith(`${root}/`));
const settingsFile = join(agentDir, 'settings.json');
const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
assert.deepEqual(settings.packages.map((source) => realpathSync(join(agentDir, source))), [packageRoot]);
assert.deepEqual(settings.extensions, [join(work, 'test/scripted-model.ts')]);
assert.deepEqual(readdirSync(join(work, 'test')), ['scripted-model.ts']);
save('consumer-settings.json', settings);

const cursorExecutables = execFileSync('/bin/bash', ['-c', 'for name in cursor cursor-agent; do if command -v "$name"; then exit 1; fi; done'], { cwd: work, env, encoding: 'utf8' });
assert.equal(cursorExecutables, '');
const cursorDirectories = execFileSync('find', [home, work, '-type', 'd', '(', '-name', '.cursor', '-o', '-name', '.cursor-plugin', '-o', '-name', '.cursor-server', '-o', '-name', '.cursor-server-insiders', ')', '-print'], { env, encoding: 'utf8' });
assert.equal(cursorDirectories, '');
checks.isolation = { status: 'PASS', home, cwd: work, packageRoot, executable: realpathSync(pi), environmentKeys: Object.keys(env), cursorExecutables: [], cursorPluginDirectories: [], copiedTestFixtures: ['scripted-model.ts'] };

function startRpc() {
  const args = ['--mode', 'rpc', '--offline', '--no-session', '--no-mcp', '--no-approve', '--model', 'scripted/echo'];
  const child = spawn(pi, args, { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  const waiters = new Set();
  const closed = once(child, 'close');
  let buffer = '';
  writeFileSync(join(evidence, 'consumer-rpc.stdout.jsonl'), '');
  writeFileSync(join(evidence, 'consumer-rpc.stderr.log'), '');
  writeFileSync(join(evidence, 'consumer-rpc.stdin.jsonl'), '');
  child.stdout.on('data', (chunk) => {
    appendFileSync(join(evidence, 'consumer-rpc.stdout.jsonl'), chunk);
    buffer += chunk.toString('utf8');
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line.trim() === '') continue;
      const event = JSON.parse(line);
      events.push(event);
      for (const waiter of waiters) if (waiter.predicate(event)) waiter.resolve(event);
    }
  });
  child.stderr.on('data', (chunk) => appendFileSync(join(evidence, 'consumer-rpc.stderr.log'), chunk));
  function waitFor(predicate) {
    const seen = events.find(predicate);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error('RPC event deadline exceeded')); }, 60_000);
      const waiter = { predicate, resolve: (event) => { clearTimeout(timer); waiters.delete(waiter); resolve(event); } };
      waiters.add(waiter);
    });
  }
  function send(command) {
    const line = `${JSON.stringify(command)}\n`;
    appendFileSync(join(evidence, 'consumer-rpc.stdin.jsonl'), line);
    child.stdin.write(line);
  }
  async function prompt(message) {
    const mark = events.length;
    const id = `prompt-${mark}`;
    send({ id, type: 'prompt', message });
    const response = await waitFor((event) => event.type === 'response' && event.id === id);
    assert.equal(response.success, true);
    if (response.data?.disposition !== 'handled') await waitFor((event) => event.type === 'agent_settled' && events.indexOf(event) >= mark);
    return events.slice(mark);
  }
  async function close() {
    child.stdin.end();
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
    const [code, signal] = await closed;
    clearTimeout(deadline);
    assert.deepEqual([code, signal], [0, null]);
  }
  console.log(`RPC: ${pi} ${args.join(' ')}`);
  return { events, send, waitFor, prompt, close };
}

const rpc = startRpc();
try {
  rpc.send({ id: 'commands', type: 'get_commands' });
  const discovery = await rpc.waitFor((event) => event.id === 'commands');
  assert.equal(discovery.success, true);
  const commands = discovery.data.commands;
  for (const name of ['mode', 'plan', 'loop', 'skill:poteto-mode', 'skill:how', 'skill:create-skill', 'skill:deslop']) {
    const command = commands.find((entry) => entry.name === name);
    assert.ok(command, `missing installed command ${name}`);
    assert.ok(command.sourceInfo.path.startsWith(`${packageRoot}/`), `${name} must resolve inside tarball installation`);
  }
  assert.equal(commands.filter((command) => command.name.startsWith('skill:')).length, 78);
  save('consumer-discovery.json', commands);
  const toolsRun = await rpc.prompt('discover installed tools\n@@tools-list');
  const tools = text(toolsRun.find((event) => event.type === 'message_end' && event.message?.role === 'assistant').message.content).split(',');
  for (const name of ['Task', 'TodoWrite', 'AskQuestion', 'Loop', 'visualize']) assert.ok(tools.includes(name), `missing installed tool ${name}`);
  checks.discovery = { status: 'PASS', skillCommands: 78, tools, resourceRoot: packageRoot };

  const skill = join(packageRoot, 'skills/poteto-mode/SKILL.md');
  const rule = join(packageRoot, 'rules/no-inline-imports.mdc');
  const childSteps = [
    { tool: 'read', args: { path: skill } },
    { tool: 'read', args: { path: rule } },
    { tool: 'bash', args: { command: 'printf "PACKAGED_CHILD_EXECUTED\\n"; pwd; node -p "JSON.stringify({platform:process.platform,arch:process.arch,node:process.version})"' } },
  ];
  const taskRun = await rpc.prompt(script([{ tool: 'Task', args: { description: 'packaged native Linux child', subagent_type: 'poteto-agent', model: 'inherit', run_in_background: false, prompt: script(childSteps) } }]));
  const task = taskRun.find((event) => event.type === 'tool_execution_end' && event.toolName === 'Task');
  assert.ok(task, 'Task execution result must exist');
  assert.equal(task.isError, false);
  assert.equal(task.result.details.subagentType, 'poteto-agent');
  assert.match(text(task.result.content), /PACKAGED_CHILD_EXECUTED/);
  assert.match(text(task.result.content), /Always place imports at the top/);
  assert.match(text(task.result.content), /poteto-mode/);
  const id = task.result.details.agentId;
  const slug = `--${work.replace(/^\//, '').replace(/[/\\:]/g, '-')}--`;
  const subagents = join(agentDir, 'pstack/workspaces', slug, 'subagents');
  const transcriptName = readdirSync(subagents).find((name) => name.endsWith(`_${id}.jsonl`));
  assert.ok(transcriptName, 'a real child transcript must be persisted');
  const transcript = readFileSync(join(subagents, transcriptName), 'utf8');
  writeFileSync(join(evidence, 'consumer-child.jsonl'), transcript);
  const entries = transcript.trim().split('\n').map((line) => JSON.parse(line));
  const assistants = entries.filter((entry) => entry.type === 'message' && entry.message.role === 'assistant');
  assert.ok(assistants.length >= 4);
  for (const entry of assistants) assert.deepEqual([entry.message.provider, entry.message.model, entry.message.stopReason === 'error'], ['scripted', 'echo', false]);
  const childCalls = assistants.flatMap((entry) => entry.message.content.filter((part) => part.type === 'toolCall'));
  assert.deepEqual(childCalls.filter((call) => call.name === 'read').map((call) => call.arguments.path), [skill, rule]);
  const childResults = entries.filter((entry) => entry.type === 'message' && entry.message.role === 'toolResult');
  assert.deepEqual(childResults.map((entry) => [entry.message.toolName, entry.message.isError]), [['read', false], ['read', false], ['bash', false]]);
  const record = JSON.parse(readFileSync(join(subagents, `${id}.json`), 'utf8'));
  save('consumer-child-record.json', record);
  assert.equal(record.cwd, work);
  checks.task = { status: 'PASS', agentId: id, childType: 'poteto-agent', persistedTranscript: transcriptName, observedChildTools: childResults.map((entry) => entry.message.toolName), packagedResourcesRead: [skill, rule], marker: 'PACKAGED_CHILD_EXECUTED', models: ['scripted/echo'], details: task.result.details };
  assert.deepEqual(rpc.events.filter((event) => event.type === 'extension_error'), []);
  for (const event of rpc.events.filter((entry) => entry.type === 'message_end' && entry.message?.role === 'assistant')) assert.equal(event.message.provider, 'scripted');
} finally {
  await rpc.close();
}

const jsonArgs = ['--mode', 'json', '--offline', '--no-session', '--no-mcp', '--no-approve', '--model', 'scripted/echo', 'scripted JSON check\n@@say CLEAN_JSON_OK'];
console.log(`JSON: ${pi} ${jsonArgs.join(' ')}`);
const json = execFileSync(pi, jsonArgs, { cwd: work, env, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
writeFileSync(join(evidence, 'consumer-json.stdout.jsonl'), json);
const jsonEvents = json.trim().split('\n').map((line) => JSON.parse(line));
assert.ok(jsonEvents.some((event) => event.type === 'message_end' && event.message?.role === 'assistant' && event.message.provider === 'scripted' && text(event.message.content) === 'CLEAN_JSON_OK'));
checks.json = { status: 'PASS', marker: 'CLEAN_JSON_OK' };
const auth = join(agentDir, 'auth.json');
assert.deepEqual(existsSync(auth) ? Object.keys(JSON.parse(readFileSync(auth, 'utf8'))) : [], []);
checks.credentials = { status: 'PASS', providerEnvironmentKeys: [], storedProviderKeys: [] };
save('consumer-checks.json', { status: 'PASS', checks });
console.log(JSON.stringify({ status: 'PASS', checks }, null, 2));
