import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const piCli = join(packageRoot, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
const vendoredTests = join(packageRoot, 'vendor/caveman/packages/pi-extension/tests');
const stubProviders = join(vendoredTests, 'fixtures/stub-provider-extension.mjs');
const mcpStub = join(vendoredTests, 'fixtures/stub-caveman-mcp.mjs');
const cliRuntimeCopy = join(packageRoot, 'vendor/caveman/packages/pi-extension/src/index.ts');

type Hit = { method: string; path: string; body: string };
type Stub = { server: Server; hits: Hit[]; port: number };
type Run = { code: number | null; stdout: string; stderr: string };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const COMPLETION = [
  { choices: [{ index: 0, delta: { role: 'assistant', content: 'CAVEMAN_STUB_OK' }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } },
];

function answer(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && req.url === '/health/live') {
    res.writeHead(200, { 'x-caveman-instance': 'test-token' }).end('{}');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const chunk of COMPLETION) res.write(`data: ${JSON.stringify({ id: 's1', object: 'chat.completion.chunk', model: 'stub', ...chunk })}\n\n`);
  res.end('data: [DONE]\n\n');
}

async function startStub(): Promise<Stub> {
  const hits: Hit[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      hits.push({ method: req.method ?? '', path: req.url ?? '', body });
      answer(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stub server has no port');
  cleanups.push(() => server.close());
  return { server, hits, port: (address satisfies AddressInfo).port };
}

const HOOK = `
import { appendFileSync } from "node:fs";
const event = process.argv[process.argv.length - 1];
appendFileSync(process.env.HOOK_LOG, event + "\\n");
process.stdin.resume();
process.stdin.on("data", () => {});
const bodies = {
  SessionStart: '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"CORE_MARKER_XYZ"}}',
  UserPromptSubmit: '{"hookSpecificOutput":{"additionalContext":"DYNAMIC_MARKER_ABC"}}',
};
process.stdout.write(bodies[event] ?? "{}");
process.stdin.pause();
process.stdin.unref();
`;

type FixtureOptions = { port: number; runState: boolean; hook: boolean };

function fixture({ port, runState, hook }: FixtureOptions): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'pi-caveman-runtime-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const cavemanHome = join(root, 'caveman');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(cavemanHome, 'run'), { recursive: true });
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(root, 'hook.mjs'), HOOK);
  if (hook) {
    writeFileSync(join(bin, 'caveman'), `#!/bin/sh\nexec "${process.execPath}" "${join(root, 'hook.mjs')}" "$@"\n`);
    chmodSync(join(bin, 'caveman'), 0o755);
  }
  const mcp = join(root, 'caveman-mcp');
  writeFileSync(mcp, `#!/bin/sh\nexec "${process.execPath}" "${mcpStub}" "$@"\n`);
  chmodSync(mcp, 0o755);
  writeFileSync(
    join(root, 'direct.mjs'),
    `export default (pi) => pi.registerProvider("direct-stub", { name: "Direct", baseUrl: "http://127.0.0.1:${port}/direct/v1", apiKey: "dummy", api: "openai-completions", models: [{ id: "direct-model", name: "Direct", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 1024 }] });\n`,
  );
  if (runState) {
    writeFileSync(
      join(cavemanHome, 'run', `${port}.json`),
      JSON.stringify({
        schema: 'caveman.proxy.run.v1',
        pid: process.pid,
        port,
        owner: 'wrap',
        instance_token: 'test-token',
        recovery_via_mcp: true,
        provider_upstreams: { openai: 'http://127.0.0.1:1/native-openai' },
      }),
    );
  }
  return {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    USERPROFILE: home,
    ROOT: root,
    HOOK_LOG: join(root, 'hooks.log'),
    CAVEMAN_HOME: cavemanHome,
    CAVEMAN_DEFAULT_MODE: 'caveman',
    CAVE_GATEWAY_URL: `http://127.0.0.1:${port}`,
    CAVEMAN_MCP_BIN: mcp,
    NO_COLOR: '1',
  };
}

function runPi(env: NodeJS.ProcessEnv, provider: string, model: string, before: string[] = []): Promise<Run> {
  const args = [piCli, '--extension', stubProviders, '--extension', join(env['ROOT'] ?? '', 'direct.mjs'), ...before];
  args.push('--extension', packageRoot, '--no-session', '--no-context-files', '--no-themes', '--no-extensions');
  args.push('--provider', provider, '--model', model, '-p', 'say hi');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, cwd: env['ROOT'], stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

const posts = (stub: Stub) => stub.hits.filter((hit) => hit.method === 'POST');
const directNotices = (run: Run) => (run.stderr.match(/Caveman: direct mode, no compression/g) ?? []).length;

test('an open gate routes the first request through /w/pi', async () => {
  const stub = await startStub();
  const env = fixture({ port: stub.port, runState: true, hook: true });

  const run = await runPi(env, 'openai', 'stub-model');

  expect(run.stdout).toContain('CAVEMAN_STUB_OK');
  const first = posts(stub)[0];
  expect(first?.path).toBe('/w/pi/openai/v1/chat/completions');
  expect(first?.body).toContain('CORE_MARKER_XYZ');
  expect(first?.body).toContain('DYNAMIC_MARKER_ABC');
  expect(first?.body).toContain('CAVEMAN MODE ACTIVE — mode: caveman');
});

test('a closed gate keeps requests direct', async () => {
  const stub = await startStub();
  const env = fixture({ port: stub.port, runState: false, hook: true });

  const run = await runPi(env, 'direct-stub', 'direct-model');

  expect(run.stdout).toContain('CAVEMAN_STUB_OK');
  expect(posts(stub).map((hit) => hit.path)).toEqual(['/direct/v1/chat/completions']);
  expect(posts(stub)[0]?.body).toContain('CAVEMAN MODE ACTIVE — mode: caveman');
  expect(directNotices(run)).toBe(1);
});

test('a missing caveman CLI degrades to direct mode', async () => {
  const stub = await startStub();
  const env = fixture({ port: stub.port, runState: true, hook: false });

  const run = await runPi(env, 'direct-stub', 'direct-model');

  expect(run.code).toBe(0);
  expect(run.stdout).toContain('CAVEMAN_STUB_OK');
  expect(posts(stub).map((hit) => hit.path)).toEqual(['/direct/v1/chat/completions']);
  expect(posts(stub)[0]?.body).not.toContain('CORE_MARKER_XYZ');
  expect(run.stderr).toContain('caveman native runtime unreachable');
  expect(directNotices(run)).toBe(1);
});

test('under caveman wrap pi the package yields the runtime and keeps its ruleset', async () => {
  const stub = await startStub();
  const env = fixture({ port: stub.port, runState: true, hook: true });
  const wrapped = { ...env, CAVEMAN_PI_HOOK_CMD: JSON.stringify([join(env['ROOT'] ?? '', 'bin', 'caveman')]) };

  const run = await runPi(wrapped, 'openai', 'stub-model', ['--extension', cliRuntimeCopy]);

  expect(run.stderr).not.toContain('conflicts');
  const first = posts(stub)[0];
  expect(first?.path).toBe('/w/pi/openai/v1/chat/completions');
  expect(first?.body).toContain('CORE_MARKER_XYZ');
  expect(first?.body).toContain('CAVEMAN MODE ACTIVE — mode: caveman');
});
