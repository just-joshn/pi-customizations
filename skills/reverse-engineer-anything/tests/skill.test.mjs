import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { COMMANDS } from '../scripts/lib/commands.mjs';

const run = promisify(execFile);
const skillDir = fileURLToPath(new URL('..', import.meta.url));
const skillPath = fileURLToPath(new URL('../SKILL.md', import.meta.url));
const piDir = fileURLToPath(new URL('../../../extensions/pi-pstack/node_modules/@earendil-works/pi-coding-agent', import.meta.url));

const shippedFiles = () => {
  const files = ['SKILL.md'];
  for (const dir of ['scripts', 'references']) {
    const walk = (base) => {
      for (const entry of readdirSync(`${skillDir}/${base}`, { withFileTypes: true })) {
        const relative = `${base}/${entry.name}`;
        if (entry.isDirectory()) walk(relative);
        else files.push(relative);
      }
    };
    walk(dir);
  }
  return files;
};

test('INDEP-001: the shipped skill never reaches for the upstream project', async () => {
  const forbidden = [/rea-agents/, /npx\s+rea/, /mcp__/, /@earendil/, /require\(['"](?!\.(\/|\/)|node:)/, /from ['"](?!\.|node:)/, /open-binary|analyze-function|procedure-pseudo-code/];
  for (const file of shippedFiles()) {
    const text = readFileSync(`${skillDir}/${file}`, 'utf8');
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(text), `${file} must not reference ${pattern} in a shipped file`);
    }
  }
});

test('INDEP-002: the shipped skill can neither open a connection nor launch a process', async () => {
  const forbidden = new Set(['node:child_process', 'node:http', 'node:https', 'node:net', 'node:dns', 'node:tls', 'node:dgram', 'node:cluster', 'node:worker_threads', 'node:vm', 'node:repl']);
  for (const file of shippedFiles().filter((entry) => entry.endsWith('.mjs'))) {
    const text = readFileSync(`${skillDir}/${file}`, 'utf8');
    const specifiers = [...text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'|await import\(\s*'([^']+)'\s*\)/gm)].map((match) => match[1] ?? match[2]);
    for (const specifier of specifiers) {
      assert.ok(!forbidden.has(specifier), `${file} must not import ${specifier}`);
      assert.ok(specifier.startsWith('node:') || specifier.startsWith('.'), `${file} may only import node builtins and relative files, found ${specifier}`);
    }
    assert.ok(!/\bfetch\s*\(/.test(text), `${file} must not call fetch`);
  }
});

test('INDEP-003: production code does not read the parity evidence tree', async () => {
  for (const file of shippedFiles().filter((entry) => entry.startsWith('scripts/'))) {
    const text = readFileSync(`${skillDir}/${file}`, 'utf8');
    assert.ok(!/parity/.test(text), `${file} must not depend on development evidence`);
  }
});

const frontmatterOf = async (text) => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, 'SKILL.md must open with YAML frontmatter');
  return match[1];
};

test('SKILL-001: skill frontmatter is valid and the skill loads in Pi', async () => {
  const text = await readFile(skillPath, 'utf8');
  const frontmatter = await frontmatterOf(text);
  assert.match(frontmatter, /^name: reverse-engineer-anything$/m);
  assert.match(frontmatter, /^description: >-$/m);
  const { parseFrontmatter } = await import(pathToFileURL(`${piDir}/dist/index.js`).href);
  const parsed = parseFrontmatter(text);
  assert.equal(parsed.frontmatter.name, 'reverse-engineer-anything');
  assert.ok(parsed.frontmatter.description.length > 200 && parsed.frontmatter.description.length <= 1024, 'the description must route without being truncated');
  assert.equal(parsed.frontmatter.license, 'MIT');
  const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools', 'disable-model-invocation', 'disabled-environments']);
  for (const key of Object.keys(parsed.frontmatter)) assert.ok(allowed.has(key), `${key} is not a Pi skill field`);
  assert.ok(!('disable-model-invocation' in parsed.frontmatter), 'the skill must be selectable by the model');
  for (const reference of ['native-and-artifacts', 'javascript-applications', 'evidence-workflows', 'runtime-observation', 'connection-and-recovery']) {
    assert.ok(text.includes(`references/${reference}.md`), `SKILL.md must route to references/${reference}.md`);
    assert.ok(readFileSync(`${skillDir}/references/${reference}.md`, 'utf8').length > 500);
  }
});

