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
for (const plugin of ['pstack', 'cursor-team-kit']) {
  const skillsDir = join(plugins, plugin, 'skills');
  for (const name of readdirSync(skillsDir).sort()) {
    const file = join(skillsDir, name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const fm = frontmatter(file);
    const piFile = join(pi, 'skills', name, 'SKILL.md');
    const adapt = adaptation(`${plugin}/skills/${name}/`);
    const hidden = fm['disable-model-invocation'] === true;
    behaviors.push({
      id: `SKILL-${plugin === 'pstack' ? 'PSTACK' : 'TEAMKIT'}-${name}`,
      kind: 'skill',
      feature: name,
      purpose: fm.description,
      trigger: hidden ? `/${name} anywhere in a message, or another skill's instructions (disable-model-invocation)` : `/${name}, or the model loads it when the request matches`,
      preconditions: plugin === 'pstack' ? 'pstack installed' : 'cursor-team-kit installed (pi-pstack vendors it)',
      source: { path: `${plugin}/skills/${name}/SKILL.md`, sha256: sha(file), revision: 'bb68f2365eceafa0cb2d253112f675acf5f144cc' },
      frontmatterKeys: Object.keys(fm).sort(),
      hostMechanisms: mechanismsFor(`${plugin}/skills/${name}/`),
      inputs: "The user's message; files and tools the instructions name",
      execution: 'Instruction-driven: the model follows the attached text. Host mechanisms below carry the runtime behavior.',
      outputs: 'The skill body attached to one message (or to every turn in a mode)',
      errors: 'An unreadable skill file is not attached',
      cursorMechanism: 'Plugin skill catalog, selectedSkills, findSkillReferences',
      piEquivalent: existsSync(piFile) ? `extensions/pi-pstack/skills/${name}/SKILL.md through Pi's skill loader and the /name input transform` : 'absent',
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
    behaviors.push({
      id: `AGENT-${String(fm.name ?? name.replace(/\.md$/, ''))}`,
      kind: 'agent',
      feature: `subagent_type ${fm.name}`,
      purpose: fm.description,
      trigger: `Task with subagent_type "${fm.name}"`,
      frontmatter: fm,
      source: { path: `${plugin}/${dir}/${name}`, sha256: sha(file) },
      cursorMechanism: "Plugin agents: name, description, model, readonly, is_background; body is the agent's instructions",
      piEquivalent: `extensions/pi-pstack/agents/${name}: listed in pstack_subagents, body in the child's pstack_agent section`,
      piState: adapt,
      verification: ['pi-unit: test/task-agents.test.ts', 'pi-e2e: test/e2e/task.e2e.test.ts', 'pi-e2e: test/e2e/host.e2e.test.ts'],
      status: adapt.changed.length === 0 ? 'verified' : 'verified-with-host-translation',
    });
  }
}

for (const name of readdirSync(join(plugins, 'cursor-team-kit/rules')).sort()) {
  behaviors.push({
    id: `RULE-${name.replace(/\.mdc$/, '')}`,
    kind: 'rule',
    feature: `always-applied rule ${name}`,
    purpose: frontmatter(join(plugins, 'cursor-team-kit/rules', name)).description,
    trigger: 'Every request (alwaysApply: true)',
    source: { path: `cursor-team-kit/rules/${name}`, sha256: sha(join(plugins, 'cursor-team-kit/rules', name)) },
    cursorMechanism: 'Plugin rules with alwaysApply',
    piEquivalent: 'Rule body injected verbatim into pstack_host on every request',
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
  behaviors.push({
    id: `BENNY-${rel
      .replace(/^automations\/benny\//, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/-md$|-yaml$/, '')}`,
    kind: 'automation',
    feature: rel,
    trigger: 'Setup through FOR_AGENTS.md, then hosted automation triggers (Slack report, schedule)',
    source: { path: `pstack/${rel}`, sha256: sha(path) },
    cursorMechanism: 'Cursor Automations created with /automate; Slack trigger; operational SKILL.md files read directly',
    piEquivalent: 'The same files under .pi/automations/benny, run by subscribe_timer sweeps or subscribe_webhook routines',
    piState: { status: row?.status ?? 'absent' },
    verification: ['parity: classify-adaptations.mjs hunks', 'pi-e2e: test/e2e/subscription-owner.e2e.test.ts (subscription runtime only)'],
    status: 'gap:runtime-limitation (hosted Slack trigger and automation service; live Slack not exercised)',
  });
}

const scripts = [
  ['SCRIPT-watch-pr', 'pstack/skills/poteto-mode/scripts/watch-pr', "pi-unit: test/scripts.test.ts (the scripts' own bun suite, 61 tests, and --help)"],
  [
    'SCRIPT-check-plan',
    'pstack/skills/poteto-mode/scripts/check-plan.mjs',
    "pi-unit: test/scripts.test.ts; the multi-phase-plan skeleton passes its program gate, and the port's former read fallback failed it (.audit/pstack-parity-2026-11-05/plan-fallback-check.txt)",
  ],
  ['SCRIPT-worktree-audit', 'pstack/skills/poteto-mode/scripts/worktree-audit.sh', 'pi-unit: test/scripts.test.ts WTA-001 (Pi transcript paths)'],
  ['SCRIPT-bootstrap', 'pstack/skills/poteto-mode/scripts/bootstrap.ts', 'pi-unit: test/scripts.test.ts (dependency install before the suite)'],
  ['SCRIPT-log-sh', 'pstack/skills/show-me-your-work/scripts/log.sh', "pi-unit: test/scripts.test.ts; this run's decisions.tsv"],
  [
    'SCRIPT-statechart',
    'pstack/skills/statechart/scripts',
    'statechart node suite from the package: 367 of 367 with TLA2TOOLS set (.audit/pstack-parity-2026-11-05/statechart-tests-with-tlc.txt), and a TLC run whose chart.mmd and report.md equal the Counter corpus',
  ],
];
for (const [id, path, evidence] of scripts) {
  behaviors.push({
    id,
    kind: 'script',
    feature: path,
    source: { path },
    piState: adaptation(path),
    verification: [evidence],
    status: 'verified',
  });
}

for (const mechanism of dispositions.mechanisms) {
  behaviors.push({ kind: 'host-mechanism', referencedBy: hostRefs[mechanism.id] ?? [], ...mechanism });
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
