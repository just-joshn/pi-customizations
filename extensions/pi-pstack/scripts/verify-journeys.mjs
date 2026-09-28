import { spawn, spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rpcProcess } from './rpc-process.mjs';

const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));
const only = process.argv[3];
const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');

const findings = [];
const passes = [];
function check(name, condition, detail = '') {
  if (condition) passes.push(name);
  else findings.push(`${name}${detail ? `\n      ${detail}` : ''}`);
}
function checkEqual(name, actual, expected) {
  check(name, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

async function subdirectories(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
}

function frontmatterBody(text) {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (match ? text.slice(match[0].length) : text).trim();
}

function requestText(request) {
  return request.messages.map(message => {
    const blocks = typeof message.content === 'string' ? [message.content] : (message.content ?? []).map(block => block.text ?? '');
    return [...blocks, ...Object.values(message.sections ?? {})].join('\n');
  }).join('\n');
}

function systemText(request) {
  const sections = new Map();
  for (const message of request.messages) {
    if (message.role !== 'system') continue;
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, value);
    }
  }
  return [...sections].map(([name, value]) => `${name}=\n${value}`).join('\n\n');
}

function uiBridge(child, answers) {
  const requests = [];
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (line.trim()) respond(requests, answers, child, line);
    }
  });
  return requests;
}

function respond(requests, answers, child, line) {
  let record;
  try { record = JSON.parse(line); } catch { return; }
  if (record?.type !== 'extension_ui_request') return;
  requests.push(record);
  if (['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text'].includes(record.method)) return;
  const supplied = answers[record.method];
  const value = typeof supplied === 'function' ? supplied(record) : supplied ?? record.options?.[0];
  const response = record.method === 'confirm'
    ? { type: 'extension_ui_response', id: record.id, confirmed: true }
    : { type: 'extension_ui_response', id: record.id, value };
  child.stdin.write(`${JSON.stringify(response)}\n`);
}

function clientFor(child, log) {
  const client = rpcProcess(child, { requestDeadlineMs: 180000, shutdownDeadlineMs: 15000 });
  let cursor = 0;
  const requests = async () => (await readFile(join(log, `requests-${child.pid}.jsonl`), 'utf8').catch(() => ''))
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  const idle = async () => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const state = await client.send({ type: 'get_state' });
      if (!state.isStreaming && state.pendingMessageCount === 0) return;
      await new Promise(done => setTimeout(done, 40));
    }
    throw new Error('Pi did not return to idle');
  };
  return {
    send: (message) => client.send(message),
    requests,
    finish: () => client.finish(),
    close: () => client.close(),
    async run(message) {
      cursor = (await requests()).length;
      await client.send({ type: 'prompt', message });
      await idle();
      const recorded = await requests();
      const produced = recorded.slice(cursor);
      cursor = recorded.length;
      return produced;
    },
    async turn(message) {
      const recorded = await this.run(message);
      const last = recorded.at(-1);
      if (!last) throw new Error(`No model request was produced for ${message}`);
      return last;
    },
    async messages() {
      return (await client.send({ type: 'get_messages' })).messages;
    },
    async callTool(message) {
      await client.send({ type: 'new_session' });
      const before = (await this.messages()).length;
      await this.run(message);
      return (await this.messages()).slice(before);
    },
  };
}

