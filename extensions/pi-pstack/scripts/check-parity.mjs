#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { buildRecords, loadInputs } from './parity-lib.mjs';
import { KEEPS } from '../adapters/cursor-to-pi.ts';
import { extractReferences } from '../adapters/dependencies.ts';
import { listFiles, toPosix } from '../adapters/provenance.ts';
import { applySpans, compile, frontmatterProblems, replacedRanges, residualHits, unkeptResiduals } from '../adapters/skill-transforms.ts';

const { values } = parseArgs({ options: { root: { type: 'string' } } });
const root = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const problems = [];
const fail = (message) => problems.push(message);
const read = (path) => readFileSync(join(root, path), 'utf8');

const lock = JSON.parse(read('generated/upstream-lock.json'));
if (existsSync(join(root, 'requirements/requirements.json'))) for (const problem of buildRecords(root, loadInputs(root)).problems) fail(problem);
else fail('requirements/requirements.json: missing');
const pinned = JSON.parse(read('package.json')).pstackSource;
if (pinned.revision !== lock.revision) fail(`package.json pstackSource.revision ${pinned.revision} differs from generated/upstream-lock.json ${lock.revision}`);
if (!existsSync(join(root, 'generated/source-review-log.json'))) fail('generated/source-review-log.json: missing; move the pin with scripts/sync-upstream.mjs');
else {
  const { entries } = JSON.parse(read('generated/source-review-log.json'));
  entries.forEach((entry, index) => {
    if (index > 0 && entry.from !== entries[index - 1].to) fail(`source-review-log entry ${index}: from ${entry.from} does not continue from ${entries[index - 1].to}`);
    if (entry.contentChanged && !(entry.review?.reviewer && entry.review?.notes && entry.changedFiles.length)) fail(`source-review-log entry ${index}: a content change to ${entry.to} has no recorded parity review`);
  });
  if (entries.at(-1)?.to !== lock.revision) fail(`source-review-log ends at ${entries.at(-1)?.to}, not the locked revision ${lock.revision}: the pin moved without scripts/sync-upstream.mjs`);
}

let compiled;
try {
  compiled = compile(root);
} catch (error) {
  fail(error.message);
}

const manifest = JSON.parse(read('generated/transformation-manifest.json'));
const generatedSkills = listFiles(join(root, 'generated/skills')).map((f) => f.split('/')[0]);
const skillNames = [...new Set(generatedSkills)].sort();
const deps = JSON.parse(read('generated/dependency-manifest.json'));

const expect = (label, actual, wanted) => {
  if (actual !== wanted) fail(`${label}: expected ${wanted}, found ${actual}`);
};
expect('primary skills', skillNames.filter((n) => deps.skills.some((s) => s.name === n && s.origin === 'pstack' && s.kind === 'primary')).length, 34);
expect('principle skills', skillNames.filter((n) => n.startsWith('principle-')).length, 24);
expect('playbooks', listFiles(join(root, 'generated/skills/poteto-mode/playbooks')).filter((f) => f.endsWith('.md')).length, 23);
expect('upstream agent roles', ['poteto.md', 'comment-sicko.md'].filter((f) => existsSync(join(root, 'generated/agents', f))).length, 2);
expect('general role', existsSync(join(root, 'generated/agents/general.md')), true);

const required = deps.skills.filter((s) => s.required);
expect(
  'generated skill set',
  skillNames.join(','),
  required
    .map((s) => s.name)
    .sort()
    .join(','),
);
for (const skill of required) {
  for (const file of skill.files) if (!existsSync(join(root, 'generated/skills', skill.name, file))) fail(`generated/skills/${skill.name}/${file}: supporting file missing`);
}

if (compiled) {
  const expected = new Map(compiled.outputs.map((o) => [o.path, o]));
  const onDisk = ['skills', 'agents', 'prompts'].flatMap((d) => listFiles(join(root, 'generated', d)).map((f) => `generated/${d}/${f}`));
  for (const path of onDisk) if (!expected.has(path)) fail(`${path}: not produced by the compile (stale output)`);
  for (const [path, output] of expected) {
    if (!existsSync(join(root, path))) {
      fail(`${path}: missing; run scripts/compile-skills.mjs`);
      continue;
    }
    const want = output.text ?? readFileSync(join(root, output.source));
    if (!readFileSync(join(root, path)).equals(Buffer.from(want))) fail(`${path}: differs from a fresh compile; run scripts/compile-skills.mjs`);
  }
}

const spansBySource = new Map();
for (const span of manifest.spans) spansBySource.set(span.file, [...(spansBySource.get(span.file) ?? []), span]);
const residuals = [];
for (const [source, spans] of spansBySource) {
  const output = spans[0].output;
  try {
    if (applySpans(read(source), spans) !== read(output)) fail(`${output}: manifest spans do not reproduce the generated file`);
  } catch (error) {
    fail(error.message);
  }
}
const outputSource = new Map();
for (const skill of required)
  for (const file of skill.files) outputSource.set(`generated/skills/${skill.name}/${file}`, `${skill.origin === 'pstack' ? 'vendor/upstream-pstack' : 'vendor/upstream-cursor-team-kit'}/skills/${skill.name}/${file}`);
outputSource.set('generated/agents/poteto.md', 'vendor/upstream-pstack/agents/poteto-agent.md');
outputSource.set('generated/agents/comment-sicko.md', 'vendor/upstream-pstack/agents/comment-sicko.md');
for (const [output, source] of outputSource) {
  if (!existsSync(join(root, output)) || !/\.(md|sh|mjs|ts)$/.test(output)) continue;
  const text = read(output);
  residuals.push(...residualHits(text, source, output, replacedRanges(spansBySource.get(source) ?? [])));
  if (output.endsWith('.md')) {
    const skillDir = output.startsWith('generated/skills/') ? join(root, output.split('/').slice(0, 3).join('/')) : join(root, 'generated/agents');
    for (const ref of extractReferences(text, output, join(root, output), skillDir)) {
      if (!ref.resolved) fail(`${output}:${ref.line}: reference "${ref.target}" does not resolve`);
      else if (!toPosix(relative(root, ref.resolved)).startsWith('generated/')) fail(`${output}:${ref.line}: reference "${ref.target}" leaves the generated package`);
    }
  }
}
for (const problem of unkeptResiduals(residuals, KEEPS)) fail(problem);

for (const name of skillNames) {
  const text = read(`generated/skills/${name}/SKILL.md`);
  for (const problem of frontmatterProblems(text, name, `generated/skills/${name}/SKILL.md`)) fail(problem);
  const invocable = !/^user-invocable:\s*false\s*$/m.test(text.split('\n---\n')[0]);
  if (invocable && !existsSync(join(root, 'generated/prompts', `${name}.md`))) fail(`generated/prompts/${name}.md: missing prompt alias for /${name}`);
}
for (const prompt of listFiles(join(root, 'generated/prompts'))) {
  if (!skillNames.includes(prompt.replace(/\.md$/, ''))) fail(`generated/prompts/${prompt}: no skill of that name`);
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(`parity: ${problems.length} problem(s)`);
  process.exitCode = 1;
} else {
  console.log(
    `parity: ok (${skillNames.length} skills: 34 primary, 24 principle, ${skillNames.length - 58} team-kit; 23 playbooks; 3 roles; ${listFiles(join(root, 'generated/prompts')).length} prompts; ${manifest.counts.rules} rules, ${manifest.counts.spans} spans)`,
  );
}
