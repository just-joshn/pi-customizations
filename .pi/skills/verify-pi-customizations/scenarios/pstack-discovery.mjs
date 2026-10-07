import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'extensions/pi-pstack';
const SURFACES_PATH = 'docs/user-perspective-testing/surfaces.tsv';
const OBSERVER = fileURLToPath(new URL('../lib/observers/pstack-observer.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../lib/observers/scripted-provider.mjs', import.meta.url));
const SETUP_BUDGET = 'small — medium reasoning';
const TASK_AGENTS = ['general-purpose', 'explore', 'task', 'code-review', 'security-review', 'research', 'rubber-duck'];
const PERSONA_AGENTS = ['shell', 'poteto-agent', 'comment-sicko', 'ci-watcher', 'thermo-nuclear-code-quality-review'];
const WORKFLOW_TOOLS = ['run_dynamic_workflow', 'dynamic_workflows_manage', 'read_workflow_run'];
const WAIT_STEP_MS = 50;
const WAIT_TIMEOUT_MS = 30000;
const CORE_TOOLS = ['bash', 'edit', 'find', 'grep', 'ls', 'powershell', 'read', 'write'];
const ENV_GATED_COMMANDS = new Set(['pstack-worker-finalize']);
const ENV_GATED_TOOLS = new Set(['execution_subagent', 'search_subagent', 'run_dynamic_workflow', 'dynamic_workflows_manage', 'read_workflow_run']);

const UNDRIVEN_REASONS = {
  'PS-CFG-13':
    'orchestrate state is created by the orch CLI (extensions/pi-pstack/scripts/orch) during a workflow run. This drive observes Pi discovery and registration surfaces; it did not run orch, so no orchestrate state or plan directory was produced. The store root it would live under is observed under PS-CFG-8.',
  'PS-ENV-6':
    'PSTACK_PI_COMMAND selects the executable for detached roots (resolvePiCommand). Driving it means starting a durable detached timer or routine root that outlives this drive; the drive starts no detached roots and reaps every process it starts.',
  'PS-ENV-7': 'ORCH_STORE is read by cloudFilesystem while building a cloud worker filesystem restriction. No cloud executor is configured in this environment and the drive starts no cloud task.',
  'PS-ENV-11':
    'COPILOT_DEBUG_ENABLE_SIDEKICKS only enables a sidekick when its spec launch conditions hold, and an enabled sidekick launches its own child session from an event trigger. The scratch workspace has no git repo fact, and the drive does not run the sidekick launch flow.',
  'PS-ENV-13':
    'COPILOT_TASK_WAIT_TIMEOUT_SECONDS is consumed by waitSeconds() inside registerSettleWiring, which returns immediately while ctx.hasUI is true. RPC sessions answer extension dialogs, so the headless settle-wait branch never executes here.',
  'PS-ENV-15':
    'COPILOT_EVENTS_LOG_INCLUDE_SUBAGENTS gates relay of child hook_event messages. A task child launched with settings hooks.subagentStop ["true"] produced identical event logs with the flag set and unset (11 events each, 0 hook_event lines), so the include path produced no observable difference this drive could assert.',
  'PS-ENV-17':
    'CLAUDE_CODE_HANDBACK_PROVENANCE controls the frame modelFacingReport adds to a finalized subagent report. A background task child delivered a system_notification ("Agent ... is now idle") with no report text under both default and =0 env; the framed taskNotification path did not surface over RPC.',
  'PS-ENV-18': 'CLAUDE_CODE_SIMPLE disables subagent status-line decorations (task-panel.ts). RPC mode renders no TUI status line, so the flag has no observable surface here.',
  'PS-ENV-19': 'CLAUDE_PROJECT_DIR is injected into the user subagentStatusLine command environment (status-line.ts). RPC mode runs no status-line command, so the injection is not observable here.',
  'PS-ENV-22':
    'PATH is read by resolvePiCommand for detached roots and by systemProbe.onPath for child environment facts (extensions/pi-pstack/src/subagents/environment-facts.ts:35). The drive started no detached root, and child environment facts are not exposed in the parent transcript or task tool results.',
};

function readRows(repoRoot) {
  const lines = readFileSync(join(repoRoot, SURFACES_PATH), 'utf8').replace(/\n$/, '').split('\n');
  const columns = lines.shift().split('\t');
  return lines.map((line) => Object.fromEntries(columns.map((column, index) => [column, line.split('\t')[index]])));
}

