#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PI_PSTACK = join(REPO_ROOT, 'extensions/pi-pstack');
const PI_SKILLS = join(PI_PSTACK, 'skills');

const PSTACK_SKILLS = [
  'architect',
  'arena',
  'automate-me',
  'benchmark-checklist',
  'blast-radius',
  'bro',
  'correct',
  'create-formal-verification-skill',
  'create-verification-skill',
  'figure-it-out',
  'how',
  'in-your-own-words',
  'interrogate',
  'ketchup',
  'ketchup-video',
  'maintain-formal-verification-skill',
  'maintain-verification-skill',
  'make-bot-ui',
  'no-comments',
  'poteto-help',
  'poteto-mode',
  'principle-attack-the-premise',
  'principle-boundary-discipline',
  'principle-build-the-lever',
  'principle-encode-lessons-in-structure',
  'principle-exhaust-the-design-space',
  'principle-experience-first',
  'principle-explain-the-number',
  'principle-fix-root-causes',
  'principle-foundational-thinking',
  'principle-guard-the-context-window',
  'principle-laziness-protocol',
  'principle-make-operations-idempotent',
  'principle-migrate-callers-then-delete-legacy-apis',
  'principle-minimize-reader-load',
  'principle-model-the-domain',
  'principle-never-block-on-the-human',
  'principle-outcome-oriented-execution',
  'principle-prove-it-works',
  'principle-redesign-from-first-principles',
  'principle-separate-before-serializing-shared-state',
  'principle-sequence-verifiable-units',
  'principle-subtract-before-you-add',
  'principle-test-behavior-not-implementation',
  'principle-type-system-discipline',
  'recall',
  'reflect',
  'setup-pstack',
  'sharpen',
  'show-me-your-work',
  'statechart',
  'swarm',
  'tdd',
  'teach',
  'technical-writing',
  'typescript-best-practices',
  'unslop',
  'why',
];

const TEAM_KIT_SKILLS = [
  'check-compiler-errors',
  'control-cli',
  'control-ui',
  'deslop',
  'fix-ci',
  'fix-merge-conflicts',
  'get-pr-comments',
  'loop-on-ci',
  'make-pr-easy-to-review',
  'new-branch-and-pr',
  'pr-review-canvas',
  'review-and-ship',
  'run-smoke-tests',
  'thermo-nuclear-code-quality-review',
  'verify-this',
  'weekly-review',
  'what-did-i-get-done',
  'workflow-from-chats',
];

const TEAM_KIT_RULES_AS_SKILLS = ['no-inline-imports', 'typescript-exhaustive-switch'];

const SOFT_DEPS = ['deslop', 'control-cli', 'control-ui', 'create-skill', 'no-comments', 'benchmark-checklist'];
const FORBIDDEN_UPSTREAM = ['upstream.lock.json', 'scripts/sync-upstream.mjs', 'scripts/patches.json', 'docs/harness'];
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

function skillDirs(skillsRoot) {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function walkRuntimeFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === '.audit' || entry.name === 'test' || entry.name === '.DS_Store') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkRuntimeFiles(full, out);
    else if (/\.(?:ts|mjs|js|json|md|sh|lock|yaml)$/.test(entry.name) || dir.endsWith('/bin') || dir.endsWith('/scripts')) out.push(full);
  }
  return out;
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

function runChecks() {
  const failures = [];
  const checks = [];

  {
    const expected = [...PSTACK_SKILLS, ...TEAM_KIT_SKILLS, ...TEAM_KIT_RULES_AS_SKILLS, 'create-skill'].toSorted();
    const present = skillDirs(PI_SKILLS);
    const missing = expected.filter((name) => !existsSync(join(PI_SKILLS, name, 'SKILL.md')));
    const countsOk = PSTACK_SKILLS.length === 58 && TEAM_KIT_SKILLS.length === 18 && TEAM_KIT_RULES_AS_SKILLS.length === 2;
    const ok = countsOk && missing.length === 0 && present.length === expected.length;
    const result = check(
      'standalone-skills-inventory',
      ok,
      ok ? `${present.length} self-contained skills present under extensions/pi-pstack/skills (58 pstack + 18 team-kit skills + 2 team-kit rules + create-skill)` : `missing or mismatched skills: ${missing.join(', ')}`,
    );
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  {
    const missing = SOFT_DEPS.filter((name) => !existsSync(join(PI_SKILLS, name, 'SKILL.md')));
    const result = check('soft-deps-present', missing.length === 0, missing.length === 0 ? `all soft-deps present: ${SOFT_DEPS.join(', ')}` : `missing soft-deps: ${missing.join(', ')}`);
    checks.push(result);
    if (!result.ok) failures.push(result.name);
  }

  {
    const present = FORBIDDEN_UPSTREAM.filter((rel) => existsSync(join(PI_PSTACK, rel)));
    const manifests = ['package.json', 'skills/poteto-mode/scripts/package.json', 'skills/statechart/scripts/package.json'];
    const badDeps = [];
    for (const rel of manifests) {
      const pkg = JSON.parse(readFileSync(join(PI_PSTACK, rel), 'utf8'));
      if (typeof pkg.name === 'string' && pkg.name.includes('cursor')) badDeps.push(`${rel} name ${pkg.name}`);
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const dep of Object.keys(pkg[field] ?? {})) {
          if (dep === 'pstack' || dep.includes('cursor')) badDeps.push(`${rel} ${field}.${dep}`);
        }
      }
    }
    const pluginPathPattern = /\.cursor\/plugins|\.cursor-plugin|@cursor-skill|cursor-public|cursor-plugins/i;
    const runtimeFiles = walkRuntimeFiles(PI_PSTACK);
    for (const file of runtimeFiles) {
      const text = readFileSync(file, 'utf8');
      if (pluginPathPattern.test(text)) badDeps.push(`plugin path ref in ${file.slice(PI_PSTACK.length + 1)}`);
    }
    const ok = present.length === 0 && badDeps.length === 0;
    const result = check(
      'zero-cursor-pstack-dependencies',
      ok,
      ok ? `0 Cursor pstack dependencies across ${manifests.length} manifests and ${runtimeFiles.length} runtime/shipped files; absent: ${FORBIDDEN_UPSTREAM.join(', ')}` : `violations: ${[...present, ...badDeps].join(', ')}`,
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
