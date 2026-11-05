#!/usr/bin/env node
// Usage: build-inventory.mjs <plugins-checkout> <pi-pstack-dir> <audit-dir> <out-dir>
// Builds the behavior inventory from the reference tree. Every reference file gets a row; skills, agents, rules,
// automation files, and scripts get behavior rows with stable IDs; host mechanisms come from host-dispositions.json.
// Fails when an evidence pointer names a repository file that does not exist.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const [plugins, pi, audit, out] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const yaml = await import(join(repo, 'extensions/pi-pstack/node_modules/yaml/dist/index.js'));

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const treeDiff = JSON.parse(readFileSync(join(audit, 'tree-diff.json'), 'utf8'));
const hunks = JSON.parse(readFileSync(join(audit, 'adaptation-hunks.json'), 'utf8')).hunks;
const hostRefs = JSON.parse(readFileSync(join(here, 'host-references.json'), 'utf8')).byMechanism;
const dispositions = JSON.parse(readFileSync(join(here, 'host-dispositions.json'), 'utf8'));
const statusOf = new Map(treeDiff.rows.map((row) => [`${row.plugin}/${row.file}`, row]));

function frontmatter(path) {
  const text = readFileSync(path, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match ? (yaml.parse(match[1]) ?? {}) : {};
}

function mechanismsFor(prefix) {
  const found = new Set();
  for (const [id, list] of Object.entries(hostRefs)) if (list.some((entry) => entry.startsWith(prefix))) found.add(id);
  return [...found].sort();
}

function adaptation(prefix) {
  const files = treeDiff.rows.filter((row) => `${row.plugin}/${row.file}`.startsWith(prefix));
  const changed = files.filter((row) => row.status === 'changed').map((row) => `${row.plugin}/${row.file}`);
  const absent = files.filter((row) => row.status === 'absent').map((row) => `${row.plugin}/${row.file}`);
  const labels = new Set(hunks.filter((hunk) => changed.includes(hunk.file)).flatMap((hunk) => hunk.labels));
  return { files: files.length, identical: files.length - changed.length - absent.length, changed, absent, hunkLabels: [...labels].sort() };
}

const behaviors = [];
const SKILL_E2E = 'pi-e2e: test/e2e/skills-catalog.e2e.test.ts (body attaches through /name in real Pi)';
const knownMechanisms = new Set(dispositions.mechanisms.map((m) => m.id));
for (const id of Object.keys(hostRefs)) {
  if (!knownMechanisms.has(id)) {
    console.error(`Unknown mechanism ID in host-references.json: ${id}`);
    process.exit(1);
  }
}

for (const plugin of ['pstack', 'cursor-team-kit']) {
  const skillsDir = join(plugins, plugin, 'skills');
  for (const name of readdirSync(skillsDir).sort()) {
    const file = join(skillsDir, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const fm = frontmatter(file);
    const piFile = join(pi, 'skills', name, 'SKILL.md');
    const adapt = adaptation(`${plugin}/skills/${name}/`);
    const hidden = fm['disable-model-invocation'] === true;
    const mechanisms = mechanismsFor(`${plugin}/skills/${name}/`);
    behaviors.push({
      id: `SKILL-${plugin === 'pstack' ? 'PSTACK' : 'TEAMKIT'}-${name}`,
      kind: 'skill',
      feature: name,
      purpose: fm.description,
      trigger: hidden ? `/${name} anywhere in a message, or another skill's instructions (disable-model-invocation)` : `/${name}, or the model loads it when the request matches`,
      preconditions: plugin === 'pstack' ? 'pstack installed' : 'cursor-team-kit installed (pi-pstack vendors it)',
      source: { path: `${plugin}/skills/${name}/SKILL.md`, sha256: sha(file), revision: 'bb68f2365eceafa0cb2d253112f675acf5f144cc' },
      frontmatterKeys: Object.keys(fm).sort(),
      hostMechanisms: mechanisms,
      dependencyCallChain: mechanisms,
      inputs: "The user's message; files and tools the instructions name",
      stateTransitions: 'Skill reference resolved -> <skill> block prepended -> model executes workflow steps',
      execution: 'Instruction-driven: the model follows the attached text. Host mechanisms below carry the runtime behavior.',
      outputs: 'The skill body attached to one message (or to every turn in a mode)',
      errors: 'An unreadable skill file is not attached',
      executionModes: 'Interactive TUI, RPC, print, and JSON modes',
      cursorMechanism: 'Plugin skill catalog, selectedSkills, findSkillReferences',
      piEquivalent: existsSync(piFile) ? `extensions/pi-pstack/skills/${name}/SKILL.md through Pi's skill loader and the /name input transform` : 'absent',
      existingPiBehavior: existsSync(piFile) ? 'Loaded as a Pi skill and attached by /name' : 'absent',
      divergence: adapt.changed.length === 0 ? 'none (byte-identical)' : 'host-translated paths, tool names, and model spec syntax',
      piState: adapt,
      verification: [SKILL_E2E, 'parity: tree-diff.mjs and classify-adaptations.mjs over the reference'],
      status: existsSync(piFile) ? (adapt.changed.length === 0 ? 'verified' : 'verified-with-host-translation') : 'gap:absent',
    });
  }
}

for (const [plugin, dir] of [
  ['pstack', 'agents'],
  ['cursor-team-kit', 'agents'],
]) {
  for (const name of readdirSync(join(plugins, plugin, dir)).sort()) {
    const file = join(plugins, plugin, dir, name);
    const fm = frontmatter(file);
    const adapt = adaptation(`${plugin}/${dir}/${name}`);
    const mechanisms = mechanismsFor(`${plugin}/${dir}/${name}`);
    behaviors.push({
      id: `AGENT-${String(fm.name ?? name.replace(/\.md$/, ''))}`,
      kind: 'agent',
      feature: `subagent_type ${fm.name}`,
      purpose: fm.description,
      trigger: `Task with subagent_type "${fm.name}"`,
      preconditions: 'Task tool active (depth < 2, non-explore parent)',
      frontmatter: fm,
      source: { path: `${plugin}/${dir}/${name}`, sha256: sha(file), revision: 'bb68f2365eceafa0cb2d253112f675acf5f144cc' },
      hostMechanisms: mechanisms,
      dependencyCallChain: ['HOST-AGENT-DEFS', 'HOST-TASK', ...mechanisms],
      inputs: 'Task prompt, description, optional model, readonly, run_in_background, environment, file_attachments',
      stateTransitions: 'Task call -> child pi --mode rpc spawned with pstack_subagent and pstack_agent sections -> foreground result or background completion notice',
      outputs: 'Subagent final response, Agent ID, transcript path, and optional worktree branch',
      errors: 'Unknown subagent_type or invalid model fails before spawn with allowed list',
      executionModes: 'Foreground or background child RPC session',
      cursorMechanism: "Plugin agents: name, description, model, readonly/permissionMode, is_background/background; body is the agent's instructions",
      piEquivalent: `extensions/pi-pstack/agents/${name}: listed in pstack_subagents, body in the child's pstack_agent section`,
      existingPiBehavior: 'Loaded by loadAgentDefinitions and injected into child system prompt',
      divergence: adapt.changed.length === 0 ? 'none (byte-identical)' : 'host-translated skill package path',
      piState: adapt,
      verification: ['pi-unit: test/task-agents.test.ts', 'pi-e2e: test/e2e/task.e2e.test.ts', 'pi-e2e: test/e2e/host.e2e.test.ts'],
      status: adapt.changed.length === 0 ? 'verified' : 'verified-with-host-translation',
    });
  }
}

for (const name of readdirSync(join(plugins, 'cursor-team-kit/rules')).sort()) {
  const id = name.replace(/\.mdc$/, '');
  behaviors.push({
    id: `RULE-${id}`,
    kind: 'rule',
    feature: `always-applied rule ${name}`,
    purpose: frontmatter(join(plugins, 'cursor-team-kit/rules', name)).description,
    trigger: 'Every request (alwaysApply: true), or /' + id,
    preconditions: 'pi-pstack extension loaded',
    source: { path: `cursor-team-kit/rules/${name}`, sha256: sha(join(plugins, 'cursor-team-kit/rules', name)), revision: 'bb68f2365eceafa0cb2d253112f675acf5f144cc' },
    hostMechanisms: ['HOST-RULES-ALWAYS'],
    dependencyCallChain: ['HOST-RULES-ALWAYS'],
    inputs: `skills/${id}/SKILL.md body`,
    stateTransitions: 'before_agent_start reads rule body -> injects into pstack_host system prompt section',
    outputs: 'Exact rule body present in pstack_host on every request',
    errors: 'Missing skill file is skipped cleanly',
    executionModes: 'All Pi modes (interactive, RPC, print, JSON, subagents)',
    cursorMechanism: 'Plugin rules with alwaysApply',
    piEquivalent: 'Rule body injected verbatim into pstack_host on every request and exposed as a skill',
    existingPiBehavior: 'Injected verbatim into pstack_host',
    divergence: 'none',
    verification: ['pi-unit: test/sections.test.ts RULE-001'],
    status: 'verified',
  });
}

const automationFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else automationFiles.push(path);
  }
};
walk(join(plugins, 'pstack/automations'));
for (const path of automationFiles.sort()) {
  const rel = relative(join(plugins, 'pstack'), path);
  const row = statusOf.get(`pstack/${rel}`);
  const mechanisms = mechanismsFor(`pstack/${rel}`);
  behaviors.push({
    id: `BENNY-${rel
      .replace(/^automations\/benny\//, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/-md$|-yaml$/, '')}`,
    kind: 'automation',
    feature: rel,
    purpose: 'Benny Slack issue triage and reproduction automation pack resource',
    trigger: 'Setup through FOR_AGENTS.md, then hosted automation triggers (Slack report, schedule)',
    preconditions: 'Target repository checkout, Slack MCP server, tracker integration, control adapter',
    source: { path: `pstack/${rel}`, sha256: sha(path), revision: 'bb68f2365eceafa0cb2d253112f675acf5f144cc' },
    hostMechanisms: mechanisms,
    dependencyCallChain: ['HOST-AUTOMATIONS', 'HOST-SUBSCRIPTIONS', ...mechanisms],
    inputs: 'Slack report coordinates, configuration YAML, feature map, routing map, ledger',
    stateTransitions: 'Pack copied to .pi/automations/benny -> subscriptions armed -> timer sweep or webhook routine claims report in ledger.tsv -> Task run',
    outputs: 'Thread-only Slack verdict or repro/draft PR update',
    errors: 'Fails closed without posting when coordinates, triage marker, control adapter, or credential isolation are missing',
    executionModes: 'Long-running interactive/RPC owner session or new_session detached fires',
    cursorMechanism: 'Cursor Automations created with /automate; Slack trigger; operational SKILL.md files read directly',
    piEquivalent: 'The same files under .pi/automations/benny, run by subscribe_timer sweeps or subscribe_webhook routines',
    existingPiBehavior: 'Adapted to Pi subscriptions, ledger.tsv, and explicit credential-isolation checks',
    divergence: 'Hosted Slack trigger and Cursor Automations editor are replaced by local timer sweeps or webhook routines',
    piState: { status: row?.status ?? 'absent', changed: row?.status === 'changed' ? [`pstack/${rel}`] : [] },
    verification: ['parity: classify-adaptations.mjs hunks', 'pi-e2e: test/e2e/subscription-owner.e2e.test.ts (subscription runtime only)'],
    status: 'gap:runtime-limitation (hosted Slack trigger and automation service; live Slack not exercised)',
  });
}

