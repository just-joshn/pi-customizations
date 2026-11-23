#!/usr/bin/env node
/**
 * Verification helper for the pi-modes extension.
 *
 * It keeps the real Pi CLI and the deterministic fake-model e2e in one run:
 *   init EVIDENCE      create a durable evidence directory and record the build
 *   doctor EVIDENCE    read-only check of Pi, Node, source, and dependencies
 *   drive EVIDENCE     run the real-Pi fake-model e2e and copy its artifacts
 *   cleanup EVIDENCE   remove only this run's temporary e2e root
 *
 * Evidence survives cleanup. No credentials are used or copied.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(scriptDir, '..');
const repoRoot = resolve(skillDir, '../../..');
const extensionDir = join(repoRoot, 'extensions/no-ceilings/pi-modes');
const e2eScript = join(extensionDir, 'test/e2e/verify-modes-fake.mjs');
const fakeServer = join(extensionDir, 'test/e2e/fake-model-server.mjs');
const packageFile = join(extensionDir, 'package.json');
const sourceDir = join(extensionDir, 'src');
const TIMEOUT_MS = 240_000;
const MIN_PI = [1, 5, 2];
const MIN_NODE = [22, 19, 0];

function usage() {
  console.log('usage: verify.mjs <init|doctor|drive|cleanup> <evidence-dir>');
}

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureEvidence(value) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('evidence directory is required');
  }
  return resolve(value);
}

function readState(evidence) {
  const statePath = join(evidence, 'state.json');
  if (!existsSync(statePath)) {
    fail(`missing ${statePath}; run init first`);
  }
  return readJson(statePath);
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listFiles(path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function sourceHash() {
  const files = [...listFiles(sourceDir), packageFile, e2eScript, fakeServer].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.slice(extensionDir.length + 1));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function versionOf(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15_000 });
  if (result.error) return { error: result.error.message };
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { status: result.status, text, firstLine: text.split('\n')[0] ?? '' };
}

function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function atLeast(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    const a = actual[index] ?? 0;
    const b = minimum[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function packageInfo() {
  const pkg = readJson(packageFile);
  return { name: pkg.name, version: pkg.version };
}

function init(evidenceArg) {
  const evidence = ensureEvidence(evidenceArg);
  if (existsSync(evidence)) {
    fail(`evidence directory already exists: ${evidence}`);
  }
  mkdirSync(evidence, { recursive: true });
  const pi = versionOf('pi');
  const node = versionOf(process.execPath);
  const pkg = packageInfo();
  const state = {
    version: 1,
    createdAt: new Date().toISOString(),
    repoRoot,
    extensionDir,
    evidence,
    pi: pi.firstLine,
    piPath: spawnSync('sh', ['-lc', 'command -v pi'], { encoding: 'utf8' }).stdout.trim() || 'pi',
    node: node.firstLine,
    package: pkg,
    sourceHash: sourceHash(),
    e2eScript,
    fakeServer,
    e2eRoot: undefined,
  };
  writeJson(join(evidence, 'state.json'), state);
  console.log(JSON.stringify({ status: 'initialized', evidence }, null, 2));
}

function doctor(evidenceArg) {
  const evidence = ensureEvidence(evidenceArg);
  const state = readState(evidence);
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const pi = versionOf('pi');
  const node = versionOf(process.execPath);
  const pkg = packageInfo();
  const piVersion = parseVersion(pi.firstLine);
  const nodeVersion = parseVersion(node.firstLine);
  add('pi executable', pi.status === 0 && piVersion !== undefined, pi.error ?? pi.firstLine);
  add('pi version >= 1.5.2', piVersion !== undefined && atLeast(piVersion, MIN_PI), pi.firstLine);
  add('pi version matches init', pi.firstLine === state.pi, `init=${state.pi}`);
  add('node version >= 22.19.0', nodeVersion !== undefined && atLeast(nodeVersion, MIN_NODE), node.firstLine);
  add('package version matches init', pkg.version === state.package?.version, `init=${state.package?.version} now=${pkg.version}`);
  add('extension source unchanged', sourceHash() === state.sourceHash, `init=${state.sourceHash} now=${sourceHash()}`);
  add('fake-model e2e present', existsSync(e2eScript), e2eScript);
  add('fake model server present', existsSync(fakeServer), fakeServer);
  add('dependencies installed', existsSync(join(extensionDir, 'node_modules', '@earendil-works', 'pi-coding-agent')), join(extensionDir, 'node_modules'));
  const ready = checks.every((check) => check.ok);
  const result = { status: ready ? 'ready' : 'failed', evidence, checks, at: new Date().toISOString() };
  writeJson(join(evidence, 'doctor.json'), result);
  console.log(JSON.stringify(result, null, 2));
  if (!ready) process.exitCode = 1;
}

function runE2e(evidence) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, [e2eScript], {
      cwd: extensionDir,
      detached: true,
      env: { ...process.env, PI_MODES_E2E_KEEP: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, TIMEOUT_MS);
    child.stdout.on('data', (data) => {
      stdout += data;
      process.stdout.write(data);
    });
    child.stderr.on('data', (data) => {
      stderr += data;
      process.stderr.write(data);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, timedOut, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

function copyE2eRoot(evidence, state, stdout) {
  const match = /evidence root: (\S+)/.exec(stdout);
  if (!match) return { status: 'not-found' };
  const root = match[1];
  state.e2eRoot = root;
  writeJson(join(evidence, 'state.json'), state);
  if (!existsSync(root)) return { status: 'missing', root };
  const target = join(evidence, 'e2e-root');
  rmSync(target, { recursive: true, force: true });
  cpSync(root, target, { recursive: true, force: true });
  return { status: 'copied', root, target };
}

async function drive(evidenceArg) {
  const evidence = ensureEvidence(evidenceArg);
  const state = readState(evidence);
  const run = await runE2e(evidence);
  writeFileSync(join(evidence, 'stdout.log'), run.stdout);
  writeFileSync(join(evidence, 'stderr.log'), run.stderr);
  const copy = copyE2eRoot(evidence, state, run.stdout);
  const result = {
    command: `${process.execPath} ${e2eScript}`,
    cwd: extensionDir,
    exitCode: run.code,
    signal: run.signal,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    copy,
    passed: run.code === 0 && run.stdout.includes('PASS deterministic end-to-end mode checks'),
  };
  writeJson(join(evidence, 'drive.json'), result);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

function cleanup(evidenceArg) {
  const evidence = ensureEvidence(evidenceArg);
  if (!existsSync(evidence)) {
    fail(`evidence directory does not exist: ${evidence}`);
  }
  const state = readState(evidence);
  const removed = [];
  const root = state.e2eRoot;
  const allowedPrefix = `${tmpdir()}${sep}`;
  if (typeof root === 'string' && root.startsWith(allowedPrefix) && basename(root).startsWith('pi-modes-fake-e2e-')) {
    rmSync(root, { recursive: true, force: true });
    removed.push(root);
  }
  const result = {
    status: 'cleaned',
    evidence,
    removed,
    evidencePreserved: existsSync(join(evidence, 'state.json')) && existsSync(join(evidence, 'stdout.log')),
    at: new Date().toISOString(),
  };
  writeJson(join(evidence, 'cleanup.json'), result);
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const [mode, evidence] = process.argv.slice(2);
  if (!['init', 'doctor', 'drive', 'cleanup'].includes(mode) || evidence === undefined) {
    usage();
    process.exitCode = 2;
    return;
  }
  if (mode === 'init') init(evidence);
  else if (mode === 'doctor') doctor(evidence);
  else if (mode === 'drive') await drive(evidence);
  else cleanup(evidence);
}

try {
  await main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
