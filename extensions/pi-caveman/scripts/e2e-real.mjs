#!/usr/bin/env node
// End-to-end check of the package against the real Caveman binaries: caveman-proxy,
// caveman-mcp, and the caveman CLI's native-hook, with a scripted local provider.
// Usage: node scripts/e2e-real.mjs --cli <dir holding caveman> --bin <dir holding caveman-proxy> [--checkout <dir>]
// Install both into a throwaway prefix with:
//   npm i --prefix /tmp/cavecli @caveman-ai/cli
//   HOME=/tmp/cavehome/home CAVEMAN_HOME=/tmp/cavehome/caveman /tmp/cavecli/node_modules/.bin/caveman setup --install
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const piCli = join(packageDir, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js');
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : resolve(process.argv[index + 1]);
};
const cliDir = arg('--cli');
const binDir = arg('--bin');
if (!cliDir || !binDir || !existsSync(join(cliDir, 'caveman')) || !existsSync(join(binDir, 'caveman-proxy'))) {
  process.stderr.write('usage: e2e-real.mjs --cli <dir with caveman> --bin <dir with caveman-proxy and caveman-mcp> [--checkout <caveman checkout>]\n');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'caveman-e2e-'));
const home = join(work, 'home');
const cavemanHome = join(work, 'caveman');
mkdirSync(home, { recursive: true });
mkdirSync(cavemanHome, { recursive: true });

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${label}${ok || !detail ? '' : `\n     ${detail}`}\n`);
};

// A bare `seq` listing panics the pinned engine (engine/filewrap.go:35, all-whitespace body after
// listing unwrap), so the tool output is log-shaped text.
const TOOL_COMMAND = 'for i in $(seq 1 300); do echo "worker $i: GET /api/items status=200 latency_ms=$i"; done';
const checkout = arg('--checkout') ?? '/tmp/caveman';
const verbs = JSON.parse(readFileSync(join(checkout, 'agents/reserved-verbs.json'), 'utf8')).verbs.filter((verb) => !verb.startsWith('-'));
// Upstream mounts some reserved verbs only under `caveman tools`, so a verb counts when either form runs.
const VERB_PROBE = `probe() { perl -e 'alarm 20; exec @ARGV' caveman "$@" --help 2>&1 | grep -q 'unknown command'; }; for v in ${verbs.join(' ')}; do if probe "$v" && probe tools "$v"; then echo "MISSING $v"; else echo "REACHED $v"; fi; done`;
const hits = [];
const sse = (res, delta, finish) => {
  const chunk = (d, f, usage) => ({ id: 's', object: 'chat.completion.chunk', model: 'm', choices: [{ index: 0, delta: d, finish_reason: f }], ...usage });
  res.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
  res.write(`data: ${JSON.stringify(chunk({}, finish, { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }))}\n\n`);
  res.end('data: [DONE]\n\n');
};
const toolCall = (name, args) => ({
  role: 'assistant',
  tool_calls: [{ index: 0, id: `call_${name}_${hits.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const textOf = (message) => (typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? ''));

function reply(messages, res) {
  const last = messages.at(-1);
  const asked = messages
    .filter((m) => m.role === 'user')
    .map(textOf)
    .join(' ');
  if (last?.role === 'user' && asked.includes('RUN_VERBS')) return sse(res, toolCall('bash', { command: VERB_PROBE }), 'tool_calls');
  if (last?.role === 'user' && asked.includes('RUN_TOOL')) return sse(res, toolCall('bash', { command: TOOL_COMMAND }), 'tool_calls');
  const handle = last?.role === 'tool' ? /ccr_[A-Za-z0-9_]+/.exec(textOf(last))?.[0] : undefined;
  const retrieved = messages.some((m) => JSON.stringify(m.tool_calls ?? '').includes('caveman_retrieve'));
  if (handle && !retrieved) return sse(res, toolCall('caveman_retrieve', { recovery_handle: handle }), 'tool_calls');
  return sse(res, { role: 'assistant', content: 'STUB_OK' }, 'stop');
}

const provider = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    let messages = [];
    try {
      messages = JSON.parse(body).messages ?? [];
    } catch {
      messages = [];
    }
    let tools = [];
    try {
      tools = (JSON.parse(body).tools ?? []).map((tool) => tool.function?.name);
    } catch {
      tools = [];
    }
    hits.push({ path: req.url, headers: req.headers, messages, tools });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    reply(messages, res);
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
const providerPort = provider.address().port;
const proxyPort = providerPort + 1;
const allow = `127.0.0.1:${providerPort}`;
const upstream = `http://127.0.0.1:${providerPort}/v1`;