const scripts = [
  [
    'SCRIPT-watch-pr',
    'pstack/skills/poteto-mode/scripts/watch-pr',
    'Poll GitHub PR checks, reviews, and mergeability for babysit and shipping',
    'bun watch-pr <pr>',
    "pi-unit: test/scripts.test.ts (the scripts' own bun suite, 61 tests, and --help)",
  ],
  [
    'SCRIPT-check-plan',
    'pstack/skills/poteto-mode/scripts/check-plan.mjs',
    'Validate multi-phase plan structure, prose rules, and verification boxes',
    'node check-plan.mjs <plan.md>',
    "pi-unit: test/scripts.test.ts; the multi-phase-plan skeleton passes its program gate, and the port's former read fallback failed it (.audit/pstack-parity-2026-11-05/plan-fallback-check.txt)",
  ],
  [
    'SCRIPT-worktree-audit',
    'pstack/skills/poteto-mode/scripts/worktree-audit.sh',
    'Audit git worktrees by size, merge state, dirty state, PR status, and recent chat transcripts',
    'bash worktree-audit.sh [-b <ref>] [repo]',
    'pi-unit: test/scripts.test.ts WTA-001 (Pi transcript paths)',
  ],
  [
    'SCRIPT-bootstrap',
    'pstack/skills/poteto-mode/scripts/bootstrap.ts',
    'Install commander dependency for watch-pr from frozen lockfile on first run',
    'Imported by watch-pr/cli.ts',
    'pi-unit: test/scripts.test.ts (dependency install before the suite)',
  ],
  [
    'SCRIPT-log-sh',
    'pstack/skills/show-me-your-work/scripts/log.sh',
    'Append a sanitized TSV decision row to a show-me-your-work log',
    'bash log.sh <logfile> <phase> <decision> <why> <evidence> <result>',
    "pi-unit: test/scripts.test.ts; this run's decisions.tsv",
  ],
  [
    'SCRIPT-statechart',
    'pstack/skills/statechart/scripts',
    'Compile TLA+ specifications and TLC state graphs into statechart Mermaid diagrams and reports',
    'skills/statechart/scripts/statechart <SPEC.tla>',
    'statechart node suite from the package: 367 of 367 with TLA2TOOLS set (.audit/pstack-parity-2026-11-05/statechart-tests-with-tlc.txt), and a TLC run whose chart.mmd and report.md equal the Counter corpus',
  ],
  [
    'SCRIPT-pr-review-canvas-renderer',
    'cursor-team-kit/skills/pr-review-canvas/renderer.js',
    'Render categorized PR diffs with move and whitespace detection in the PR review HTML page',
    'Loaded by pr-review-canvas template.html in browser',
    'pi-unit: test/resources.test.ts (byte-identical to cursor-team-kit)',
  ],
];
for (const [id, path, purpose, trigger, evidence] of scripts) {
  const adapt = adaptation(path);
  behaviors.push({
    id,
    kind: 'script',
    feature: path,
    purpose,
    trigger,
    preconditions: 'Node, Bun, bash, git, and (for statechart TLC runs) Java',
    source: { path, revision: 'bb68f2365eceafa0cb2d253112f675acf5f144cc' },
    hostMechanisms: mechanismsFor(path),
    dependencyCallChain: mechanismsFor(path),
    inputs: 'CLI arguments, environment variables, and target files or git repository',
    stateTransitions: 'Script invoked -> parses args -> reads repo/files/transcripts -> writes stdout/artifacts -> exits with status code',
    outputs: 'Formatted stdout report, exit code, or generated artifacts',
    errors: 'Non-zero exit code (1 or 2) with diagnostic message on stderr',
    executionModes: 'Direct CLI execution from bash or bash_background',
    cursorMechanism: 'Bundled skill script run via Shell tool',
    piEquivalent: `Bundled script under extensions/pi-pstack/${path.replace(/^(?:pstack|cursor-team-kit)\//, '')}`,
    existingPiBehavior: 'Bundled and executable from the package',
    divergence: adapt.changed.length === 0 ? 'none (byte-identical)' : 'worktree-audit.sh scans Pi session and subagent transcript folders',
    piState: adapt,
    verification: [evidence],
    status: 'verified',
  });
}

