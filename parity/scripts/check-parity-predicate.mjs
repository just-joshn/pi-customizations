#!/usr/bin/env node
/**
 * Gate for tip ↔ pi-pstack parity inventory.
 *
 * Tip skills root resolution (first hit wins):
 *   1. PSTACK_TIP_SKILLS — absolute path to a tip skills directory
 *   2. TIP_SKILLS_CANDIDATES below
 *   3. Newest hash under ~/.cursor/plugins/cache/cursor-public/pstack
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PI_PSTACK = join(REPO_ROOT, 'extensions/pi-pstack');
const PI_SKILLS = join(PI_PSTACK, 'skills');

const SOFT_DEPS = ['deslop', 'control-cli', 'control-ui', 'create-skill', 'no-comments', 'benchmark-checklist'];
const FORBIDDEN_UPSTREAM = ['upstream.lock.json', 'scripts/sync-upstream.mjs', 'docs/harness'];
const HOST_TOOL_FILES = {
  Task: 'src/task/tool.ts',
  TodoWrite: 'src/todo.ts',
  AskQuestion: 'src/ask.ts',
  visualize: 'src/visualize.ts',
  subscribe_github_pr: 'src/subscriptions/index.ts',
  subscribe_timer: 'src/subscriptions/index.ts',
  subscribe_webhook: 'src/subscriptions/index.ts',
  Loop: 'src/loop.ts',
};
const CREATE_SKILL_MIN_BYTES = 12 * 1024;
const DURABLE_ARTIFACTS = [
  'src/subscriptions/durable-store.ts',
  'src/subscriptions/supervisor.ts',
  'src/subscriptions/supervisor-main.ts',
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
  const fromEnv = process.env['PSTACK_TIP_SKILLS'];
  if (typeof fromEnv === 'string' && fromEnv !== '' && existsSync(fromEnv)) return fromEnv;
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

function check(name, ok, detail) {
  return { name, ok, detail };
}

function runChecks() {
  const failures = [];
  const checks = [];

  const tipRoot = resolveTipSkillsRoot();
  if (tipRoot === null) {
    const result = check('tip-skills-inventory', false, 'no tip skills root found under PSTACK_TIP_SKILLS, /tmp/cursor-plugins-rea, or installed cache');
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
    const missing = [];
    for (const [tool, rel] of Object.entries(HOST_TOOL_FILES)) {
      const path = join(PI_PSTACK, rel);
      if (!existsSync(path)) {
        missing.push(`${tool} (missing ${rel})`);
        continue;
      }
      const text = readFileSync(path, 'utf8');
      if (!text.includes(`name: '${tool}'`)) missing.push(`${tool} in ${rel}`);
    }
    const supervisorBin = join(PI_PSTACK, 'bin/pstack-routines-supervisor');
    const binOk = existsSync(supervisorBin);
    const binText = binOk ? readFileSync(supervisorBin, 'utf8') : '';
    const binMentionsMain = binText.includes('supervisor-main');
    const ok = missing.length === 0 && binOk && binMentionsMain;
    const parts = [];
    if (missing.length > 0) parts.push(`registration missing: ${missing.join(', ')}`);
    if (!binOk) parts.push('missing bin/pstack-routines-supervisor');
    else if (!binMentionsMain) parts.push('bin does not mention supervisor-main');
    if (ok) parts.push(`registered ${Object.keys(HOST_TOOL_FILES).join(', ')}; durable supervisor bin targets supervisor-main`);
    const result = check('host-tools-registered', ok, parts.join('; '));
    checks.push(result);
    if (!result.ok) failures.push(result.name);
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
