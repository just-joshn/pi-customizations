#!/usr/bin/env node
// The map is the contract. Every node it names is either shipped as exactly one artifact below,
// or listed in the report as out of scope with a reason. A node the map adds fails until it is claimed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const map = JSON.parse(readFileSync(join(root, 'skill-map.json'), 'utf8'));

const PLAYBOOK_ORIGIN = 'pstack playbook · not a slash skill';
const PORTABLE_FRONTMATTER = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'disable-model-invocation']);

// Cursor CLI features. Pi has no CLI to route them to, so four ship as Pi skills and the rest do not ship.
const PI_COMPANION_SKILLS = ['cli-automate', 'cli-create-skill', 'cli-goal', 'cli-loop'];

const BOARD_ARTIFACTS = {
  'decision-log': 'skills/show-me-your-work/references/decision-log-template.tsv',
};

const UNSHIPPED_BOARDS = {
  models: 'written into the user agent directory by setup-pstack at run time',
  'local-verifier': 'generated inside the target project by create-verification-skill',
  'formal-verifier': 'generated inside the target project by create-formal-verification-skill',
  forge: 'GitHub or Origin delivery state, read at run time',
  'benny-config': 'state of the dormant upstream Benny pack',
  'benny-slack': 'state of the dormant upstream Benny pack',
};

const SCRIPT_ARTIFACTS = {
  worker: 'skills/poteto-mode/worker.md',
  'watch-pr': 'skills/poteto-mode/scripts/watch-pr',
  'audit-worktree': 'skills/poteto-mode/scripts/worktree-audit.sh',
};

// The map labels this lane `Comment Sicko`, a display name rather than the shipped filename.
const LANE_AGENTS = { 'agent-comment': 'comment-sicko' };

const HOST_TOKENS = ['~/.cursor', 'generalPurpose', 'SendToUser', 'tmux_', 'alwaysApply: true', '/visualize'];