for (const mechanism of dispositions.mechanisms) {
  behaviors.push({
    kind: 'host-mechanism',
    purpose: mechanism.feature,
    trigger: 'Skill instructions, user slash command, or model tool call',
    preconditions: 'pi-pstack extension loaded in Pi 1.5.0',
    source: { repository: 'cursor-agent 2026.10.22-27dcf5f + cursor/plugins bb68f2365eceafa0cb2d253112f675acf5f144cc' },
    dependencyCallChain: [mechanism.id],
    inputs: mechanism.cursor,
    stateTransitions: `${mechanism.cursor} -> ${mechanism.pi}`,
    outputs: mechanism.pi,
    errors: mechanism.difference ?? 'none',
    executionModes: 'Interactive, RPC, print, JSON, and subagent modes as applicable',
    cursorMechanism: mechanism.cursor,
    piEquivalent: mechanism.pi,
    existingPiBehavior: mechanism.pi,
    divergence: mechanism.difference ?? 'none',
    verification: mechanism.evidence,
    referencedBy: hostRefs[mechanism.id] ?? [],
    ...mechanism,
  });
}

const missing = [];
for (const behavior of behaviors) {
  for (const item of [...(behavior.verification ?? []), ...(behavior.evidence ?? [])]) {
    const match = /(?:pi-unit|pi-e2e): (test\/[^\s(;,]+)/.exec(item);
    if (match) {
      const base = match[1].replace(/\*$/, '');
      const ok = base.includes('*') || existsSync(join(pi, base)) || readdirSync(join(pi, dirname(base))).some((name) => join(dirname(base), name).startsWith(base));
      if (!ok) missing.push(`${behavior.id}: ${match[1]}`);
    }
  }
}
if (missing.length > 0) {
  console.error(`Evidence paths that do not exist:\n${missing.join('\n')}`);
  process.exit(1);
}

const counts = {};
for (const behavior of behaviors) {
  const key = `${behavior.kind}:${String(behavior.status).split(' ')[0]}`;
  counts[key] = (counts[key] ?? 0) + 1;
}
writeFileSync(join(out, 'inventory.json'), `${JSON.stringify({ generatedBy: 'build-inventory.mjs', counts, behaviors }, null, 2)}\n`);

const cell = (value) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
const lines = ['# Behavior inventory', '', 'Generated by `build-inventory.mjs` from the pinned reference. `inventory.json` holds every field.', '', '## Counts', '', '| Kind and status | Rows |', '| --- | --- |'];
for (const [key, value] of Object.entries(counts).sort()) lines.push(`| ${key} | ${value} |`);
lines.push('', '## Host mechanisms', '', '| ID | Feature | Status | Difference |', '| --- | --- | --- | --- |');
for (const behavior of behaviors.filter((row) => row.kind === 'host-mechanism')) lines.push(`| ${behavior.id} | ${cell(behavior.feature)} | ${cell(behavior.status)} | ${cell(behavior.difference ?? '')} |`);
lines.push('', '## Skills, agents, rules, scripts, automation files', '', '| ID | Status | Host mechanisms | Changed files |', '| --- | --- | --- | --- |');
for (const behavior of behaviors.filter((row) => row.kind !== 'host-mechanism'))
  lines.push(`| ${behavior.id} | ${cell(behavior.status)} | ${cell((behavior.hostMechanisms ?? []).join(', '))} | ${cell((behavior.piState?.changed ?? []).length)} |`);
writeFileSync(join(out, 'inventory.md'), `${lines.join('\n')}\n`);
console.log(JSON.stringify(counts));