async function startPi(directory, log, extraArgs) {
  const child = spawn(process.execPath, [cli, '--mode', 'rpc', ...extraArgs, '-e', root], {
    cwd: directory,
    env: { ...process.env, PI_CODING_AGENT_DIR: directory, PSTACK_JOURNEY_LOG: log },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  return {
    ui: uiBridge(child, { input: 'journey-test/recorder' }),
    stderr: () => stderr,
    ...clientFor(child, log),
  };
}

async function journeyLoad(ctx) {
  const commands = await ctx.send({ type: 'get_commands' });
  const allSkills = [...await subdirectories(join(ctx.root, 'skills')), ...await subdirectories(join(ctx.root, 'host', 'skills'))].sort();
  const promptNames = [...(await readdir(join(ctx.root, 'prompts'))).filter(n => n.endsWith('.md')).map(n => n.slice(0, -3)), 'loop'];
  ctx.skills = allSkills;
  checkEqual('load: skill count discovered', commands.commands.filter(c => c.source === 'skill').length, allSkills.length);
  checkEqual('load: every skill directory is a discovered skill command', allSkills.filter(name =>
    commands.commands.some(c => c.name === `skill:${name}` && c.source === 'skill')).length, allSkills.length);
  checkEqual('load: every prompt template is discovered', promptNames.filter(name =>
    commands.commands.some(c => c.name === name && c.source === 'prompt')).length, promptNames.length);
  for (const name of ['poteto-mode', 'setup-pstack', 'pstack']) {
    check(`load: ${name} is an extension command`, commands.commands.some(c => c.name === name && c.source === 'extension'));
  }
  check('load: the extension reported no load error', !/Failed to load extension|Extension error/.test(ctx.stderr()), ctx.stderr().slice(0, 400));
}

async function journeyNativeSkills(ctx) {
  for (const name of ctx.skills) {
    if (name === 'setup-pstack') continue;
    const file = name === 'loop' ? join(ctx.root, 'host', 'skills', 'loop', 'SKILL.md') : join(ctx.root, 'skills', name, 'SKILL.md');
    const text = requestText(await ctx.turn(`/skill:${name} journey arguments`));
    const body = frontmatterBody(await readFile(file, 'utf8'));
    check(`native: /skill:${name} delivers the complete skill body`, text.includes(body), `body ${body.length} chars not fully present`);
    check(`native: /skill:${name} delivers user arguments`, text.includes('journey arguments'));
    check(`native: /skill:${name} names the skill in the skill block`, text.includes(`skill name="${name}"`));
  }
}

async function journeyTemplates(ctx) {
  const files = [...(await readdir(join(ctx.root, 'prompts'))).filter(n => n.endsWith('.md')).map(n => join(ctx.root, 'prompts', n)),
    join(ctx.root, 'host', 'prompts', 'loop.md')];
  for (const file of files) {
    const name = file.endsWith('loop.md') ? 'loop' : file.split('/').at(-1).slice(0, -3);
    const text = requestText(await ctx.turn(`/${name} journey arguments`));
    const expected = frontmatterBody(await readFile(file, 'utf8')).replaceAll('$ARGUMENTS', 'journey arguments');
    check(`template: /${name} delivers its template body`, text.includes(expected), `expected ${expected.length} chars`);
    check(`template: /${name} keeps no unexpanded $ARGUMENTS`, !text.includes('$ARGUMENTS'));
  }
}

async function journeyArguments(ctx) {
  const quoted = requestText(await ctx.turn('/how a "b c" d'));
  check('template: a quoted argument reaches the model with its quote characters removed', quoted.includes('a b c d'), quoted.slice(-120));
  const apostrophe = requestText(await ctx.turn("/how it's fine"));
  check('template: an apostrophe loses its quote character', apostrophe.includes('its fine'), apostrophe.slice(-120));
  const unpaired = requestText(await ctx.turn("/how before it's \"after\""));
  check('template: an unpaired quote swallows the rest of the line', unpaired.includes('before its "after"'), unpaired.slice(-120));
  const native = requestText(await ctx.turn('/skill:how a "b c"'));
  check('native: /skill: keeps argument text exactly as typed', native.includes('a "b c"'), native.slice(-120));
}

async function journeyHostContract(ctx) {
  const systemPrompt = systemText(await ctx.turn('journey probe'));
  for (const [label, needle] of [
    ['bundled skills directory', join(ctx.root, 'skills')],
    ['host loop skill', join(ctx.root, 'host', 'skills', 'loop', 'SKILL.md')],
    ['immutable upstream snapshot', join(ctx.root, 'upstream')],
    ['team-kit snapshot', join(ctx.root, 'upstream-team-kit')],
    ['session directory', ctx.directory],
  ]) {
    check(`host contract: names the ${label}`, systemPrompt.includes(needle), `missing ${needle}`);
  }
  for (const mapped of ['Read is the read tool', 'Shell is bash', 'Grep is grep', 'Glob is find']) {
    check(`host contract: maps Cursor's ${mapped}`, systemPrompt.includes(mapped));
  }
}

async function journeyMode(ctx) {
  await ctx.send({ type: 'new_session' });
  await ctx.run('/poteto-mode journey');
  const modeOn = systemText(await ctx.turn('journey probe'));
  const body = frontmatterBody(await readFile(join(ctx.root, 'skills', 'poteto-mode', 'SKILL.md'), 'utf8'));
  check('mode: /poteto-mode injects the complete mode instructions', modeOn.includes(body));
  check('mode: injected mode names its own reference directory', modeOn.includes(join(ctx.root, 'skills', 'poteto-mode')));
  await ctx.run('/poteto-mode OFF');
  const modeOff = systemText(await ctx.turn('journey probe'));
  check('mode: /poteto-mode off removes the mode instructions', !modeOff.includes('## Non-negotiables'));
  const tool = await ctx.callTool('JOURNEY:modeon');
  check('mode: the pstack_mode tool turns the mode on', JSON.stringify(tool.find(m => m.toolName === 'pstack_mode')).includes('Poteto mode is on'));
  const toolMode = systemText(await ctx.turn('journey probe'));
  check('mode: a tool-activated mode reaches the next prompt', toolMode.includes('## Non-negotiables'));
}

async function journeyStatus(ctx) {
  const before = (await ctx.messages()).length;
  await ctx.run('/pstack');
  await ctx.run('/pstack status');
  await ctx.run('/pstack tones');
  const statuses = (await ctx.messages()).slice(before).filter(message => message.customType === 'pstack-status');
  checkEqual('status: each accepted form publishes one status message', statuses.length, 2);
  check('status: reports the discovered skill and template counts', /65 skills, 64 prompt templates/.test(String(statuses[0]?.content)), String(statuses[0]?.content).slice(0, 200));
  const notifications = ctx.ui.filter(request => request.method === 'notify').map(request => request.message ?? '');
  check('status: an unknown argument notifies the accepted forms', notifications.some(text => text.includes('Use /pstack, /pstack status, or /pstack todos.')), notifications.slice(-4).join(' | '));
}

async function journeyTodos(ctx) {
  const todos = await ctx.callTool('JOURNEY:todowrite');
  check('tool: TodoWrite replaces the list and reports progress', JSON.stringify(todos.find(m => m.toolName === 'TodoWrite')).includes('Run the journey'));
  await ctx.run('/pstack todos');
  const status = (await ctx.messages()).filter(m => m.customType === 'pstack-status').at(-1);
  check('tool: /pstack todos renders the saved list', String(status?.content).includes('[>] Run the journey (in_progress)'), String(status?.content).slice(0, 300));
  await ctx.send({ type: 'new_session' });
  await ctx.run('/pstack todos');
  const fresh = (await ctx.messages()).filter(m => m.customType === 'pstack-status').at(-1);
  check('state: a new session starts with an empty todo list', String(fresh?.content).includes('Todos: none.'), String(fresh?.content).slice(0, 200));
}

async function journeyTools(ctx) {
  const context = await ctx.callTool('JOURNEY:context');
  const contextResult = context.find(message => message.toolName === 'pstack_context');
  check('tool: pstack_context reports branch entries and the available tool set', JSON.stringify(contextResult).includes('entries') && JSON.stringify(contextResult).includes('pstack_context'), JSON.stringify(contextResult).slice(0, 300));
  const history = await ctx.callTool('JOURNEY:history');
  const historyResult = history.find(message => message.toolName === 'pstack_context');
  check('tool: pstack_context history lists workspace sessions', JSON.stringify(historyResult).includes('\"history\"') && JSON.stringify(historyResult).includes('historyDiscovery'), JSON.stringify(historyResult).slice(0, 300));
  const question = await ctx.callTool('JOURNEY:question');
  check('tool: AskQuestion returns the selected answer', JSON.stringify(question.find(m => m.toolName === 'AskQuestion')).includes('approve'), JSON.stringify(question).slice(0, 300));
}

async function journeyDelegation(ctx) {
  const task = await ctx.callTool('JOURNEY:task');
  const taskResult = task.find(message => message.toolName === 'Task');
  check('tool: a foreground Task returns the child answer', taskResult?.isError !== true && JSON.stringify(taskResult).includes('delegate-ok'), JSON.stringify(taskResult).slice(0, 400));
  const background = await ctx.callTool('JOURNEY:tasklist');
  const started = background.find(message => message.toolName === 'Task');
  const read = background.find(message => message.toolName === 'TaskOutput');
  check('tool: a background Task returns a task id', JSON.stringify(started).includes('task_id'), JSON.stringify(started).slice(0, 300));
  check('tool: TaskOutput block waits for the child answer', read?.isError !== true && JSON.stringify(read).includes('delegate-ok'), JSON.stringify(read).slice(0, 400));
  const unsupported = await ctx.callTool('JOURNEY:subagent');
  check('tool: Task rejects an unsupported persona by name', JSON.stringify(unsupported.find(m => m.toolName === 'Task')).includes('not-a-persona'), JSON.stringify(unsupported).slice(0, 300));
  const cloud = await ctx.callTool('JOURNEY:cloud');
  const cloudResult = cloud.find(message => message.toolName === 'Task');
  check('tool: Task refuses cloud execution instead of running locally', cloudResult?.isError === true && JSON.stringify(cloudResult).includes('cloud'), JSON.stringify(cloudResult).slice(0, 300));
  const badModel = await ctx.callTool('JOURNEY:badmodel');
  const badModelResult = badModel.find(message => message.toolName === 'Task');
  check('tool: Task reports an unavailable model with the available choices', badModelResult?.isError === true && JSON.stringify(badModelResult).includes('Unavailable model'), JSON.stringify(badModelResult).slice(0, 300));
}

async function journeyShells(ctx) {
  const shells = await ctx.callTool('JOURNEY:shell');
  const started = shells.find(message => message.toolName === 'BackgroundShell');
  const listed = shells.find(message => message.toolName === 'BackgroundShellList');
  const stopped = shells.find(message => message.toolName === 'BackgroundShellStop');
  check('tool: BackgroundShell starts a shell and reports its id', started?.isError !== true && JSON.stringify(started).includes('Started background shell'), JSON.stringify(started).slice(0, 200));
  check('tool: BackgroundShellList finds the running shell', JSON.stringify(listed).includes('Journey shell'), JSON.stringify(listed).slice(0, 200));
  check('tool: BackgroundShellStop reports a stopped shell', stopped?.isError !== true && JSON.stringify(stopped).includes('stopped'), JSON.stringify(stopped).slice(0, 200));
  await ctx.callTool('JOURNEY:shellexit');
  await new Promise(resolve => setTimeout(resolve, 1500));
  const escaped = await ctx.run('JOURNEY:shellexitstop');
  check('tool: BackgroundShellStop returns when a descendant escaped the process group', escaped.at(-1)?.['isError'] !== true && JSON.stringify(escaped).includes('stopped'), JSON.stringify(escaped).slice(-300));
  spawnSync('pkill', ['-f', 'POSIX::setsid']);
}

async function journeySetup(ctx) {
  const rulePath = join(ctx.directory, 'pstack', 'models.mdc');
  check('setup: no model rule exists before setup', !await exists(rulePath));
  await ctx.run('/setup-pstack');
  const rule = await readFile(rulePath, 'utf8').catch(() => '');
  check('setup: writes the model rule', rule.includes('pstack model configuration'), rule.slice(0, 120));
  const roles = ['feature, refactoring', 'bug-fix', 'perf-issue', 'hillclimb', 'judgment and prose', 'hardest tasks',
    'how explorer', 'how explainer', 'why investigators', 'why synthesizer', 'reflect tooling',
    'reflect judgment, divergent, synthesizer', 'arena runners', 'arena cross-judge pool', 'swarm workers',
    'architect runners', 'interrogate reviewers'];
  check('setup: keeps every upstream role', roles.every(role => rule.includes(`${role}:`)), roles.filter(role => !rule.includes(`${role}:`)).join(', '));
  check('setup: records the confirmed budget', /^# budget: unlimited/m.test(rule), rule.split('\n').find(line => line.startsWith('# budget')) ?? 'none');
  const notifications = ctx.ui.filter(request => request.method === 'notify').map(request => request.message ?? '');
  check('setup: confirms the written path', notifications.some(text => text.includes(`Wrote ${rulePath}`)), notifications.slice(-2).join(' | '));
  const offered = (await ctx.messages()).filter(m => m.role === 'user' && JSON.stringify(m.content).includes('want a project-local verification skill'));
  checkEqual('setup: offers project verification exactly once', offered.length, 1);
  const nextPrompt = systemText(await ctx.turn('journey probe'));
  check('setup: the saved rule applies from the next prompt', nextPrompt.includes('interrogate reviewers: journey-test/recorder'), nextPrompt.slice(-400));
  const before = ctx.ui.length;
  await ctx.run('/skill:setup-pstack');
  check('setup: /skill:setup-pstack runs the same validated dialogs', ctx.ui.length > before);
}

const journeys = [journeyLoad, journeyNativeSkills, journeyTemplates, journeyArguments, journeyHostContract,
  journeyMode, journeyStatus, journeyTodos, journeyTools, journeyDelegation, journeyShells, journeyHelpers, journeyResume, journeySetup];

function helper(command, args, cwd) {
  return spawnSync(command, args, { encoding: 'utf8', cwd, timeout: 180000 });
}

async function journeyHelpers(ctx) {
  const scripts = join(ctx.root, 'skills', 'poteto-mode', 'scripts');
  const usage = helper(process.execPath, [join(scripts, 'check-plan.mjs')], ctx.directory);
  check('helper: check-plan.mjs reports its usage', usage.status === 2 && usage.stderr.includes('Usage'), `${usage.status} ${usage.stderr}`);
  const plan = join(ctx.directory, 'plan.md');
  await writeFile(plan, '# Plan\n\nA colon: here.\n');
  const rejected = helper(process.execPath, [join(scripts, 'check-plan.mjs'), plan], ctx.directory);
  check('helper: check-plan.mjs fails a plan missing the required sections', rejected.status === 1 && rejected.stderr.includes('no "## How to read this" section'), `${rejected.status} ${rejected.stderr}`);
  const decisions = join(ctx.directory, 'decisions.tsv');
  const log = helper('bash', [join(ctx.root, 'skills', 'show-me-your-work', 'scripts', 'log.sh'), decisions, 'phase', 'decision', 'why', '=formula', 'result'], ctx.directory);
  check('helper: log.sh writes the decision row', log.status === 0 && (await readFile(decisions, 'utf8')).includes("'=formula"), `${log.status} ${log.stderr}`);
  for (const [label, file] of [['orch', join('orch', 'orch.ts')], ['watch-pr', join('watch-pr', 'watch-pr')]]) {
    const result = helper('bun', [file, '--help'], join(ctx.directory, 'helper-scripts'));
    check(`helper: ${label} answers --help`, result.status === 0 && String(result.stdout).includes('Usage'), `${result.status} ${String(result.stderr).slice(0, 200)}`);
  }
}

async function journeyWorktrees(ctx) {
  const repo = join(ctx.directory, 'repo');
  await mkdir(repo, { recursive: true });
  const results = [];
  const git = (args) => {
    const result = helper('git', args, repo);
    results.push(`${args.join(' ')}=${result.status}:${String(result.stderr).trim()}`);
    return result;
  };
  git(['init', '-q', '.']);
  git(['config', 'user.email', 'journey@example.invalid']);
  git(['config', 'user.name', 'Journey']);
  await writeFile(join(repo, 'file.txt'), 'content\n');
  git(['add', '.']);
  git(['commit', '-qm', 'initial']);
  git(['worktree', 'add', '-q', join(ctx.directory, 'repo-branch'), '-b', 'journey-branch']);
  const audit = helper('bash', [join(ctx.root, 'skills', 'poteto-mode', 'scripts', 'worktree-audit.sh'), repo], ctx.directory);
  const rows = String(audit.stdout).trim().split('\n');
  check('helper: worktree-audit.sh classifies a linked worktree', audit.status === 0 && rows.length === 2 && rows[1].endsWith('repo-branch') && rows[1].includes('\treview\t'), `${audit.status} ${audit.stdout} ${audit.stderr} | ${results.join(' | ')}`);
}

async function journeyResume(ctx) {
  const first = await startPi(ctx.directory, ctx.log, []);
  let sessionFile;
  try {
    await first.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
    sessionFile = (await first.send({ type: 'get_state' })).sessionFile;
    await first.run('/poteto-mode');
    await first.run('JOURNEY:todowrite');
  } finally {
    await first.finish().catch(() => {});
    await first.close().catch(() => {});
  }
  check('resume: the first session wrote its transcript', Boolean(sessionFile) && await exists(sessionFile));
  const second = await startPi(ctx.directory, ctx.log, ['--session', sessionFile]);
  try {
    await second.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
    await second.run('/pstack');
    const summary = String((await second.messages()).filter(m => m.customType === 'pstack-status').at(-1)?.content);
    check('resume: a reopened session keeps the active mode', /Poteto mode on/.test(summary), summary.slice(0, 200));
    await second.run('/pstack todos');
    const listed = String((await second.messages()).filter(m => m.customType === 'pstack-status').at(-1)?.content);
    check('resume: a reopened session keeps the saved todos', listed.includes('[>] Run the journey (in_progress)'), listed.slice(0, 300));
    const prompt = systemText(await second.turn('journey probe'));
    check('resume: the restored mode reaches the next prompt', prompt.includes('## Non-negotiables'));
  } finally {
    await second.finish().catch(() => {});
    await second.close().catch(() => {});
  }
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-pstack-journey-'));
  const log = join(directory, 'requests');
  await mkdir(log, { recursive: true });
  await mkdir(join(directory, 'extensions'), { recursive: true });
  await copyFile(join(root, 'test', 'journey-provider.ts'), join(directory, 'extensions', 'journey-provider.ts'));
  await cp(join(root, 'skills/poteto-mode/scripts'), join(directory, 'helper-scripts'), { recursive: true, filter: (source) => !source.includes('node_modules') });
  const ctx = { root, directory, log, ...await startPi(directory, log, ['--no-session']) };
  try {
    await ctx.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
    for (const journey of journeys) {
      if (!only || journey.name.includes(only)) await journey(ctx);
    }
    if (!only || 'journeyWorktrees'.includes(only)) await journeyWorktrees(ctx);
  } finally {
    await ctx.finish().catch(() => {});
    await ctx.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
  for (const name of passes) process.stdout.write(`ok   ${name}\n`);
  for (const name of findings) process.stdout.write(`FAIL ${name}\n`);
  process.stdout.write(`\n${passes.length} checks passed, ${findings.length} findings\n`);
  if (findings.length) process.exitCode = 1;
}

await main();