writeFileSync(join(work, 'caveman.yaml'), `mode: compress\nlisten: 127.0.0.1:${proxyPort}\ncompat:\n  stub-relay:\n    base_url: ${upstream}\n`);
writeFileSync(
  join(work, 'provider.mjs'),
  `export default (pi) => pi.registerProvider("stub-relay", { name: "Stub Relay", baseUrl: ${JSON.stringify(upstream)}, apiKey: "dummy", api: "openai-completions", models: [{ id: "relay-model", name: "Relay", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 1024 }] });\n`,
);

const env = {
  HOME: home,
  CAVEMAN_HOME: cavemanHome,
  CAVEMAN_CONFIG: join(work, 'caveman.yaml'),
  CAVE_GATEWAY_URL: `http://127.0.0.1:${proxyPort}`,
  CAVEMAN_MCP_BIN: join(binDir, 'caveman-mcp'),
  CAVE_SSRF_ALLOWLIST: allow,
  PATH: [cliDir, binDir, dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
  NO_COLOR: '1',
};
// Without the binaries the CLI cannot revive a stopped proxy, which is the honest-fallback case.
const withoutBinaries = { ...env, CAVEMAN_MCP_BIN: join(work, 'missing-mcp'), PATH: [cliDir, dirname(process.execPath), '/usr/bin', '/bin'].join(':') };

let proxy;
let proxyLog = '';
async function startProxy() {
  proxy = spawn(join(binDir, 'caveman-proxy'), [], {
    env: { ...env, CAVEMAN_RECOVERY: 'mcp', CAVEMAN_PROXY_OWNER: 'wrap' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  proxy.stderr.on('data', (c) => {
    proxyLog += c;
  });
  const runFile = join(cavemanHome, 'run', `${proxyPort}.json`);
  for (let i = 0; i < 50 && !existsSync(runFile); i++) await new Promise((r) => setTimeout(r, 100));
  return runFile;
}
const stopProxy = (signal) =>
  new Promise((r) => {
    if (proxy.exitCode !== null || proxy.signalCode !== null) return r();
    proxy.once('exit', r);
    proxy.kill(signal);
  });

function runPi(prompt, runEnv = env, discovered = false) {
  const loaded = discovered ? [] : ['--extension', packageDir, '--no-extensions'];
  const args = [piCli, '--extension', join(work, 'provider.mjs'), ...loaded, '--no-session', '--no-context-files'];
  args.push('--provider', 'stub-relay', '--model', 'relay-model', '-p', prompt);
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: work, env: runEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.on('exit', (code) => done({ code, stdout, stderr }));
  });
}

const fresh = () => hits.splice(0);
const system = (hit) => textOf(hit?.messages[0]);
const toolTexts = (hit) => hit.messages.filter((m) => m.role === 'tool').map(textOf);
const notices = (run) => (run.stderr.match(/Caveman: direct mode, no compression/g) ?? []).length;

try {
  const runFile = await startProxy();
  const run = await runPi('say hi');
  const [first] = fresh();
  check(run.stdout.includes('STUB_OK'), 'routed turn completes through the real proxy', run.stderr);
  check(first !== undefined && !('x-stainless-lang' in first.headers), 'the request arrives through the proxy, not the SDK directly');
  check(first?.headers.authorization === 'Bearer dummy', 'the routed request keeps the provider credential Pi resolved');
  check(system(first).includes('CAVEMAN MODE ACTIVE — mode: caveman'), 'caveman ruleset rides the routed system prompt');
  check(/Run smallest sufficient proof/.test(system(first)), 'native Core from caveman native-hook rides the system prompt');
  check(notices(run) === 0, 'an open gate gives no direct-mode notice', run.stderr);

  const classified = {
    'surgical-patch': 'fix the crash in parser.ts',
    'investigate-first': 'investigate why the cache misses',
    migration: 'migrate the schema with a backfill',
    'safe-refactor': 'refactor and cleanup the utils module',
    'verify-and-stop': 'verify that the login flow works',
    'lean-build': 'implement a new export feature',
  };
  for (const [skill, prompt] of Object.entries(classified)) {
    await runPi(prompt);
    const [hit] = fresh();
    check(system(hit).includes(`Active skill ${skill}:`), `the native runtime activates ${skill} for a matching task`);
  }

  const toolRun = await runPi('RUN_TOOL please');
  const turns = fresh();
  const shrunk = toolTexts(turns[1] ?? { messages: [] })[0] ?? '';
  const recovered = toolTexts(turns[2] ?? { messages: [] })[1] ?? '';
  check(toolRun.stdout.includes('STUB_OK'), 'tool turn completes', `${toolRun.stderr}\n${proxyLog.slice(0, 600)}`);
  check(/full: ccr:\/\/ccr_[a-z0-9_]+/.test(shrunk) && shrunk.length < 1000, 'large bash output reaches the model shrunk behind a ccr handle', shrunk.slice(0, 200));
  check(!/ccr:\/\//.test(recovered) && recovered.length > 5000 && !recovered.includes('Showing lines'), 'caveman_retrieve output is the original and is not re-shrunk', recovered.slice(0, 200));

  await stopProxy('SIGTERM');
  const direct = await runPi('RUN_TOOL please', withoutBinaries);
  const directTurns = fresh();
  const original = toolTexts(directTurns[1] ?? { messages: [] })[0] ?? '';
  check(direct.stdout.includes('STUB_OK'), 'with the proxy stopped the session stays usable', direct.stderr);
  check(original === recovered, 'recovered bytes equal the unshrunk direct tool output', JSON.stringify([original.slice(-200), recovered.slice(-200)]));
  check(notices(direct) === 1, 'a stopped proxy gives exactly one direct-mode notice', direct.stderr);

  const verbRun = await runPi('RUN_VERBS', withoutBinaries);
  const verbOutput = toolTexts(fresh()[1] ?? { messages: [] })[0] ?? '';
  const reached = verbs.filter((verb) => verbOutput.split('\n').includes(`REACHED ${verb}`));
  check(verbRun.code === 0 && reached.length === verbs.length, `all ${verbs.length} caveman CLI verbs run from Pi's bash tool`, JSON.stringify(verbs.filter((verb) => !reached.includes(verb))) + verbOutput.slice(-300));

  await startProxy();
  writeFileSync(runFile, readFileSync(runFile, 'utf8').replace(/"instance_token":"[0-9a-f]+"/, '"instance_token":"0000"'));
  const mismatched = await runPi('RUN_TOOL please', withoutBinaries);
  const mismatchedTurns = fresh();
  check(notices(mismatched) === 1, 'a mismatched proxy identity stays direct with one notice', mismatched.stderr);
  check(toolTexts(mismatchedTurns[1] ?? { messages: [] })[0] === original, 'a mismatched proxy identity leaves tool output untouched');

  await stopProxy('SIGKILL');
  check(existsSync(runFile), 'a killed proxy leaves its stale run-state file');
  const stale = await runPi('say hi', withoutBinaries);
  check(hits[0]?.headers['x-stainless-lang'] === 'js', 'the direct request comes from the SDK itself');
  fresh();
  check(stale.stdout.includes('STUB_OK') && notices(stale) === 1, 'a stale run-state file stays direct with one notice', stale.stderr);

  // A user who installs the package and also runs `caveman enable pi` gets one runtime, not a startup conflict.
  const piBin = join(packageDir, 'node_modules/.bin');
  const installed = { ...env, PATH: `${piBin}:${env.PATH}` };
  execFileSync(join(piBin, 'pi'), ['install', packageDir], { env: installed, stdio: 'ignore' });
  execFileSync(join(cliDir, 'caveman'), ['enable', 'pi'], { env: installed, stdio: 'ignore' });
  await startProxy();
  const both = await runPi('RUN_TOOL please', installed, true);
  const bothTurns = fresh();
  const tools = (hit) => (hit?.tools ?? []).filter((name) => name === 'caveman_retrieve').length;
  check(both.code === 0 && both.stdout.includes('STUB_OK'), 'package plus caveman enable pi starts without a tool conflict', both.stderr);
  check(tools(bothTurns[0]) === 1, 'package plus caveman enable pi exposes one caveman_retrieve');
  check(system(bothTurns[0]).split('CAVEMAN MODE ACTIVE — mode: caveman').length === 2, 'package plus caveman enable pi sends the ruleset once');
  check(/full: ccr:\/\//.test(toolTexts(bothTurns[1] ?? { messages: [] })[0] ?? ''), 'package plus caveman enable pi still shrinks tool output');
  const skipped = await runPi('say hi', installed);
  fresh();
  check(/the caveman-enable runtime extension did not load/.test(skipped.stderr), 'a skipped caveman enable pi extension is reported, not silent', skipped.stderr);
  execFileSync(join(cliDir, 'caveman'), ['disable', 'pi'], { env: installed, stdio: 'ignore' });
  await stopProxy('SIGTERM');
} finally {
  if (proxy && proxy.exitCode === null && proxy.signalCode === null) proxy.kill('SIGKILL');
  try {
    process.kill(JSON.parse(readFileSync(join(cavemanHome, 'run', `${proxyPort}.json`), 'utf8')).pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
  }
  provider.close();
  rmSync(work, { recursive: true, force: true });
}

process.stdout.write(failures === 0 ? 'e2e-real: all checks passed\n' : `e2e-real: ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
