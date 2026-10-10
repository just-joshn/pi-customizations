import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const artifactsRoot = join(here, 'artifacts');
export const providerPath = join(here, 'journey-provider.ts');
export const hostPath = join(here, 'journey-host.ts');

export function resolvePi() {
  const fromEnv = process.env.PI_BIN;
  if (fromEnv) return fromEnv;
  const found = spawnSync('which', ['pi'], { encoding: 'utf8' });
  if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  throw new Error('pi binary not found on PATH (set PI_BIN)');
}

export function assertPiVersion(piBin) {
  const result = spawnSync(piBin, ['--version'], { encoding: 'utf8' });
  const version = `${result.stdout}${result.stderr}`.trim();
  if (result.status !== 0 || !version.includes('1.1.0')) {
    throw new Error(`expected pi 1.1.0, got status=${result.status} version=${JSON.stringify(version)}`);
  }
  return version;
}

export async function prepareWorkspace({ format, before, config }) {
  const root = await mkdtemp(join(tmpdir(), 'pm-edit-journey-'));
  const cwd = join(root, 'workspace');
  const agentDir = join(root, 'agent');
  const logDir = join(root, 'log');
  await mkdir(cwd);
  await mkdir(agentDir);
  await mkdir(logDir);
  await writeFile(join(cwd, 'hello.txt'), before, 'utf8');
  await writeFile(join(cwd, '.pi-maintainer.conf.yml'), config ?? `edit-format: ${format}\nfile: [hello.txt]\nyes-always: true\n`, 'utf8');
  return {
    root,
    cwd,
    agentDir,
    logDir,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function extensionArgs() {
  return ['--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates', '--offline', '-e', providerPath, '-e', hostPath];
}

export function journeyEnv(workspace, extra = {}) {
  return {
    ...process.env,
    ...extra,
    HOME: workspace.agentDir,
    PI_CODING_AGENT_DIR: workspace.agentDir,
    PI_MAINTAINER_JOURNEY_LOG: workspace.logDir,
    PI_OFFLINE: '1',
  };
}

export async function saveArtifact(name, value) {
  await mkdir(artifactsRoot, { recursive: true });
  const path = join(artifactsRoot, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

export async function readEdited(cwd) {
  return readFile(join(cwd, 'hello.txt'), 'utf8');
}

export function runPi(piBin, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(piBin, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`pi timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, options.timeoutMs ?? 120000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? (signal ? 1 : 0), stdout, stderr });
    });
  });
}

export function spawnPiRpc(piBin, args, options) {
  return spawn(piBin, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
