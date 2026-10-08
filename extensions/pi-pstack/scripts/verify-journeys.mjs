import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { everyRequest, piLauncher } from './journey-client.mjs';
import { requestText, systemText, toolNames } from './journey-requests.mjs';
import { verifySkillCreation } from './skill-creation-journey.mjs';

const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));
const only = process.argv[3];
const evidenceDirectory = process.argv[4] ? resolve(process.argv[4]) : undefined;
const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');
const progressFixture = join(root, 'test', 'fixtures', 'task-progress-sentinel.txt');
const progressSentinel = 'CHILD_READ_FIXTURE_SENTINEL_CONTENT';
const startPi = piLauncher({ cli, root, progressFixture });

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
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function subdirectories(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function frontmatterBody(text) {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (match ? text.slice(match[0].length) : text).trim();
}

async function journeyLoad(ctx) {
  const commands = await ctx.send({ type: 'get_commands' });
  const allSkills = [...(await subdirectories(join(ctx.root, 'skills'))), ...(await subdirectories(join(ctx.root, 'host', 'skills')))].sort();
  const promptNames = [...(await readdir(join(ctx.root, 'prompts'))).filter((n) => n.endsWith('.md')).map((n) => n.slice(0, -3)), 'loop'];
  checkEqual('load: skill count discovered', commands.commands.filter((c) => c.source === 'skill').length, allSkills.length);
  checkEqual('load: every skill directory is a discovered skill command', allSkills.filter((name) => commands.commands.some((c) => c.name === `skill:${name}` && c.source === 'skill')).length, allSkills.length);
  checkEqual('load: every prompt template is discovered', promptNames.filter((name) => commands.commands.some((c) => c.name === name && c.source === 'prompt')).length, promptNames.length);
  for (const name of ['poteto-mode', 'setup-pstack', 'pstack']) {
    check(
      `load: ${name} is an extension command`,
      commands.commands.some((c) => c.name === name && c.source === 'extension'),
    );
  }
  check('load: the extension reported no load error', !/Failed to load extension|Extension error/.test(ctx.stderr()), ctx.stderr().slice(0, 400));
  return { skills: allSkills };
}

async function journeyNativeSkills(ctx) {
  for (const name of ctx.skills) {
    if (name === 'setup-pstack') continue;
    const bundled = join(ctx.root, 'skills', name, 'SKILL.md');
    const file = (await exists(bundled)) ? bundled : join(ctx.root, 'host', 'skills', name, 'SKILL.md');
    const text = requestText(await ctx.turn(`/skill:${name} journey arguments`));
    const body = frontmatterBody(await readFile(file, 'utf8'));
    check(`native: /skill:${name} delivers the complete skill body`, text.includes(body), `body ${body.length} chars not fully present`);
    check(`native: /skill:${name} delivers user arguments`, text.includes('journey arguments'));
    check(`native: /skill:${name} names the skill in the skill block`, text.includes(`skill name="${name}"`));
  }
}

async function journeyTemplates(ctx) {
  const files = [...(await readdir(join(ctx.root, 'prompts'))).filter((n) => n.endsWith('.md')).map((n) => join(ctx.root, 'prompts', n)), join(ctx.root, 'host', 'prompts', 'loop.md')];
  for (const file of files) {
    const name = file.endsWith('loop.md') ? 'loop' : file.split('/').at(-1).slice(0, -3);
    const text = requestText(await ctx.turn(`/${name} journey arguments`));
    const body = frontmatterBody(await readFile(file, 'utf8')).replace(/\n*\$ARGUMENTS\s*$/, '').trim();
    check(`template: /${name} delivers its template body`, text.includes(body), `expected ${body.length} chars`);
    check(`template: /${name} delivers user arguments`, text.includes('journey arguments'));
    check(`template: /${name} keeps no unexpanded $ARGUMENTS`, !text.includes('$ARGUMENTS'));
  }
}

async function journeyArguments(ctx) {
  const quoted = requestText(await ctx.turn('/how a "b c" d'));
  check('owned template: quoted text reaches the model literally', quoted.includes('a "b c" d'), quoted.slice(-120));
  const apostrophe = requestText(await ctx.turn("/how it's fine"));
  check('owned template: apostrophes reach the model literally', apostrophe.includes("it's fine"), apostrophe.slice(-120));
  const unpaired = requestText(await ctx.turn('/how before it\'s "after"'));
  check('owned template: unpaired quotes reach the model literally', unpaired.includes('before it\'s "after"'), unpaired.slice(-120));
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
    check(`host contract: maps Reference's ${mapped}`, systemPrompt.includes(mapped));
  }
  for (const [label, rule] of [
    ['no-inline-imports', 'Avoid inline imports in function bodies'],
    ['typescript-exhaustive-switch', 'use a `never` check in the default case'],
  ]) {
    check(`host contract: the archived team-kit rule ${label} stays out of the prompt`, !systemPrompt.includes(rule), `found ${rule}`);
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
  check('mode: the pstack_mode tool turns the mode on', JSON.stringify(tool.find((m) => m.toolName === 'pstack_mode')).includes('Poteto mode is on'));
  const toolMode = systemText(await ctx.turn('journey probe'));
  check('mode: a tool-activated mode reaches the next prompt', toolMode.includes('## Non-negotiables'));
  const off = await ctx.callTool('JOURNEY:modeoff');
  check('mode: the pstack_mode tool turns the mode off', JSON.stringify(off.find((m) => m.toolName === 'pstack_mode')).includes('Poteto mode is off'));
  const toolOff = systemText(await ctx.turn('journey probe'));
  check('mode: a tool-activated opt-out reaches the next prompt', !toolOff.includes('## Non-negotiables'));
}

async function journeyStatus(ctx) {
  const before = (await ctx.messages()).length;
  await ctx.run('/pstack');
  await ctx.run('/pstack status');
  await ctx.run('/pstack tones');
  const statuses = (await ctx.messages()).slice(before).filter((message) => message.customType === 'pstack-status');
  checkEqual('status: each accepted form publishes one status message', statuses.length, 2);
  check('status: reports the discovered skill and template counts', /72 skills, 70 prompt templates/.test(String(statuses[0]?.content)), String(statuses[0]?.content).slice(0, 200));
  const notifications = ctx.ui.filter((request) => request.method === 'notify').map((request) => request.message ?? '');
  check(
    'status: an unknown argument notifies the accepted forms',
    notifications.some((text) => text.includes('Use /pstack, /pstack status, or /pstack todos.')),
    notifications.slice(-4).join(' | '),
  );
}

async function journeyTodos(ctx) {
  const todos = await ctx.callTool('JOURNEY:todowrite');
  check('tool: TodoWrite replaces the list and reports progress', JSON.stringify(todos.find((m) => m.toolName === 'TodoWrite')).includes('Run the journey'));
  await ctx.run('/pstack todos');
  const status = (await ctx.messages()).filter((m) => m.customType === 'pstack-status').at(-1);
  check('tool: /pstack todos renders the saved list', String(status?.content).includes('[>] Run the journey (in_progress)'), String(status?.content).slice(0, 300));
  await ctx.send({ type: 'new_session' });
  await ctx.run('/pstack todos');
  const fresh = (await ctx.messages()).filter((m) => m.customType === 'pstack-status').at(-1);
  check('state: a new session starts with an empty todo list', String(fresh?.content).includes('Todos: none.'), String(fresh?.content).slice(0, 200));
}

async function journeyGoal(base) {
  const ctx = {
    ...base,
    async callTool(message) {
      const before = (await base.messages()).length;
      await base.run(message);
      return (await base.messages()).slice(before);
    },
  };
  await ctx.send({ type: 'new_session' });
  const before = await ctx.callTool('JOURNEY:getgoal');
  checkEqual('goal: a new session has no goal', before.find((message) => message.toolName === 'GetGoal')?.details, null);
  const results = await ctx.callTool('JOURNEY:goalcycle');
  const created = results.filter((message) => message.toolName === 'CreateGoal');
  check('goal: creation preserves the full objective', created[0]?.details?.objective === 'Verify every capability without subagents' && created[0]?.details?.status === 'active', JSON.stringify(created));
  check('goal: a second creation fails while active', created[1]?.isError === true && JSON.stringify(created[1]).includes('already active'));
  const read = results.find((message) => message.toolName === 'GetGoal');
  check('goal: GetGoal returns the active objective', read?.details?.objective === 'Verify every capability without subagents' && read?.details?.status === 'active');
  const complete = results.find((message) => message.toolName === 'UpdateGoal');
  checkEqual('goal: completion records the complete status', complete?.details?.status, 'complete');
  const after = await ctx.callTool('JOURNEY:getgoal');
  checkEqual('goal: completion survives the next turn', after.find((message) => message.toolName === 'GetGoal')?.details?.status, 'complete');
  await ctx.run('/goal clear');
  const cleared = await ctx.callTool('JOURNEY:getgoal');
  checkEqual('goal: clear records the cleared status', cleared.find((message) => message.toolName === 'GetGoal')?.details?.status, 'cleared');
  await ctx.send({ type: 'new_session' });
  const fresh = await ctx.callTool('JOURNEY:getgoal');
  checkEqual('goal: a new session does not inherit another session goal', fresh.find((message) => message.toolName === 'GetGoal')?.details, null);
  const continued = await ctx.callTool('JOURNEY:goalcontinue');
  check(
    'goal: an active goal schedules a continuation message',
    continued.some((message) => message.customType === 'pstack-goal-continue' && message.content.includes('Prove automatic goal continuation')),
  );
  check(
    'goal: the continuation can complete the original goal',
    continued.some((message) => message.toolName === 'UpdateGoal' && message.details?.status === 'complete' && message.details?.objective === 'Prove automatic goal continuation'),
  );
  const requests = await ctx.requests();
  check(
    'goal: the continuation request carries the full objective and audit instruction',
    requests.some((request) => requestText(request).includes('Goal still active. Objective:\nProve automatic goal continuation\n\nContinue working. Call GetGoal if you lost the objective. Audit every requirement against fresh evidence.')),
  );
}

async function journeyTools(ctx) {
  const context = await ctx.callTool('JOURNEY:context');
  const contextResult = context.find((message) => message.toolName === 'pstack_context');
  check('tool: pstack_context reports branch entries and the available tool set', JSON.stringify(contextResult).includes('entries') && JSON.stringify(contextResult).includes('pstack_context'), JSON.stringify(contextResult).slice(0, 300));
  const history = await ctx.callTool('JOURNEY:history');
  const historyResult = history.find((message) => message.toolName === 'pstack_context');
  check('tool: pstack_context history lists workspace sessions', JSON.stringify(historyResult).includes('"history"') && JSON.stringify(historyResult).includes('historyDiscovery'), JSON.stringify(historyResult).slice(0, 300));
  const question = await ctx.callTool('JOURNEY:question');
  check('tool: AskQuestion returns the selected answer', JSON.stringify(question.find((m) => m.toolName === 'AskQuestion')).includes('approve'), JSON.stringify(question).slice(0, 300));
}

async function journeyTask(ctx) {
  const sync = (await ctx.callTool('JOURNEY:reference-assistant-sync')).find((message) => message.toolName === 'task');
  check(
    'RPC: a sync task returns the child final message verbatim from the real child session',
    sync?.isError !== true && sync?.content?.[0]?.text.startsWith('recorded <current_datetime>') && sync?.details?.status === 'completed' && sync?.details?.agent_type === 'general-purpose',
    JSON.stringify(sync).slice(0, 300),
  );
  const refused = (await ctx.callTool('JOURNEY:reference-assistant-unknown')).find((message) => message.toolName === 'task');
  check(
    'RPC: an unknown agent_type is a tool error that lists the valid types',
    refused?.isError === true && JSON.stringify(refused).includes('Unknown agent_type: not-a-type. Valid types are: code-review, explore, general-purpose, research, rubber-duck, security-review, task'),
    JSON.stringify(refused).slice(0, 300),
  );
}

async function journeyTaskBackground(ctx) {
  const messages = await ctx.callTool('JOURNEY:assistant-background');
  const started = messages.find((message) => message.toolName === 'task');
  check(
    'RPC: a background task returns its agent id at once',
    started?.isError !== true && started?.content?.[0]?.text.includes('Agent started in background with agent_id: ') && started?.details?.mode === 'background',
    JSON.stringify(started).slice(0, 300),
  );
  const listed = messages.find((message) => message.toolName === 'list_agents');
  check('RPC: list_agents reports the background agent', listed?.isError !== true && listed?.content?.[0]?.text.includes('agent_type: general-purpose | name: bg-probe | mode: background'), JSON.stringify(listed).slice(0, 300));
}

async function journeyProgress(ctx) {
  const start = ctx.toolUpdates.length;
  const messages = await ctx.callTool('JOURNEY:progress');
  const task = messages.find((message) => message.toolName === 'Task');
  const record = task?.details;
  const updates = ctx.toolUpdates
    .slice(start)
    .filter((event) => event.toolName === 'Task')
    .map((event) => event.partialResult);
  const bashStarted = updates.find((partial) => partial.details?.latest?.kind === 'tool-started' && partial.details.latest.tool === 'bash');
  const bashFinished = updates.find((partial) => partial.details?.latest?.kind === 'tool-finished' && partial.details.latest.tool === 'bash');
  const readStarted = updates.find((partial) => partial.details?.latest?.kind === 'tool-started' && partial.details.latest.tool === 'read');
  const readFinished = updates.find((partial) => partial.details?.latest?.kind === 'tool-finished' && partial.details.latest.tool === 'read');
  check('RPC: foreground Task returns the unchanged settled record', task?.isError !== true && record?.status === 'settled' && record.output === 'recorded JOURNEY:progress-child');
  check('RPC: child shell start is a literal safe snapshot', bashStarted?.content?.[0]?.text === `Task ${record?.id} running. Active tools: bash. Latest: bash started.`);
  check('RPC: child shell finish is a literal safe snapshot', bashFinished?.content?.[0]?.text === `Task ${record?.id} running. Active tools: none. Latest: bash finished.`);
  check('RPC: child read start is a literal safe snapshot', readStarted?.content?.[0]?.text === `Task ${record?.id} running. Active tools: read. Latest: read started.`);
  check('RPC: child read finish is a literal safe snapshot', readFinished?.content?.[0]?.text === `Task ${record?.id} running. Active tools: none. Latest: read finished.`);
  check(
    'RPC: progress partials omit structured output and usage',
    updates.length === 4 && updates.every((partial) => partial.details?.kind === 'progress' && !Object.hasOwn(partial, 'structuredContent') && !Object.hasOwn(partial, 'usage')),
  );
  const encoded = JSON.stringify(updates);
  for (const secret of [progressSentinel, 'JOURNEY:progress-child', progressFixture, 'journey-', 'sleep 0.4; printf PSTACK_CHILD_SHELL_OUTPUT_SENTINEL', 'PSTACK_CHILD_SHELL_OUTPUT_SENTINEL']) {
    check(
      `RPC: progress omits ${secret === progressFixture ? 'paths' : secret === progressSentinel || secret.includes('OUTPUT') ? 'child results' : secret === 'journey-' ? 'child call ids' : secret.includes('command') || secret.includes('sleep') ? 'child commands' : 'child input'}`,
      !encoded.includes(secret),
    );
  }
  const transcript = await readFile(record?.sessionFile ?? '', 'utf8').catch(() => '');
  check('RPC: the installed child read the fixture sentinel', transcript.includes(progressSentinel));
  const persisted = JSON.stringify(await ctx.messages());
  check('RPC: progress is not persisted in parent messages', !persisted.includes('"kind":"progress"') && !persisted.includes('Latest: read started.'));
}

async function journeyDelegation(ctx) {
  const task = await ctx.callTool('JOURNEY:task');
  const taskResult = task.find((message) => message.toolName === 'Task');
  check('tool: a foreground Task returns the child answer', taskResult?.isError !== true && JSON.stringify(taskResult).includes('delegate-ok'), JSON.stringify(taskResult).slice(0, 400));
  const background = await ctx.callTool('JOURNEY:tasklist');
  const started = background.find((message) => message.toolName === 'Task');
  const read = background.find((message) => message.toolName === 'TaskOutput');
  check('tool: a background Task returns a task id', JSON.stringify(started).includes('task_id'), JSON.stringify(started).slice(0, 300));
  check('tool: TaskOutput block waits for the child answer', read?.isError !== true && JSON.stringify(read).includes('delegate-ok'), JSON.stringify(read).slice(0, 400));
  const unsupported = await ctx.callTool('JOURNEY:subagent');
  check('tool: Task rejects an unsupported persona by name', JSON.stringify(unsupported.find((m) => m.toolName === 'Task')).includes('not-a-persona'), JSON.stringify(unsupported).slice(0, 300));
  const cloud = await ctx.callTool('JOURNEY:cloud');
  const cloudResult = cloud.find((message) => message.toolName === 'Task');
  check(
    'tool: Task cloud execution without a configured remote executor refuses local fallback',
    cloudResult?.isError === true && JSON.stringify(cloudResult).includes('No local fallback is permitted'),
    JSON.stringify(cloudResult).slice(0, 300),
  );
  const badModel = await ctx.callTool('JOURNEY:badmodel');
  const badModelResult = badModel.find((message) => message.toolName === 'Task');
  check('tool: Task reports an unavailable model with the available choices', badModelResult?.isError === true && JSON.stringify(badModelResult).includes('Unavailable model'), JSON.stringify(badModelResult).slice(0, 300));
}

async function journeyShells(ctx) {
  const shells = await ctx.callTool('JOURNEY:shell');
  const started = shells.find((message) => message.toolName === 'BackgroundShell');
  const listed = shells.find((message) => message.toolName === 'Background' + 'ShellList');
  const stopped = shells.find((message) => message.toolName === 'Background' + 'ShellStop');
  check('tool: BackgroundShell starts a shell and reports its id', started?.isError !== true && JSON.stringify(started).includes('Started background shell'), JSON.stringify(started).slice(0, 200));
  check('tool: BackgroundShellList finds the running shell', JSON.stringify(listed).includes('Journey shell'), JSON.stringify(listed).slice(0, 200));
  check('tool: BackgroundShellStop reports a stopped shell', stopped?.isError !== true && JSON.stringify(stopped).includes('stopped'), JSON.stringify(stopped).slice(0, 200));
  const escapeStart = (await ctx.callTool('JOURNEY:shellexit')).find((message) => message.toolName === 'BackgroundShell');
  let descendant;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !descendant) {
      const output = await readFile(escapeStart.details.outputFile, 'utf8').catch(() => '');
      descendant = Number(output.match(/ESCAPED_PID=(\d+)/)?.[1]) || undefined;
      if (!descendant) await new Promise((resolve) => setTimeout(resolve, 40));
    }
    check('tool: the escaping fixture records its own descendant PID', Number.isSafeInteger(descendant) && descendant > 0);
    const escaped = await ctx.run('JOURNEY:shellexitstop');
    check('tool: BackgroundShellStop returns when a descendant escaped the process group', escaped.at(-1)?.isError !== true && JSON.stringify(escaped).includes('stopped'), JSON.stringify(escaped).slice(-300));
  } finally {
    if (descendant) {
      try {
        process.kill(descendant, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') check('tool: the escaping fixture cleans up its own descendant', false, String(error));
      }
    }
  }
}