function withoutSlash(label) {
  return label.replace(/^\//, '');
}

function shipKind(node) {
  if (node.kind === 'public') return 'skill';
  if (node.kind === 'lane') return 'agent';
  if (node.kind === 'script') return 'script';
  if (node.kind === 'board') return BOARD_ARTIFACTS[node.id] ? 'board' : undefined;
  if (node.kind === 'step') return node.origin === PLAYBOOK_ORIGIN ? 'playbook' : undefined;
  if (node.kind !== 'external') return undefined;
  if (PI_COMPANION_SKILLS.includes(node.id)) return 'skill';
  if (!node.id.startsWith('kit-')) return undefined;
  if (node.id === 'kit-ci-watcher' || node.id === 'kit-quality-agent') return 'agent';
  if (node.id === 'kit-exhaustive-switch' || node.id === 'kit-no-inline-imports') return 'rule';
  return 'skill';
}

// The label decides the filename, not the id: `kit-quality-agent` ships as
// `thermo-nuclear-code-quality-review` and `kit-exhaustive-switch` as `typescript-exhaustive-switch`.
function artifactName(node, kind) {
  if (kind === 'agent') return LANE_AGENTS[node.id] ?? withoutSlash(node.label);
  if (kind === 'playbook') return node.sublabel;
  if (kind === 'skill' || kind === 'rule') return withoutSlash(node.label);
  return undefined;
}

function artifactPath(node, kind) {
  if (kind === 'skill') return join('skills', artifactName(node, kind), 'SKILL.md');
  if (kind === 'agent') return join('agents', `${artifactName(node, kind)}.md`);
  if (kind === 'rule') return join('rules', `${artifactName(node, kind)}.md`);
  if (kind === 'playbook') return join('skills/poteto-mode/playbooks', `${artifactName(node, kind)}.md`);
  if (kind === 'script') return SCRIPT_ARTIFACTS[node.id];
  return BOARD_ARTIFACTS[node.id];
}

function unshippedReason(node) {
  if (node.kind === 'board') return UNSHIPPED_BOARDS[node.id];
  if (node.kind === 'step') return node.id.startsWith('benny-') ? 'step of the dormant upstream Benny pack' : 'navigation group in the board, not a file';
  if (node.kind === 'external') return node.id === 'cli' || node.id.startsWith('cli-') ? 'Cursor CLI feature with no counterpart in this package' : 'project-specific adapter for the dormant upstream Benny pack';
  return undefined;
}

const failures = [];
const shipped = [];
const unshipped = new Map();

for (const node of map.nodes) {
  const kind = shipKind(node);
  if (!kind) {
    const reason = unshippedReason(node);
    if (!reason) failures.push(`unclassified map node: ${node.id} (${node.kind})`);
    else unshipped.set(reason, [...(unshipped.get(reason) ?? []), node.id]);
    continue;
  }
  const path = artifactPath(node, kind);
  if (!path) {
    failures.push(`map node names no artifact path: ${node.id}`);
    continue;
  }
  if (!existsSync(join(root, path))) {
    failures.push(`missing artifact for ${node.id}: ${path}`);
    continue;
  }
  shipped.push({ node, kind, path });
}

function namesOf(kind) {
  return new Set(shipped.filter((s) => s.kind === kind).map((s) => artifactName(s.node, s.kind)));
}

function listFiles(dir, suffix) {
  return existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((name) => name.endsWith(suffix) && statSync(join(root, dir, name)).isFile()) : [];
}

const claimed = {
  skills: namesOf('skill'),
  agents: namesOf('agent'),
  rules: namesOf('rule'),
  playbooks: namesOf('playbook'),
};

const onDisk = {
  skills: new Set(readdirSync(join(root, 'skills')).filter((name) => statSync(join(root, 'skills', name)).isDirectory())),
  agents: new Set(listFiles('agents', '.md').map((name) => name.replace(/\.md$/, ''))),
  rules: new Set(listFiles('rules', '.md').map((name) => name.replace(/\.md$/, ''))),
  playbooks: new Set(listFiles('skills/poteto-mode/playbooks', '.md').map((name) => name.replace(/\.md$/, ''))),
};

for (const surface of Object.keys(claimed)) {
  const missing = [...claimed[surface]].filter((name) => !onDisk[surface].has(name));
  const extra = [...onDisk[surface]].filter((name) => !claimed[surface].has(name));
  if (missing.length) failures.push(`${surface} claimed by the map but absent from disk: ${missing.join(', ')}`);
  if (extra.length) failures.push(`${surface} on disk that no map node claims: ${extra.join(', ')}`);
}

// Only the files the package publishes. `skills/poteto-mode/scripts/node_modules` holds vendored
// dependencies that `npm pack` drops, so their markdown is not the package's to answer for.
function shippedMarkdown() {
  const found = [];
  for (const surface of ['skills', 'agents', 'rules']) {
    for (const entry of readdirSync(join(root, surface), { recursive: true })) {
      const path = join(surface, entry);
      if (entry.endsWith('.md') && !entry.split('/').some((segment) => segment === 'node_modules' || segment.startsWith('.')) && statSync(join(root, path)).isFile()) found.push(path);
    }
  }
  return found;
}

const markdown = shippedMarkdown();
for (const path of markdown) {
  const host = HOST_TOKENS.find((token) => readFileSync(join(root, path), 'utf8').includes(token));
  if (host) failures.push(`${path} names a Cursor host mechanism: ${host}`);
}

function frontmatterKeys(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  return match ? [...match[1].matchAll(/^([A-Za-z0-9_-]+):/gm)].map((m) => m[1]) : null;
}

for (const { node, path } of shipped.filter((s) => s.kind === 'skill')) {
  const text = readFileSync(join(root, path), 'utf8');
  const keys = frontmatterKeys(text);
  if (!keys) {
    failures.push(`missing frontmatter: ${path}`);
    continue;
  }
  if (!keys.includes('description')) failures.push(`frontmatter missing a description: ${path}`);
  const name = text.match(/^name:\s*(.+)$/m)?.[1];
  if (name !== withoutSlash(node.label)) failures.push(`${path} declares name ${name}, the map says ${withoutSlash(node.label)}`);
  const nonPortable = keys.filter((key) => !PORTABLE_FRONTMATTER.has(key));
  if (nonPortable.length) failures.push(`non-portable frontmatter in ${path}: ${nonPortable.join(', ')}`);
}

function read(relative) {
  return readFileSync(join(root, relative), 'utf8');
}

for (const marker of ['# defaults: 3', '# budget:']) {
  if (!read('skills/setup-pstack/SKILL.md').includes(marker)) failures.push(`setup-pstack never writes the map's models board marker: ${marker}`);
}

const teamKitSkills = new Set(shipped.filter((s) => s.kind === 'skill' && s.node.kind === 'external').map((s) => artifactName(s.node, s.kind)));
const called = [...new Set(read('skills/poteto-mode/SKILL.md').match(/\/skill:[a-z0-9-]+/g) ?? [])].map((s) => s.replace('/skill:', '')).sort();
const conditional = called.filter((name) => teamKitSkills.has(name));
const named = ['control-cli', 'control-ui', 'deslop'];
if (conditional.join(',') !== named.join(',')) failures.push(`poteto-mode names Team Kit skills ${conditional.join(', ') || 'none'}, the map names ${named.join(', ')}`);

if (failures.length) {
  throw new Error(failures.join('\n'));
}

console.info(
  JSON.stringify(
    {
      mapNodes: map.nodes.length,
      shippedNodes: shipped.length,
      unshippedNodes: [...unshipped.values()].flat().length,
      unshippedByReason: Object.fromEntries([...unshipped].map(([reason, ids]) => [reason, ids.length])),
      skills: claimed.skills.size,
      agents: claimed.agents.size,
      rules: claimed.rules.size,
      playbooks: claimed.playbooks.size,
      markdownScanned: markdown.length,
      scripts: shipped.filter((s) => s.kind === 'script').length,
      boards: shipped.filter((s) => s.kind === 'board').length,
      ok: true,
    },
    null,
    2,
  ),
);