test('SKILL-002: every documented command exists and accepts its documented flags', async () => {
  const documented = new Set();
  for (const file of ['SKILL.md', 'references/native-and-artifacts.md', 'references/javascript-applications.md', 'references/evidence-workflows.md', 'references/runtime-observation.md', 'references/connection-and-recovery.md']) {
    const text = readFileSync(`${skillDir}/${file}`, 'utf8');
    for (const match of text.matchAll(/rea\.mjs ([a-z-]+)/g)) documented.add(match[1]);
    for (const match of text.matchAll(/`([a-z][a-z-]{3,}) <[^`]+>`/g)) documented.add(match[1]);
  }
  const known = new Set([...COMMANDS.keys(), 'help']);
  for (const name of documented) assert.ok(known.has(name), `SKILL.md documents an unknown command: ${name}`);
  for (const name of [
    'analyze-javascript-application',
    'inspect-artifact',
    'inspect-binary-layout',
    'inspect-go-binary',
    'inspect-web-network-capture',
    'inspect-analysis-view',
    'record-unknown',
    'update-unknown',
    'list-unknowns',
    'evidence-export',
    'evidence-import',
    'route',
    'capabilities',
  ]) {
    assert.ok(documented.has(name), `the skill must document ${name}`);
  }
  const { stdout } = await run(process.execPath, [`${skillDir}/scripts/rea.mjs`, '--help']);
  for (const name of COMMANDS.keys()) assert.ok(stdout.includes(name), `--help must list ${name}`);
  const schema = await run(process.execPath, [`${skillDir}/scripts/rea.mjs`, 'analyze-javascript-application', '--schema']);
  assert.match(schema.stdout, /artifact-format/);
  const allText = readFileSync(`${skillDir}/SKILL.md`, 'utf8');
  for (const unavailable of ['analyze-function', 'procedure-pseudo-code', 'open-binary']) {
    assert.ok(!new RegExp(`rea\\.mjs ${unavailable}`).test(allText), `the skill must not document the unimplemented command ${unavailable}`);
  }
});

test('SKILL-003: description is the only always-loaded text', async () => {
  const text = await readFile(skillPath, 'utf8');
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  const { parseFrontmatter } = await import(pathToFileURL(`${piDir}/dist/index.js`).href);
  const parsed = parseFrontmatter(text);
  assert.ok(parsed.frontmatter.description.length < body.length, 'the description is shorter than the body');
  assert.ok(body.split('\n').length < 160, 'the body must stay readable in one pass');
  assert.ok(!body.includes('npm install'), 'the skill must not require an install step');
});

test('SKILL-004: the packaged skill declares no runtime dependency', async () => {
  const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'));
  assert.deepEqual(packageJson.pi.skills, ['./skills'], 'the repository installs the skills directory');
  const files = execFileSync('ls', [`${skillDir}/scripts/lib`], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  assert.ok(files.length > 0);
  for (const file of ['scripts/rea.mjs', 'scripts/lib/store.mjs']) {
    const source = readFileSync(`${skillDir}/${file}`, 'utf8');
    for (const match of source.matchAll(/from '([^']+)'/g)) {
      assert.ok(match[1].startsWith('.') || match[1].startsWith('node:'), `${file} may only import relative paths and node: builtins, found ${match[1]}`);
    }
  }
});

test('SKILL-005: a real Pi session loads the skill and uses the CLI', { skip: process.env.PI_REA_E2E !== '1' ? 'set PI_REA_E2E=1 with a configured model to re-run this' : false }, async (t) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout } = await run('pi', ['-p', '--no-session', '--skill', skillDir, 'Use the reverse-engineer-anything skill: run its route command on /bin/ls and answer with the operation and the format only.'], { timeout: 300000 });
  assert.match(stdout, /inspect-binary-layout/);
  assert.match(stdout, /mach-o/);
  t.diagnostic(stdout.slice(0, 400));
});

test('SKILL-006: the recorded end-to-end transcripts still contain their evidence', async () => {
  const transcripts = ['pi-skill-load.txt', 'pi-install-cycle.txt'];
  for (const name of transcripts) {
    const path = new URL(`../../../parity/reverse-engineer-anything/fixtures/e2e/${name}`, import.meta.url);
    const text = readFileSync(path, 'utf8');
    assert.ok(text.length > 200, `${name} must record more than a bare invocation`);
    assert.match(text, /command: pi /, `${name} must record the command that produced it`);
  }
  const install = readFileSync(new URL('../../../parity/reverse-engineer-anything/fixtures/e2e/pi-install-cycle.txt', import.meta.url), 'utf8');
  assert.match(install, /Installed \/Users/);
  assert.match(install, /No packages installed/, 'removal must be recorded too');
  assert.match(install, /reverse-engineer-anything/, 'discovery after install must be recorded');
});