async function journeySetup(ctx) {
  const rulePath = join(ctx.directory, 'pstack', 'models.mdc');
  check('setup: no model rule exists before setup', !(await exists(rulePath)));
  await ctx.run('/setup-pstack');
  const rule = await readFile(rulePath, 'utf8').catch(() => '');
  check('setup: writes the model rule', rule.includes('pstack model configuration. One line per role'), rule.slice(0, 160));
  const roles = [
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
  check(
    'setup: keeps every upstream role',
    roles.every((role) => rule.includes(`${role}:`)),
    roles.filter((role) => !rule.includes(`${role}:`)).join(', '),
  );
  check('setup: records the confirmed budget', /^# budget: unlimited \(max\)$/m.test(rule), rule.split('\n').find((line) => line.startsWith('# budget')) ?? 'none');
  const setupResults = () => (async () => (await ctx.messages()).filter((message) => message.role === 'toolResult' && message.toolName === 'pstack_setup'))();
  const results = await setupResults();
  check(
    'setup: the write result confirms the written path',
    results.some((message) => JSON.stringify(message).includes(`Wrote ${rulePath}`)),
    JSON.stringify(results.at(-1)).slice(-300),
  );
  const nextPrompt = systemText(await ctx.turn('journey probe'));
  check('setup: the saved rule applies from the next prompt', nextPrompt.includes('interrogate reviewers: inherit-parent'), nextPrompt.slice(-400));
  const before = (await setupResults()).length;
  await ctx.run('/skill:setup-pstack');
  const after = (await setupResults()).length;
  check('setup: /skill:setup-pstack runs the same state-question-write flow', after > before, `${before} -> ${after}`);
  return {};
}

async function journeySkillCreation(ctx) {
  await verifySkillCreation({ ctx, check, startPi });
}

const journeys = [
  journeySkillCreation,
  journeyLoad,
  journeyGoal,
  journeyNativeSkills,
  journeyTemplates,
  journeyArguments,
  journeyHostContract,
  journeyMode,
  journeyStatus,
  journeyTodos,
  journeyTools,
  journeyTodoMerge,
  journeyTodoWidget,
  journeyQuestionVariants,
  journeyTask,
  journeyTaskBackground,
  journeyProgress,
  journeyTaskResume,
  journeyTaskLifecycle,
  journeyTaskGates,
  journeyPersonas,
  journeyShellGuards,
  journeyDelegation,
  journeyShells,
  journeyHelpers,
  journeyResume,
  journeySetup,
];

function helper(command, args, cwd) {
  return spawnSync(command, args, { encoding: 'utf8', cwd, timeout: 180000 });
}

async function journeyTodoMerge(ctx) {
  await ctx.send({ type: 'new_session' });
  const duplicate = (await ctx.callTool('JOURNEY:tododup')).find((message) => message.toolName === 'TodoWrite');
  check('todo: duplicate ids are rejected', duplicate?.isError === true && JSON.stringify(duplicate.content).includes('Todo IDs must be unique'), JSON.stringify(duplicate).slice(0, 300));
  await ctx.send({ type: 'new_session' });
  await ctx.run('JOURNEY:todowrite');
  await ctx.run('JOURNEY:todomerge');
  await ctx.run('/pstack todos');
  const listed = String((await ctx.messages()).filter((m) => m.customType === 'pstack-status').at(-1)?.content);
  const order = ['[x] Read the playbook (completed)', '[>] Run the journey (in_progress)', '[x] Report findings (completed)'].map((row) => listed.indexOf(row));
  check('todo: a merge keeps the original order and updates the existing step', order.every((at) => at >= 0) && order[0] < order[1] && order[1] < order[2], listed);
  await ctx.send({ type: 'new_session' });
  await ctx.run('JOURNEY:todocancel');
  await ctx.run('/pstack todos');
  const cancelled = String((await ctx.messages()).filter((m) => m.customType === 'pstack-status').at(-1)?.content);
  check('todo: a cancelled step keeps its marker and reason', cancelled.includes('[-] Abandoned step (cancelled)'), cancelled);
}

async function journeyTodoWidget(ctx) {
  await ctx.send({ type: 'new_session' });
  await ctx.run('JOURNEY:todomany');
  const widgets = ctx.ui.filter((request) => request.method === 'setWidget').flatMap((request) => request.widgetLines ?? []);
  check('todo: the widget reaches a non-TUI client as text lines', widgets.length > 0, `${widgets.length} lines`);
  check('todo: the collapsed widget keeps the in-progress step and counts the hidden ones', widgets.includes('... 4 earlier') && widgets.some((line) => line.includes('Step 7 of the long journey')), widgets.join(' | '));
}

async function journeyQuestionVariants(ctx) {
  let picks = 0;
  ctx.answers.select = (record) => {
    const real = record.options.filter((option) => option !== 'Enter a text answer' && option !== 'Done selecting');
    if (real.length > 0 && picks < 2) {
      picks += 1;
      return real[0];
    }
    return record.options.find((option) => option === 'Done selecting') ?? real[0];
  };
  const multi = await ctx.callTool('JOURNEY:qmulti');
  ctx.answers.select = undefined;
  const multiDetails = multi.find((message) => message.toolName === 'AskQuestion')?.details;
  checkEqual('question: multi-select stops on Done selecting and keeps each choice', JSON.stringify(multiDetails), JSON.stringify([{ id: 'toppings', answers: ['basil', 'oregano'], cancelled: false }]));

  ctx.answers.select = (record) => record.options.find((option) => option === 'Enter a text answer') ?? record.options.find((option) => option === 'Done selecting');
  const typed = await ctx.callTool('JOURNEY:qmulti');
  ctx.answers.select = undefined;
  checkEqual('question: multi-select keeps a typed answer', JSON.stringify(typed.find((message) => message.toolName === 'AskQuestion')?.details), JSON.stringify([{ id: 'toppings', answers: ['journey-test/recorder'], cancelled: false }]));

  const textOnly = await ctx.callTool('JOURNEY:qtext');
  checkEqual(
    'question: a question without options returns the typed answer',
    JSON.stringify(textOnly.find((message) => message.toolName === 'AskQuestion')?.details),
    JSON.stringify([{ id: 'release', answers: ['journey-test/recorder'], cancelled: false }]),
  );

  ctx.answers.select = () => undefined;
  const cancelled = await ctx.callTool('JOURNEY:qfree');
  ctx.answers.select = undefined;
  checkEqual('question: a cancelled dialog reports cancellation and no answer', JSON.stringify(cancelled.find((message) => message.toolName === 'AskQuestion')?.details), JSON.stringify([{ id: 'approval', answers: [], cancelled: true }]));

  const duplicate = await ctx.callTool('JOURNEY:qdup');
  const duplicateResult = duplicate.find((message) => message.toolName === 'AskQuestion');
  check(
    'question: duplicate question ids are rejected before any dialog opens',
    duplicateResult?.isError === true && JSON.stringify(duplicateResult.content).includes('Question IDs must be unique'),
    JSON.stringify(duplicateResult).slice(0, 300),
  );
  const tooMany = await ctx.callTool('JOURNEY:qtoo');
  const tooManyResult = tooMany.find((message) => message.toolName === 'AskQuestion');
  check('question: more than four questions is rejected', tooManyResult?.isError === true, JSON.stringify(tooManyResult).slice(0, 300));
}

async function journeyTaskResume(ctx) {
  const results = (await ctx.callTool('JOURNEY:taskresume')).filter((message) => message.toolName === 'Task');
  checkEqual('task: a resumed task runs a second turn', results.length, 2);
  const [first, second] = results.map((message) => message.details);
  check('task: resume returns the same child transcript', first?.sessionFile === second?.sessionFile && Boolean(first?.sessionFile), JSON.stringify([first?.sessionFile, second?.sessionFile]));
  check('task: the child transcript pointer is absolute', String(first?.sessionFile).startsWith('/'), String(first?.sessionFile));
  check('task: the child transcript is not written inside the working directory', !String(first?.sessionFile).startsWith(`${ctx.directory}/`), String(first?.sessionFile));
  check('task: resume keeps the same task id', first?.id === second?.id && Boolean(first?.id), JSON.stringify([first?.id, second?.id]));
  const transcript = first?.sessionFile ? await readFile(first.sessionFile, 'utf8').catch(() => '') : '';
  check('task: the resumed transcript holds both child turns', transcript.includes('first child turn for resume') && transcript.includes('second child turn after resume'), `${transcript.length} bytes`);
  check('task: the second turn is the one that settled', String(second?.output).includes('second child turn after resume'), String(second?.output).slice(0, 200));
}

async function journeyTaskLifecycle(ctx) {
  const results = await ctx.callTool('JOURNEY:tasklifecycle');
  const started = results.find((message) => message.toolName === 'Task');
  const read = results.find((message) => message.toolName === 'TaskOutput');
  const messaged = results.find((message) => message.toolName === 'TaskMessage');
  const stopped = results.find((message) => message.toolName === 'TaskStop');
  check('task: a background task reports a task id', started?.isError !== true && JSON.stringify(started).includes('task_id'), JSON.stringify(started).slice(0, 300));
  check('task: TaskOutput returns the settled child output', read?.isError !== true && String(read?.details?.status) === 'settled', JSON.stringify(read).slice(0, 300));
  check('task: TaskMessage refuses a settled task and points at resume', messaged?.isError === true && JSON.stringify(messaged.content).includes('Use Task with resume'), JSON.stringify(messaged).slice(0, 300));
  check('task: TaskStop on a settled task reports the record instead of failing', stopped?.isError !== true && Boolean(stopped?.details?.id), JSON.stringify(stopped).slice(0, 300));
  const unknown = (await ctx.callTool('JOURNEY:badmodel')).find((message) => message.toolName === 'Task');
  check('task: an unavailable model names the available choices', unknown?.isError === true, JSON.stringify(unknown).slice(0, 200));
}

async function journeyPersonas(ctx) {
  const results = (await ctx.callTool('JOURNEY:personas')).filter((message) => message.toolName === 'Task');
  const failed = results.filter((message) => message.isError === true);
  checkEqual('persona: every documented persona starts a child', failed.length, 0);
  checkEqual('persona: one result per documented persona', results.length, 6);
  const requests = await ctx.everyRequest();
  const prompts = requests.map((request) => requestText(request));
  for (const [persona, marker] of [
    ['poteto-agent', 'Poteto mode'],
    ['comment-sicko', 'Comment Sicko'],
    ['ci-watcher', 'CI watcher'],
    ['thermo-nuclear-code-quality-review', 'thermo'],
  ]) {
    check(
      `persona: ${persona} instructions reach a child request`,
      prompts.some((prompt) => prompt.includes(marker)),
      `${prompts.length} requests`,
    );
  }
  const rejected = (await ctx.callTool('JOURNEY:subagent')).find((message) => message.toolName === 'Task');
  check('persona: an unpublished Reference persona is rejected with the available names', rejected?.isError === true && JSON.stringify(rejected.content).includes('generalPurpose'), JSON.stringify(rejected).slice(0, 300));
}

async function journeyShellGuards(ctx) {
  const invalid = await ctx.callTool('JOURNEY:shellinvalid');
  const started = invalid.filter((message) => message.toolName === 'BackgroundShell');
  checkEqual('shell: an invalid pattern and a blank title both fail before spawning', started.filter((message) => message.isError === true).length, 2);
  check(
    'shell: the pattern failure names the regular expression',
    started.some((message) => JSON.stringify(message.content).includes('notify_on_output is not a valid regular expression')),
    JSON.stringify(started.map((message) => message.content)).slice(0, 400),
  );
  const unknown = (await ctx.callTool('JOURNEY:shellunknown')).find((message) => message.toolName === 'Background' + 'ShellStop');
  check('shell: stopping an unknown shell reports the id', unknown?.isError === true && JSON.stringify(unknown.content).includes('Unknown background shell'), JSON.stringify(unknown).slice(0, 300));
}

async function journeyTaskGates(ctx) {
  const readonlyRun = await ctx.callTool('JOURNEY:readonly');
  const readonlyResult = readonlyRun.find((message) => message.toolName === 'Task');
  check('task: a readonly child settles', readonlyResult?.isError !== true, JSON.stringify(readonlyResult).slice(0, 300));
  const requests = await ctx.everyRequest();
  const childTools = requests.filter((request) => request.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('readonly child turn'))).map(toolNames);
  check('task: a readonly child receives only read tools', childTools.length > 0 && childTools.every((tools) => JSON.stringify(tools) === '["find","grep","ls","read"]'), JSON.stringify(childTools));
  check(
    'task: the parent keeps its shell tool',
    requests.some((request) => toolNames(request).includes('bash')),
    `${requests.length} requests`,
  );

  const localRun = await ctx.callTool('JOURNEY:localenv');
  check('task: an explicit local environment runs', localRun.find((message) => message.toolName === 'Task')?.isError !== true, JSON.stringify(localRun).slice(0, 300));

  const badCwd = await ctx.callTool('JOURNEY:badcwd');
  const badCwdResult = badCwd.find((message) => message.toolName === 'Task');
  check('task: a missing workspace fails before the child starts', badCwdResult?.isError === true && JSON.stringify(badCwdResult.content).includes('no/such/directory'), JSON.stringify(badCwdResult).slice(0, 300));

  const policy = (await ctx.callTool('JOURNEY:taskpolicy')).filter((message) => message.toolName === 'Task');
  checkEqual('task: a policy resume runs two turns', policy.length, 2);
  check('task: resume refuses a changed persona', policy[1]?.isError === true && JSON.stringify(policy[1].content).includes('Resume must preserve the task workspace, persona, and readonly policy'), JSON.stringify(policy[1]).slice(0, 300));

  const steerRun = await ctx.callTool('JOURNEY:tasksteer');
  const steered = steerRun.find((message) => message.toolName === 'TaskMessage');
  const settled = steerRun.find((message) => message.toolName === 'TaskOutput');
  check('task: TaskMessage queues steering for a running child', steered?.isError !== true && JSON.stringify(steered.content).includes('Message queued'), JSON.stringify(steered).slice(0, 300));
  check('task: the steered child settles with the steering turn', settled?.isError !== true && String(settled.details?.output).includes('steer the running child'), JSON.stringify(settled).slice(0, 300));
  const transcript = settled?.details?.sessionFile ? await readFile(settled.details.sessionFile, 'utf8').catch(() => '') : '';
  check('task: the child transcript holds the steering message', transcript.includes('steer the running child') && transcript.includes('JOURNEY:slowchild'), `${transcript.length} bytes`);
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
  for (const [label, file] of [
    ['orch', join('orch', 'orch.ts')],
    ['watch-pr', join('watch-pr', 'watch-pr')],
  ]) {
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
  check(
    'helper: worktree-audit.sh classifies a linked worktree',
    audit.status === 0 && rows.length === 2 && rows[1].endsWith('repo-branch') && rows[1].includes('\treview\t'),
    `${audit.status} ${audit.stdout} ${audit.stderr} | ${results.join(' | ')}`,
  );
}

async function journeyResume(ctx) {
  const first = await startPi(ctx.directory, ctx.log, []);
  let sessionFile;
  try {
    await first.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
    sessionFile = (await first.send({ type: 'get_state' })).sessionFile;
    await first.run('/poteto-mode');
    await first.run('JOURNEY:todowrite');
    await first.run('JOURNEY:goalcycle');
  } finally {
    await first.finish().catch(() => {});
    await first.close().catch(() => {});
  }
  check('resume: the first session wrote its transcript', Boolean(sessionFile) && (await exists(sessionFile)));
  const second = await startPi(ctx.directory, ctx.log, ['--session', sessionFile]);
  try {
    await second.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
    await second.run('/pstack');
    const summary = String((await second.messages()).filter((m) => m.customType === 'pstack-status').at(-1)?.content);
    check('resume: a reopened session keeps the active mode', /Poteto mode on/.test(summary), summary.slice(0, 200));
    await second.run('/pstack todos');
    const listed = String((await second.messages()).filter((m) => m.customType === 'pstack-status').at(-1)?.content);
    check('resume: a reopened session keeps the saved todos', listed.includes('[>] Run the journey (in_progress)'), listed.slice(0, 300));
    const prompt = systemText(await second.turn('journey probe'));
    check('resume: the restored mode reaches the next prompt', prompt.includes('## Non-negotiables'));
    await second.run('JOURNEY:getgoal');
    const goal = (await second.messages()).filter((message) => message.role === 'toolResult' && message.toolName === 'GetGoal').at(-1);
    check('resume: the completed goal survives process restart', goal?.details?.status === 'complete' && goal?.details?.objective === 'Verify every capability without subagents', JSON.stringify(goal));
  } finally {
    await second.finish().catch(() => {});
    await second.close().catch(() => {});
  }
}

async function main() {
  const workerJourneys = new Set([journeyTask, journeyTaskBackground, journeyProgress, journeyTaskResume, journeyTaskLifecycle, journeyTaskGates, journeyPersonas, journeyDelegation]);
  const selected = [...journeys, journeyWorktrees].filter((journey) => (only === '--no-workers' ? !workerJourneys.has(journey) : !only || journey.name.includes(only)));
  if (selected.length === 0) throw new Error(`Unknown journey selector: ${only}`);
  const directory = await mkdtemp(join(tmpdir(), 'pi-pstack-journey-'));
  const log = join(directory, 'requests');
  await mkdir(log, { recursive: true });
  await mkdir(join(directory, 'extensions'), { recursive: true });
  await copyFile(join(root, 'test', 'journey-provider.ts'), join(directory, 'extensions', 'journey-provider.ts'));
  await cp(join(root, 'skills/poteto-mode/scripts'), join(directory, 'helper-scripts'), { recursive: true, filter: (source) => !source.includes('node_modules') });
  const skills = [...(await subdirectories(join(root, 'skills'))), ...(await subdirectories(join(root, 'host', 'skills')))].sort();
  const ctx = { root, directory, log, skills, ...(await startPi(directory, log, ['--no-session'])) };
  try {
    await ctx.send({ type: 'set_model', provider: 'journey-test', modelId: 'recorder' });
    // Each journey folds the facts it discovered into the next context instead of writing them back.
    let shared = ctx;
    for (const journey of selected) {
      shared = { ...shared, ...(await journey(shared)) };
    }
    if (only === '--no-workers') {
      const requests = await everyRequest(log);
      const delegated = requests.some((request) => request.messages.some((message) => message.role === 'assistant' && Array.isArray(message.content) && message.content.some((block) => block.type === 'toolCall' && block.name === 'Task')));
      check('no-workers: no recorded request invokes Task', !delegated);
    }
  } finally {
    await ctx.finish().catch(() => {});
    await ctx.close().catch(() => {});
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      await cp(log, join(evidenceDirectory, 'requests'), { recursive: true });
      await writeFile(join(evidenceDirectory, 'results.json'), JSON.stringify({ selected: selected.map((journey) => journey.name), passes, findings, stderr: ctx.stderr() }, null, 2));
    }
    await rm(directory, { recursive: true, force: true });
  }
  for (const name of passes) process.stdout.write(`ok   ${name}\n`);
  for (const name of findings) process.stdout.write(`FAIL ${name}\n`);
  process.stdout.write(`\n${passes.length} checks passed, ${findings.length} findings\n`);
  if (findings.length) process.exitCode = 1;
}

await main();
