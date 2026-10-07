import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRpcSession } from '../../lib/rpc.mjs';

export const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export const ANTHROPIC_PACKAGE = 'extensions/pi-anthropic-oauth';
export const ANTIGRAVITY_PACKAGE = 'extensions/pi-antigravity-oauth';
export const XAI_PACKAGE = 'extensions/pi-xai-oauth';
export const ANTHROPIC_PROVIDER = 'claude-subscription';
export const ANTIGRAVITY_PROVIDER = 'google-antigravity';
export const XAI_PROVIDER = 'grok-build';
export const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
export const ANTIGRAVITY_MODEL = 'gemini-3.1-pro';

const ROUTER_PATH = fileURLToPath(new URL('./offline-router.mjs', import.meta.url));

export function offlineEnv({ routes = [], logPath, strict = true } = {}) {
  return {
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
    NODE_OPTIONS: `--import=${pathToFileURL(ROUTER_PATH).href}`,
    PI_ROUTE_MAP: JSON.stringify(routes),
    PI_ROUTE_STRICT: strict ? '1' : '0',
    ...(logPath === undefined ? {} : { PI_ROUTE_LOG: logPath }),
  };
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}

export function filler(label, bytes) {
  const sentence = 'The quick brown fox jumps over the lazy dog. ';
  return `${label}\n${sentence.repeat(Math.ceil(bytes / Buffer.byteLength(sentence, 'utf8')))}`;
}

export function runPi(piBin, args, { cwd, agentDir, env = {}, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = execFile(piBin, args, { cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, ...env }, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 1, stdout, stderr });
    });
    child.stdin?.end();
  });
}

export function startRpc(context, { packagePath, agentDir, captureName, env = {}, requestTimeoutMs = 60000, idleTimeoutMs = 240000 }) {
  return createRpcSession({
    packagePath: join(REPO_ROOT, packagePath),
    agentDir,
    cwd: agentDir,
    capturePath: context.rawPath(captureName),
    piBin: context.piBin,
    requestTimeoutMs,
    idleTimeoutMs,
    env,
  });
}
