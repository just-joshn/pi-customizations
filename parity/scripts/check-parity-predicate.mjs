#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PI_PSTACK = join(REPO_ROOT, 'extensions/pi-pstack');
const PI_SKILLS = join(PI_PSTACK, 'skills');
const PI_SRC = join(PI_PSTACK, 'src');

const SOFT_DEPS = ['deslop', 'control-cli', 'control-ui', 'create-skill', 'no-comments', 'benchmark-checklist'];
const FORBIDDEN_UPSTREAM = ['upstream.lock.json', 'scripts/sync-upstream.mjs', 'docs/harness'];
const HOST_TOOLS = ['Task', 'TodoWrite', 'AskQuestion', 'visualize', 'subscribe_github_pr', 'subscribe_timer', 'subscribe_webhook', 'Loop'];
const CREATE_SKILL_MIN_BYTES = 12 * 1024;
const DURABLE_ARTIFACTS = [
  'src/subscriptions/durable-store.ts',
  'src/subscriptions/supervisor.ts',
  'src/subscriptions/ensure-supervisor.ts',
  'bin/pstack-routines-supervisor',
];

const TIP_SKILLS_CANDIDATES = [
  '/tmp/cursor-plugins-rea/pstack/skills',
  '/Users/josh-desktop/.cursor/plugins/cache/cursor-public/pstack/1ba91fc25c0977741dd0e267849e6234b037ed0a/skills',
];

function skillDirs(skillsRoot) {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function resolveTipSkillsRoot() {
  for (const candidate of TIP_SKILLS_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  const cacheRoot = '/Users/josh-desktop/.cursor/plugins/cache/cursor-public/pstack';
  if (!existsSync(cacheRoot)) return null;
  for (const hash of readdirSync(cacheRoot).toSorted()) {
    const skills = join(cacheRoot, hash, 'skills');
    if (existsSync(skills)) return skills;
  }
  return null;
}

function collectSrcText(dir) {
  const chunks = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) chunks.push(collectSrcText(path));
    else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      chunks.push(readFileSync(path, 'utf8'));
    }
  }
  return chunks.join('\n');
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

function runChecks() {
  const failures = [];
  const checks = [];

  const tipRoot = resolveTipSkillsRoot();
  if (tipRoot === null) {
    const result = check('tip-skills-inventory', false, 'no tip skills root found under /tmp/cursor-plugins-rea or installed cache');
    checks.push(result);
    failures.push(result.name);
  } else {
    const tipSkills = skillDirs(tipRoot);
    const missing = tipSkills.filter((name) => !existsSync(join(PI_SKILLS, name)));
    const result = check(
      'tip-skills-inventory',
      missing.length === 0,
      missing.length === 0
        ? `${tipSkills.length} tip skills present under extensions/pi-pstack/skills (source: ${tipRoot})`
        : `missing under extensions/pi-pstack/skills: ${missing.join(', ')} (source: ${tipRoot})`,
    );
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  {
    const missing = SOFT_DEPS.filter((name) => !existsSync(join(PI_SKILLS, name)));
    const result = check(
      'soft-deps-present',
      missing.length === 0,
      missing.length === 0 ? `all soft-deps present: ${SOFT_DEPS.join(', ')}` : `missing soft-deps: ${missing.join(', ')}`,
    );
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  {
    const present = FORBIDDEN_UPSTREAM.filter((rel) => existsSync(join(PI_PSTACK, rel)));
    const result = check(
      'no-upstream-sync-machinery',
      present.length === 0,
      present.length === 0
        ? `absent: ${FORBIDDEN_UPSTREAM.join(', ')}`
        : `forbidden paths still present: ${present.join(', ')}`,
    );
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  {
    if (!existsSync(PI_SRC)) {
      const result = check('host-tools-registered', false, `missing src tree: ${PI_SRC}`);
      checks.push(result);
      failures.push(result.name);
    } else {
      const srcText = collectSrcText(PI_SRC);
      const missingMentions = HOST_TOOLS.filter((tool) => !srcText.includes(tool));
      const supervisorBin = join(PI_PSTACK, 'bin/pstack-routines-supervisor');
      const binOk = existsSync(supervisorBin);
      const ok = missingMentions.length === 0 && binOk;
      const parts = [];
      if (missingMentions.length > 0) parts.push(`src missing mentions: ${missingMentions.join(', ')}`);
      if (!binOk) parts.push('missing bin/pstack-routines-supervisor');
      if (ok) parts.push(`src mentions ${HOST_TOOLS.join(', ')}; durable supervisor bin exists`);
      const result = check('host-tools-registered', ok, parts.join('; '));
      checks.push(result);
      if (!result.ok) failures.push(result.name);
    }
  }

  {
    const skillPath = join(PI_SKILLS, 'create-skill/SKILL.md');
    if (!existsSync(skillPath)) {
      const result = check('create-skill-depth', false, 'extensions/pi-pstack/skills/create-skill/SKILL.md missing');
      checks.push(result);
      failures.push(result.name);
    } else {
      const size = statSync(skillPath).size;
      const result = check(
        'create-skill-depth',
        size > CREATE_SKILL_MIN_BYTES,
        size > CREATE_SKILL_MIN_BYTES
          ? `SKILL.md is ${size} bytes (> ${CREATE_SKILL_MIN_BYTES})`
          : `SKILL.md is ${size} bytes; need > ${CREATE_SKILL_MIN_BYTES}`,
      );
      checks.push(result);
      if (!result.ok) failures.push(result.name);
    }
  }

  {
    const missing = DURABLE_ARTIFACTS.filter((rel) => !existsSync(join(PI_PSTACK, rel)));
    const result = check(
      'durable-artifacts',
      missing.length === 0,
      missing.length === 0 ? `present: ${DURABLE_ARTIFACTS.join(', ')}` : `missing: ${missing.join(', ')}`,
    );
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  return { checks, failures };
}

const { checks, failures } = runChecks();
const pass = failures.length === 0;
const lines = [
  `parity-predicate: ${pass ? 'PASS' : 'FAIL'}`,
  ...checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`),
];
if (!pass) lines.push(`named failures: ${failures.join(', ')}`);
process.stdout.write(`${lines.join('\n')}\n`);
process.exitCode = pass ? 0 : 1;