function surfaceName(row) {
  return row.name.replace(/^`|`$/g, '').replace(/^\//, '');
}

// The rows this drive is accountable for: everything below the T3 deep-flow rows, which other
// drives cover. It is keyed on kind rather than tier because the drive enumerates registration for
// some of them and drives the rest; the receipt's scope records which.
const DRIVEN_KINDS = new Set(['command', 'tool', 'provider', 'virtual-model', 'mcp-server', 'skill', 'prompt-template', 'agent', 'config-file', 'env-var']);

function drivenRows(repoRoot) {
  return readRows(repoRoot).filter((row) => row.package === PACKAGE && row.tier !== 'T3' && DRIVEN_KINDS.has(row.kind));
}

function describeCommand(command) {
  const info = command.sourceInfo ?? {};
  return `${command.name}: source=${command.source} origin=${info.origin ?? 'n/a'} path=${info.path ?? 'n/a'} description=${JSON.stringify(command.description ?? '')}`;
}

function driftProblem(observed, expected, label) {
  const unexpected = observed.filter((name) => !expected.includes(name));
  const missing = expected.filter((name) => !observed.includes(name));
  if (unexpected.length === 0 && missing.length === 0) return null;
  return `${label}: unexpected [${unexpected.join(', ')}]; missing [${missing.join(', ')}]`;
}

function packetPath(context) {
  return join(context.repoRoot, PACKAGE);
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  return (content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function lastToolResult(session, toolName) {
  return session
    .ofType('message_end')
    .map((record) => record.message)
    .filter((message) => message?.role === 'toolResult' && message.toolName === toolName)
    .at(-1);
}

function taskDescription(snapshot) {
  return snapshot.allTools.find((tool) => tool.name === 'task')?.description ?? '';
}

function offeredAgents(snapshot) {
  const section = taskDescription(snapshot).match(/Available agent types:\n([\s\S]*?)\n\n/);
  if (!section) return [];
  return section[1]
    .split('\n')
    .map((line) => line.replace(/^- /, '').split(':')[0].trim())
    .filter(Boolean);
}

function agentStorePath(agentDir) {
  const real = realpathSync(agentDir);
  const slug = `${basename(real).replace(/[^\w.-]+/g, '-')}-${createHash('sha256').update(real).digest('hex').slice(0, 8)}`;
  return join(agentDir, 'pstack', 'store', slug);
}

async function waitForObserver(path, predicate, description) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  for (;;) {
    if (existsSync(path)) {
      try {
        const snapshot = JSON.parse(readFileSync(path, 'utf8'));
        if (predicate(snapshot)) return snapshot;
      } catch {
        // snapshot file is mid-write; retry
      }
    }
    if (Date.now() > deadline) throw new Error(`Observer snapshot ${path} never satisfied ${description} within ${WAIT_TIMEOUT_MS}ms`);
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}

async function prepareChildAgentDir(context, name) {
  const agentDir = join(context.scratchDir, name);
  mkdirSync(join(agentDir, 'extensions'), { recursive: true });
  await copyFile(FIXTURE, join(agentDir, 'extensions', 'scripted-provider.mjs'));
  writeFileSync(join(agentDir, 'settings.json'), `${JSON.stringify({ extensions: ['extensions/scripted-provider.mjs'] }, null, 2)}\n`);
  return agentDir;
}

async function startObserved(context, name, options = {}) {
  const { env = {}, extraExtensions = [], ...rest } = options;
  const observerFile = join(context.rawDir, `observer-${name}.json`);
  const session = context.startSession({
    packagePath: packetPath(context),
    extraExtensions: [OBSERVER, ...extraExtensions],
    env: { PSTACK_OBSERVER_PATH: observerFile, ...env },
    ...rest,
  });
  const state = await session.state();
  const snapshot = await waitForObserver(observerFile, () => true, 'any snapshot');
  if (extraExtensions.includes(FIXTURE) && state.model?.provider !== 'pstack-verify') {
    await session.send({ type: 'set_model', provider: 'pstack-verify', modelId: 'scripted' });
  }
  return { session, snapshot, observerFile };
}

function discoverySets(context, commands, snapshot) {
  const rows = readRows(context.repoRoot);
  const packageRows = rows.filter((row) => row.package === PACKAGE);
  const bySource = (source) =>
    commands
      .filter((command) => command.source === source)
      .map((command) => command.name)
      .sort();
  const t1Names = (kind, prefix = '') =>
    packageRows
      .filter((row) => row.tier === 'T1' && row.kind === kind)
      .map((row) => `${prefix}${row.name}`)
      .sort();
  const packagePath = packetPath(context);
  return {
    extensionCommands: bySource('extension'),
    expectedCommands: packageRows
      .filter((row) => row.kind === 'command')
      .map(surfaceName)
      .filter((name) => !ENV_GATED_COMMANDS.has(name))
      .sort(),
    skillCommands: bySource('skill'),
    expectedSkills: t1Names('skill', 'skill:'),
    promptCommands: bySource('prompt'),
    expectedPrompts: t1Names('prompt-template'),
    builtinTools: snapshot.allTools
      .filter((tool) => (tool.sourceInfo?.path ?? '').startsWith('builtin:'))
      .map((tool) => tool.name)
      .sort(),
    packageTools: snapshot.allTools
      .filter((tool) => (tool.sourceInfo?.path ?? '').startsWith(packagePath))
      .map((tool) => tool.name)
      .sort(),
    expectedPackageTools: packageRows
      .filter((row) => row.kind === 'tool')
      .map(surfaceName)
      .filter((name) => !ENV_GATED_TOOLS.has(name))
      .sort(),
    unattributedTools: snapshot.allTools
      .filter((tool) => {
        const path = tool.sourceInfo?.path ?? '';
        return !path.startsWith('builtin:') && !path.startsWith(packagePath);
      })
      .map((tool) => `${tool.name} (${tool.sourceInfo?.path ?? 'unknown source'})`),
  };
}

function assertIsolatedDiscovery(context, commands, snapshot) {
  const sets = discoverySets(context, commands, snapshot);
  const problems = [
    driftProblem(sets.extensionCommands, sets.expectedCommands, 'extension commands'),
    driftProblem(sets.skillCommands, sets.expectedSkills, 'skills'),
    driftProblem(sets.promptCommands, sets.expectedPrompts, 'prompt templates'),
    driftProblem(sets.builtinTools, CORE_TOOLS, 'host builtin tools'),
    driftProblem(sets.packageTools, sets.expectedPackageTools, 'pi-pstack tools'),
    sets.unattributedTools.length > 0 ? `tools from outside the package and the host core set: ${sets.unattributedTools.join(', ')}` : null,
  ].filter(Boolean);
  assert.ok(problems.length === 0, `discovery isolation drifted: ${problems.join('; ')}`);
}

async function collectDiscovery(context) {
  const commandsSession = context.startSession({ packagePath: packetPath(context) });
  let commands;
  try {
    commands = await commandsSession.commands();
  } finally {
    await commandsSession.close();
  }
  const { session, snapshot, observerFile } = await startObserved(context, 'tools');
  try {
    assertIsolatedDiscovery(context, commands, snapshot);
  } finally {
    await session.close();
  }
  return { commands, snapshot, observerFile, commandsCapture: commandsSession.capturePath };
}

function writeDiscoveryReceipts(context, discovery) {
  const rows = drivenRows(context.repoRoot);
  const { commands, snapshot, observerFile, commandsCapture } = discovery;
  const extensionCommands = commands.filter((command) => command.source === 'extension');
  for (const row of rows.filter((candidate) => candidate.kind === 'command')) {
    const name = surfaceName(row);
    const command = extensionCommands.find((candidate) => candidate.name === name);
    context.receipts.assertVerdict({
      surfaceId: row.surface_id,
      package: PACKAGE,
      expected: row.expected,
      observed: command ? describeCommand(command) : `absent; extension commands observed: ${extensionCommands.map((candidate) => candidate.name).join(', ')}`,
      evidence: commandsCapture,
      scope: 'discovery',
      check: () => assert.ok(command, `command ${name} missing from the extension command set`),
    });
  }
  writeResourceReceipts(context, rows, commands, commandsCapture);
  writeToolReceipts(context, rows, snapshot, observerFile);
}

function writeResourceReceipts(context, rows, commands, evidence) {
  const groups = [
    { kind: 'skill', source: 'skill', prefix: 'skill:', label: 'skill command' },
    { kind: 'prompt-template', source: 'prompt', prefix: '', label: 'prompt template' },
  ];
  for (const group of groups) {
    const groupRows = rows.filter((row) => row.kind === group.kind);
    const observedCommands = commands.filter((command) => command.source === group.source);
    for (const row of groupRows) {
      const name = `${group.prefix}${row.name}`;
      const command = observedCommands.find((candidate) => candidate.name === name);
      context.receipts.assertVerdict({
        surfaceId: row.surface_id,
        package: PACKAGE,
        expected: row.expected,
        observed: command ? describeCommand(command) : `absent; ${group.label}s observed: ${observedCommands.map((candidate) => candidate.name).join(', ')}`,
        evidence,
        scope: 'discovery',
        check: () => assert.ok(command, `${group.label} ${name} missing`),
      });
    }
  }
}

function writeToolReceipts(context, rows, snapshot, observerFile) {
  for (const row of rows.filter((candidate) => candidate.kind === 'tool')) {
    const name = surfaceName(row);
    const tool = snapshot.allTools.find((candidate) => candidate.name === name);
    context.receipts.assertVerdict({
      surfaceId: row.surface_id,
      package: PACKAGE,
      expected: row.expected,
      observed: tool ? `${tool.name} in getActiveTools; exposure=${tool.exposure} description=${JSON.stringify(tool.description.slice(0, 90))}` : `absent from getActiveTools [${snapshot.activeTools.join(', ')}]`,
      evidence: observerFile,
      scope: 'discovery',
      check: () => {
        assert.ok(snapshot.activeTools.includes(name), `${name} not in pi.getActiveTools()`);
        assert.ok(tool, `${name} not in pi.getAllTools()`);
      },
    });
  }
}

function writeTaskAgentReceipt(context, session, name, index) {
  const details = lastToolResult(session, 'task')?.details;
  const observed = details ? `task toolResult: agent_type=${details.agent_type} status=${details.status} output=${JSON.stringify(String(details.detailedContent ?? '').slice(0, 60))}` : 'no task toolResult recorded';
  context.receipts.assertVerdict({
    surfaceId: `PS-AGENT-${String(index).padStart(2, '0')}`,
    package: PACKAGE,
    expected: 'Launches that persona in a child session',
    observed,
    evidence: session.capturePath,
    check: () => {
      assert.ok(details, `no task tool result for ${name}`);
      assert.equal(details.agent_type, name, 'child record reported a different agent_type');
      assert.equal(details.status, 'completed', 'child did not complete');
      assert.match(String(details.detailedContent), /scripted fixture reply/);
    },
  });
}

function writeRemAgentReceipt(context, session, observerFile, defaultSnapshot, offered) {
  const details = lastToolResult(session, 'task')?.details;
  const remOffered = offered.includes('rem-agent');
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-10',
    package: PACKAGE,
    expected: 'Enables rem-agent/rem launcher',
    observed: `COPILOT_SUBCONSCIOUS=1 offered agents: ${offered.join(', ')}`,
    evidence: observerFile,
    check: () => {
      assert.ok(remOffered, 'rem-agent was not offered with COPILOT_SUBCONSCIOUS=1');
    },
  });
  context.receipts.assertVerdict({
    surfaceId: 'PS-AGENT-08',
    package: PACKAGE,
    expected: 'Launches that persona in a child session',
    observed: `rem-agent offered under COPILOT_SUBCONSCIOUS=1: ${remOffered} (default session offered: ${offeredAgents(defaultSnapshot).join(', ')}); task toolResult: agent_type=${details?.agent_type} status=${details?.status}`,
    evidence: session.capturePath,
    check: () => {
      assert.ok(remOffered, 'rem-agent was not in the offered agent list');
      assert.equal(details?.agent_type, 'rem-agent', 'rem-agent child record missing');
      assert.equal(details?.status, 'completed', 'rem-agent child did not complete');
    },
  });
}

async function launchTaskAgents(context, defaultSnapshot) {
  const agentDir = await prepareChildAgentDir(context, 'agents-task');
  const eventsDir = join(agentDir, 'events');
  const { session, snapshot, observerFile } = await startObserved(context, 'agents-task', {
    agentDir,
    cwd: agentDir,
    extraExtensions: [FIXTURE],
    env: { COPILOT_SUBCONSCIOUS: '1', COPILOT_EVENTS_LOG_DIRECTORY: eventsDir },
  });
  try {
    for (const [index, name] of TASK_AGENTS.entries()) {
      await session.prompt(`LAUNCH_TASK:${name}`);
      writeTaskAgentReceipt(context, session, name, index + 1);
    }
    await session.prompt('LAUNCH_TASK:rem-agent');
    writeRemAgentReceipt(context, session, observerFile, defaultSnapshot, offeredAgents(snapshot));
    writeEventLogReceipt(context, eventsDir, session.capturePath);
  } finally {
    await session.close();
  }
}

function writeEventLogReceipt(context, eventsDir, capturePath) {
  const files = existsSync(eventsDir) ? readdirSync(eventsDir).filter((name) => name.endsWith('.jsonl')) : [];
  const events = files.flatMap((name) =>
    readFileSync(join(eventsDir, name), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
  const evidence = join(context.rawDir, 'subagent-events.jsonl');
  if (files.length > 0) copyFileSync(join(eventsDir, files[0]), evidence);
  context.receipts.assertVerdict({
    surfaceId: 'PS-ENV-14',
    package: PACKAGE,
    expected: 'Writes subagent events log',
    observed: `${files.length} event log file(s), ${events.length} events, types: ${[...new Set(events.map((event) => event.type))].join(', ')}`,
    evidence: files.length > 0 ? evidence : capturePath,
    check: () => {
      assert.ok(files.length > 0, 'no events log file was written');
      assert.ok(
        events.some((event) => event.type === 'subagent.started'),
        'no subagent.started event in the log',
      );
    },
  });
}

async function launchPersonaAgents(context) {
  const agentDir = join(context.scratchDir, 'agents-persona');
  mkdirSync(agentDir, { recursive: true });
  const { session } = await startObserved(context, 'agents-persona', { agentDir, cwd: agentDir, extraExtensions: [FIXTURE] });
  try {
    for (const name of PERSONA_AGENTS) {
      await session.prompt(`LAUNCH_PERSONA:${name}`);
      const details = lastToolResult(session, 'Task')?.details;
      context.receipts.assertVerdict({
        surfaceId: `PS-AGENT-${String(PERSONA_AGENTS.indexOf(name) + 9).padStart(2, '0')}`,
        package: PACKAGE,
        expected: 'Launches that persona in a child session',
        observed: details ? `Task toolResult: persona=${details.persona} status=${details.status} output=${JSON.stringify(String(details.output ?? '').slice(0, 60))}` : 'no Task toolResult recorded',
        evidence: session.capturePath,
        check: () => {
          assert.ok(details, `no Task tool result for ${name}`);
          assert.equal(details.persona, name, 'child record reported a different persona');
          assert.equal(details.status, 'settled', 'child did not settle');
          assert.match(String(details.output), /scripted fixture reply/);
        },
      });
    }
  } finally {
    await session.close();
  }
}

async function writeModelRule(context, agentDir) {
  const setup = context.startSession({ packagePath: packetPath(context), agentDir, cwd: agentDir, answers: setupAnswers() });
  try {
    await setup.prompt('/setup-pstack');
  } finally {
    await setup.close();
  }
}

async function hostContractAt(session, observerFile, prompt, predicate) {
  await session.prompt(prompt);
  const snapshot = await waitForObserver(observerFile, (candidate) => Boolean(candidate.systemPromptSections?.pstack_host) && predicate(candidate.systemPromptSections.pstack_host), 'a matching host contract section');
  return snapshot.systemPromptSections.pstack_host;
}

function writeModelRuleReceipts(context, { written, host, projectHost, observerFile, agentDir }) {
  context.receipts.assertVerdict({
    surfaceId: 'PS-CFG-1',
    package: PACKAGE,
    expected: 'Writes the per-role model rule; read at every before_agent_start',
    observed: `/setup-pstack wrote models.mdc with budget line ${JSON.stringify(written.match(/^# budget: .*/m)?.[0])}; before_agent_start pstack_host carried ${JSON.stringify(host.match(/feature, refactoring: .*/)?.[0])} and ${JSON.stringify(host.match(/# budget: .*/)?.[0])}`,
    evidence: observerFile,
    check: () => {
      assert.match(written, /^# budget: small \(medium\)$/m, 'written rule is missing the budget line');
      assert.match(written, /^feature, refactoring: auto$/m, 'written rule is missing the role table');
      assert.match(host, /feature, refactoring: auto/, 'host contract did not read the written rule');
      assert.match(host, /# budget: small \(medium\)/, 'host contract did not read the written budget');
    },
  });
  context.receipts.assertVerdict({
    surfaceId: 'PS-CFG-2',
    package: PACKAGE,
    expected: 'Project rule overrides the user rule for named roles',
    observed: `project rule bug-fix: inherit-parent replaced the user line; host carries ${JSON.stringify(projectHost.match(/bug-fix: .*/)?.[0])} and no ${JSON.stringify('bug-fix: auto')}`,
    evidence: observerFile,
    check: () => {
      assert.match(projectHost, /^bug-fix: inherit-parent$/m, 'project rule value is not in the host contract');
      assert.doesNotMatch(projectHost, /^bug-fix: auto$/m, 'user rule value was not overridden');
    },
  });
  const store = agentStorePath(agentDir);
  const realCwd = realpathSync(agentDir);
  context.receipts.assertVerdict({
    surfaceId: 'PS-CFG-8',
    package: PACKAGE,
    expected: 'Agent store for orchestrate state and default plans',
    observed: `host contract names ${JSON.stringify(projectHost.match(/Agent store: .*/)?.[0])}; derivation sha256(realpath(${agentDir})) = sha256(${realCwd}) -> ${store.split('/').at(-1)}`,
    evidence: observerFile,
    check: () => {
      assert.ok(projectHost.includes(`Agent store: ${store}.`), `host contract does not name the derived store ${store}`);
      assert.ok(projectHost.includes(`plans default to ${store}/docs/`), 'host contract does not name the default plans directory');
    },
  });
}

async function observeModelRule(context) {
  const agentDir = join(context.scratchDir, 'config-model-rule');
  mkdirSync(agentDir, { recursive: true });
  await writeModelRule(context, agentDir);
  const written = readFileSync(join(agentDir, 'pstack', 'models.mdc'), 'utf8');
  const { session, observerFile } = await startObserved(context, 'config-model-rule', { agentDir, cwd: agentDir, extraExtensions: [FIXTURE] });
  try {
    const host = await hostContractAt(session, observerFile, 'read the host contract', () => true);
    mkdirSync(join(agentDir, '.pi', 'pstack'), { recursive: true });
    writeFileSync(join(agentDir, '.pi', 'pstack', 'models.mdc'), 'bug-fix: inherit-parent\n');
    const projectHost = await hostContractAt(session, observerFile, 'read the host contract again', (text) => text.includes('inherit-parent'));
    writeModelRuleReceipts(context, { written, host, projectHost, observerFile, agentDir });
  } finally {
    await session.close();
  }
}

function setupAnswers() {
  return {
    select: (request) => {
      if (request.options?.includes('Accept as-is')) return 'Accept as-is';
      if (String(request.title ?? '').startsWith('pstack reasoning budget')) return SETUP_BUDGET;
      return 'auto';
    },
    input: () => 'auto',
    confirm: () => true,
  };
}

async function observePreferences(context) {
  const agentDir = join(context.scratchDir, 'config-prefs');
  mkdirSync(agentDir, { recursive: true });
  const writer = context.startSession({ packagePath: packetPath(context), agentDir, cwd: agentDir });
  try {
    await writer.prompt('/subagents disable explore');
  } finally {
    await writer.close();
  }
  const settingsPath = join(agentDir, 'settings.json');
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  const { session, snapshot } = await startObserved(context, 'config-prefs', { agentDir, cwd: agentDir });
  try {
    await session.prompt('/subagents');
    const shown = session.notifications.map((notification) => String(notification.message)).join('\n');
    context.receipts.assertVerdict({
      surfaceId: 'PS-CFG-3',
      package: PACKAGE,
      expected: 'Persists subagent preferences',
      observed: `${basename(settingsPath)} holds subagents.disabledSubagents=${JSON.stringify(settings.subagents?.disabledSubagents)}; next session's offered agents: ${offeredAgents(snapshot).join(', ')}; /subagents no longer lists ${JSON.stringify('explore')}`,
      evidence: session.capturePath,
      check: () => {
        assert.deepEqual(settings.subagents?.disabledSubagents, ['explore'], 'settings.json did not persist the disabled agent');
        assert.ok(!offeredAgents(snapshot).includes('explore'), 'explore still offered after the preference was written');
        assert.match(shown, /^general-purpose: /m, '/subagents rendered no agent lines');
        assert.doesNotMatch(shown, /^explore: /m, '/subagents still lists the disabled agent');
      },
    });
  } finally {
    await session.close();
  }
}

async function observeCustomAgentDiscovery(context) {
  const agentDir = join(context.scratchDir, 'config-discovery');
  mkdirSync(join(agentDir, 'agents'), { recursive: true });
  writeFileSync(join(agentDir, 'agents', 'probe-agent.md'), '---\nname: probe-agent\ndescription: Probe agent dropped by the discovery drive.\n---\nYou are a probe.\n');
  const { session, snapshot, observerFile } = await startObserved(context, 'config-discovery', { agentDir, cwd: agentDir });
  try {
    await session.prompt('/subagents');
    const shown = session.notifications.map((notification) => String(notification.message)).join('\n');
    context.receipts.assertVerdict({
      surfaceId: 'PS-CFG-10',
      package: PACKAGE,
      expected: 'Custom agents appear in Task and `/subagents`',
      observed: `task tool description custom section carried ${JSON.stringify(taskDescription(snapshot).match(/Custom agents provided by the user:\n?- probe-agent[^\n]*/)?.[0] ?? 'nothing')}; /subagents rendered ${JSON.stringify(shown.match(/^probe-agent.*$/m)?.[0] ?? '')}`,
      evidence: observerFile,
      check: () => {
        assert.match(taskDescription(snapshot), /Custom agents provided by the user:\n- probe-agent: Probe agent dropped by the discovery drive\./, 'custom agent missing from the task tool description');
        assert.match(shown, /^probe-agent: /m, 'custom agent missing from /subagents output');
      },
    });
  } finally {
    await session.close();
  }
}

async function observeBoard(context) {
  const agentDir = join(context.scratchDir, 'config-board');
  mkdirSync(agentDir, { recursive: true });
  const { session } = await startObserved(context, 'config-board', { agentDir, cwd: agentDir, extraExtensions: [FIXTURE] });
  try {
    await session.prompt('BOARD_WRITE:probe-key=probe-value');
    const real = realpathSync(agentDir);
    const boardFile = join(agentDir, 'context-boards', `${createHash('sha1').update(real).digest('hex').slice(0, 16)}.json`);
    const board = JSON.parse(readFileSync(boardFile, 'utf8'));
    const evidence = join(context.rawDir, 'context-board.json');
    copyFileSync(boardFile, evidence);
    context.receipts.assertVerdict({
      surfaceId: 'PS-CFG-9',
      package: PACKAGE,
      expected: 'Durable per-cwd facts',
      observed: `context_board write created ${basename(boardFile)} holding ${JSON.stringify(board)}`,
      evidence,
      check: () => {
        assert.equal(board['probe-key'], 'probe-value', 'context board did not persist the written fact');
      },
    });
  } finally {
    await session.close();
  }
}

async function observeWorkflowFlag(context, defaultSnapshot) {
  const { session, snapshot, observerFile } = await startObserved(context, 'env-workflows', { env: { COPILOT_DYNAMIC_WORKFLOWS: '1' } });
  try {
    context.receipts.assertVerdict({
      surfaceId: 'PS-ENV-9',
      package: PACKAGE,
      expected: 'Enables the three workflow tools',
      observed: `COPILOT_DYNAMIC_WORKFLOWS=1 active tools include [${WORKFLOW_TOOLS.join(', ')}]; default session active tools ${defaultSnapshot.activeTools.includes(WORKFLOW_TOOLS[0]) ? 'also include them' : 'exclude them'}`,
      evidence: observerFile,
      check: () => {
        for (const tool of WORKFLOW_TOOLS) assert.ok(snapshot.activeTools.includes(tool), `${tool} not active with the flag set`);
        for (const tool of WORKFLOW_TOOLS) assert.ok(!defaultSnapshot.activeTools.includes(tool), `${tool} active without the flag`);
      },
    });
  } finally {
    await session.close();
  }
}

async function observeHeadless(context, row) {
  const on = await startObserved(context, 'env-headless-on', { extraExtensions: [FIXTURE], env: { PI_PSTACK_HEADLESS: '1' } });
  let onResult;
  let onDialogs;
  try {
    await on.session.prompt('ASK_QUESTION_PROBE');
    onResult = lastToolResult(on.session, 'AskQuestion');
    onDialogs = on.session.dialogs.filter((dialog) => dialog.request.method === 'select').length;
  } finally {
    await on.session.close();
  }
  const off = await startObserved(context, 'env-headless-off', { extraExtensions: [FIXTURE] });
  try {
    await off.session.prompt('ASK_QUESTION_PROBE');
    const offResult = lastToolResult(off.session, 'AskQuestion');
    const offDialogs = off.session.dialogs.filter((dialog) => dialog.request.method === 'select').length;
    context.receipts.write({
      surfaceId: row.surface_id,
      package: PACKAGE,
      expected: row.expected,
      verdict: 'env-limited',
      observed: `PI_PSTACK_HEADLESS=1: AskQuestion isError=${onResult?.isError} text=${JSON.stringify(messageText(onResult))} with ${onDialogs} select dialog(s); unset: isError=${offResult?.isError} with ${offDialogs} select dialog(s) answered ${JSON.stringify(messageText(offResult))}`,
      evidence: on.session.capturePath,
      reason: 'The AskQuestion suppression half is observed directly. The TUI follow-up delivery half (deliver.ts:16) requires ctx.mode === "tui"; RPC mode cannot exercise it.',
    });
  } finally {
    await off.session.close();
  }
}

async function assertIsolationOptIn(context, isolatedSnapshot) {
  const expected = readRows(context.repoRoot)
    .filter((row) => row.package === PACKAGE && row.kind === 'command')
    .map(surfaceName)
    .filter((name) => !ENV_GATED_COMMANDS.has(name))
    .sort();
  const { session, snapshot } = await startObserved(context, 'global-opt-in', { allowGlobalExtensions: true });
  try {
    const names = (await session.commands())
      .filter((command) => command.source === 'extension')
      .map((command) => command.name)
      .sort();
    const extras = names.filter((name) => !expected.includes(name));
    const isolatedNames = new Set(isolatedSnapshot.allTools.map((tool) => tool.name));
    const extraTools = snapshot.allTools.filter((tool) => !isolatedNames.has(tool.name)).map((tool) => `${tool.name} (${tool.sourceInfo?.path ?? 'unknown source'})`);
    writeFileSync(join(context.rawDir, 'global-extension-commands.json'), `${JSON.stringify({ names, extras, extraTools }, null, 2)}\n`);
    assert.ok(extras.length > 0 || extraTools.length > 0, 'allowGlobalExtensions: true surfaced nothing beyond the package (opt-in path may be broken)');
  } finally {
    await session.close();
  }
}

function writeUndriven(context) {
  const written = new Set(context.receipts.receipts().map((receipt) => receipt.surface_id));
  const evidence = join(context.rawDir, 'undriven.json');
  const undriven = [];
  for (const row of drivenRows(context.repoRoot)) {
    if (written.has(row.surface_id)) continue;
    const reason = UNDRIVEN_REASONS[row.surface_id];
    if (!reason) throw new Error(`No receipt and no documented reason for ${row.surface_id}`);
    undriven.push({ surface_id: row.surface_id, reason });
    context.receipts.write({ surfaceId: row.surface_id, package: PACKAGE, expected: row.expected, observed: `no live observation; ${reason}`, verdict: 'not-drivable', reason, evidence });
  }
  writeFileSync(evidence, `${JSON.stringify(undriven, null, 2)}\n`);
}

export default async function pstackDiscovery(context) {
  const discovery = await collectDiscovery(context);
  writeDiscoveryReceipts(context, discovery);
  await assertIsolationOptIn(context, discovery.snapshot);
  await launchTaskAgents(context, discovery.snapshot);
  await launchPersonaAgents(context);
  await observeModelRule(context);
  await observePreferences(context);
  await observeCustomAgentDiscovery(context);
  await observeBoard(context);
  await observeWorkflowFlag(context, discovery.snapshot);
  await observeHeadless(
    context,
    drivenRows(context.repoRoot).find((row) => row.surface_id === 'PS-ENV-1'),
  );
  writeUndriven(context);
  context.log(`✓ pstack-discovery wrote ${context.receipts.receipts().length} receipts`);
}
