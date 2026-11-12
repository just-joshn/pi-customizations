#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildDependencyManifest } from '../adapters/dependencies.ts';

const { values } = parseArgs({ options: { root: { type: 'string' }, check: { type: 'boolean' } } });
const root = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const manifest = buildDependencyManifest(root);

const problems = [
  ...manifest.unknown.map((h) => `${h.file}:${h.line}: unknown Cursor dependency or primitive "${h.text}"`),
  ...manifest.unresolved.map((r) => `${r.file}:${r.line}: reference "${r.target}" does not resolve in the vendored source`),
];

if (!values.check) {
  mkdirSync(join(root, 'generated'), { recursive: true });
  writeFileSync(join(root, 'generated/dependency-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

const totals = {};
for (const skill of manifest.skills) for (const [id, n] of Object.entries(skill.primitives)) totals[id] = (totals[id] ?? 0) + n;
for (const agent of manifest.agents) for (const [id, n] of Object.entries(agent.primitives)) totals[id] = (totals[id] ?? 0) + n;
console.log(`skills: ${manifest.counts.primary} primary, ${manifest.counts.principle} principle, ${manifest.counts.playbooks} playbooks, ${manifest.counts.agents} agents`);
console.log(`team-kit required: ${manifest.requiredTeamKit.map((s) => `${s.name} (by ${s.requiredBy.join(', ')})`).join('; ')}`);
console.log(
  `primitives: ${Object.entries(totals)
    .sort()
    .map(([id, n]) => `${id}=${n}`)
    .join(' ')}`,
);
for (const problem of problems) console.error(problem);
if (problems.length) {
  console.error(`${problems.length} dependency problem(s)`);
  process.exitCode = 1;
} else {
  console.log('dependencies: ok');
}
