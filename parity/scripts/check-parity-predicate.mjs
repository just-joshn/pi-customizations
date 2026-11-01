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
const DURABLE_ARTIFACTS = ['src/subscriptions/durable-store.ts', 'src/subscriptions/supervisor.ts', 'src/subscriptions/supervisor-main.ts', 'src/subscriptions/ensure-supervisor.ts', 'bin/pstack-routines-supervisor'];

const TIP_SKILLS_CANDIDATES = ['/tmp/cursor-plugins-rea/pstack/skills', '/Users/josh-desktop/.cursor/plugins/cache/cursor-public/pstack/1ba91fc25c0977741dd0e267849e6234b037ed0a/skills'];

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
      missing.length === 0 ? `${tipSkills.length} tip skills present under extensions/pi-pstack/skills (source: ${tipRoot})` : `missing under extensions/pi-pstack/skills: ${missing.join(', ')} (source: ${tipRoot})`,
    );
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  {
    const missing = SOFT_DEPS.filter((name) => !existsSync(join(PI_SKILLS, name)));
    const result = check('soft-deps-present', missing.length === 0, missing.length === 0 ? `all soft-deps present: ${SOFT_DEPS.join(', ')}` : `missing soft-deps: ${missing.join(', ')}`);
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  {
    const present = FORBIDDEN_UPSTREAM.filter((rel) => existsSync(join(PI_PSTACK, rel)));
    const result = check('no-upstream-sync-machinery', present.length === 0, present.length === 0 ? `absent: ${FORBIDDEN_UPSTREAM.join(', ')}` : `forbidden paths still present: ${present.join(', ')}`);
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
      const result = check('create-skill-depth', size > CREATE_SKILL_MIN_BYTES, size > CREATE_SKILL_MIN_BYTES ? `SKILL.md is ${size} bytes (> ${CREATE_SKILL_MIN_BYTES})` : `SKILL.md is ${size} bytes; need > ${CREATE_SKILL_MIN_BYTES}`);
      checks.push(result);
      if (!result.ok) failures.push(result.name);
    }
  }

  {
    const missing = DURABLE_ARTIFACTS.filter((rel) => !existsSync(join(PI_PSTACK, rel)));
    const result = check('durable-artifacts', missing.length === 0, missing.length === 0 ? `present: ${DURABLE_ARTIFACTS.join(', ')}` : `missing: ${missing.join(', ')}`);
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  {
    const reports = [join(REPO_ROOT, 'parity/pstack-software-architecture-reconstruction.md'), join(PI_PSTACK, 'docs/parity-reverse-engineering.md')];
    const requiredIds = [
      'ev_bf12ac9c3d463df579c1009ce80a874431c3cc14c168a783114077161d704139',
      'ev_5068b39b821b4f8848661475ed4d4e141343d183785cd0d1f48cc4c560700b24',
      'ev_2c98abedf7c1c05212d64174a87f0039f79218f72f4b0f1def35f6f3c2327ac9',
      'ev_6fe43d2bbfab36c6763a2d1e940ee728fdbbe2ad2abb9162f70c102ccab8860f',
    ];
    const missing = [];
    for (const reportPath of reports) {
      if (!existsSync(reportPath)) {
        missing.push(`missing ${reportPath}`);
        continue;
      }
      const text = readFileSync(reportPath, 'utf8');
      for (const id of requiredIds) {
        if (!text.includes(id)) missing.push(`${reportPath} missing ${id}`);
      }
    }
    const result = check('rea-architecture-reports', missing.length === 0, missing.length === 0 ? 'both architecture reconstruction reports present with REA Evidence IDs' : missing.join('; '));
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  {
    const modeSrc = readFileSync(join(PI_PSTACK, 'src/mode.ts'), 'utf8');
    const ruleSrc = readFileSync(join(PI_PSTACK, 'src/rule.ts'), 'utf8');
    const runnerSrc = readFileSync(join(PI_PSTACK, 'src/task/runner.ts'), 'utf8');
    const recordsSrc = readFileSync(join(PI_PSTACK, 'src/task/records.ts'), 'utf8');
    const toolSrc = readFileSync(join(PI_PSTACK, 'src/task/tool.ts'), 'utf8');
    const subSrc = readFileSync(join(PI_PSTACK, 'src/subscriptions/index.ts'), 'utf8');
    const storeSrc = readFileSync(join(PI_PSTACK, 'src/subscriptions/durable-store.ts'), 'utf8');
    const pkgJson = JSON.parse(readFileSync(join(PI_PSTACK, 'package.json'), 'utf8'));
    const gaps = [];
    if (!modeSrc.includes('stripFrontmatter')) gaps.push('mode.ts missing stripFrontmatter');
    if (!ruleSrc.includes('stripFrontmatter')) gaps.push('rule.ts missing stripFrontmatter');
    if (!runnerSrc.includes('detectSupportedImageMimeTypeFromFile') || runnerSrc.includes('IMAGE_TYPES')) gaps.push('runner.ts not using detectSupportedImageMimeTypeFromFile');
    if (!recordsSrc.includes('parseSessionEntries')) gaps.push('records.ts missing parseSessionEntries');
    if (!toolSrc.includes('registerMessageRenderer')) gaps.push('task/tool.ts missing registerMessageRenderer');
    if (!subSrc.includes('registerMessageRenderer')) gaps.push('subscriptions/index.ts missing registerMessageRenderer');
    if (!storeSrc.includes('export function drainInbox')) gaps.push('durable-store.ts missing drainInbox');
    if (!Array.isArray(pkgJson.files) || !pkgJson.files.includes('src')) gaps.push('package.json missing files array');
    const result = check(
      'pi-native-mechanisms',
      gaps.length === 0,
      gaps.length === 0 ? 'stripFrontmatter, detectSupportedImageMimeTypeFromFile, parseSessionEntries, registerMessageRenderer, drainInbox, and package.json files verified' : gaps.join('; '),
    );
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  return { checks, failures };
}

const { checks, failures } = runChecks();
const pass = failures.length === 0;
const lines = [`parity-predicate: ${pass ? 'PASS' : 'FAIL'}`, ...checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`)];
if (!pass) lines.push(`named failures: ${failures.join(', ')}`);
process.stdout.write(`${lines.join('\n')}\n`);
process.exitCode = pass ? 0 : 1;
