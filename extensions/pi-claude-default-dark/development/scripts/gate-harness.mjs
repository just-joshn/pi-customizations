import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { currentInputs, rollup } from '../lib/gates.ts';
import { requireLsof } from './lsof.mjs';
import { SYNTHETIC_KEY, startPeer } from './messages-peer.mjs';

export const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
export const packageDir = realpathSync(join(dev, '..'));
const userMessageBg = JSON.parse(readFileSync(join(packageDir, 'themes/claude-default-dark.json'), 'utf8')).colors.userMessageBg;
export const USER_MESSAGE_BG = new RegExp(`\\u001b\\[[0-9;]*48;2;${[1, 3, 5].map((i) => Number.parseInt(userMessageBg.slice(i, i + 2), 16)).join(';')}m`);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
export const lines = (path) =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

let inputs;
export async function harness(gate, script) {
  requireLsof();
  inputs = { package: currentInputs(join(dev, '..')).package };
  const root = realpathSync(mkdtempSync(join(tmpdir(), `pi-${gate}-`)));
  const out = join(dev, 'results', `${gate}-artifacts`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const work = join(root, 'work');
  const home = join(root, 'home');
  const stubs = join(root, 'stubs');
  for (const path of [work, home, stubs]) mkdirSync(path);
  const requests = [];
  const traffic = [];
  const peer = await startPeer({ script });
  const recorder = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const body = raw.length ? JSON.parse(raw.toString('utf8')) : null;
      requests.push(body);
      traffic.push({ method: req.method, url: req.url, body });
      json(join(out, 'requests.json'), requests);
      json(join(out, 'http-traffic.json'), traffic);
      const upstream = request(`${peer.baseUrl}${req.url}`, { method: req.method, headers: req.headers }, (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      });
      upstream.on('error', (error) => {
        res.writeHead(502).end(String(error));
      });
      upstream.end(raw);
    });
  });
  await new Promise((resolve) => recorder.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${recorder.address().port}`;
  const refused = [];
  const sink = createServer((req, res) => {
    refused.push(`HTTP ${req.headers.host ?? req.url}`);
    res.writeHead(403).end();
  });
  sink.on('connect', (req, socket) => {
    refused.push(`CONNECT ${req.url}`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve));
  const egressLog = join(out, 'egress.jsonl');
  writeFileSync(egressLog, '');
  writeFileSync(join(stubs, 'ssh'), `#!/bin/sh\nprintf '%s\\n' '{"kind":"ssh-stub"}' >> '${egressLog}'\nexit 255\n`, { mode: 0o755 });
  const guard = join(root, 'network-guard.cjs');
  writeFileSync(
    guard,
    `const net = require('node:net');
const fs = require('node:fs');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const value = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof value === 'object' ? value.host : typeof args[1] === 'string' ? args[1] : undefined;
  if (host && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    fs.appendFileSync(${JSON.stringify(egressLog)}, JSON.stringify({kind:'non-loopback-attempt',host})+'\\n');
    throw new Error('Gate refused non-loopback connection '+host);
  }
  return original.apply(this, args);
};
`,
  );
  const proxy = `http://127.0.0.1:${sink.address().port}`;
  const env = {
    HOME: home,
    PATH: `${stubs}:${process.env.PATH}`,
    LANG: 'en_US.UTF-8',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    ANTHROPIC_API_KEY: SYNTHETIC_KEY,
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    ALL_PROXY: proxy,
    NO_PROXY: '127.0.0.1,localhost',
    NODE_OPTIONS: `--require=${guard}`,
  };
  const configs = [];
  const sessions = new Set();
  const nonLoopback = new Set();
  function config(name, theme = 'dark') {
    const path = join(root, name);
    mkdirSync(path);
    json(join(path, 'models.json'), { providers: { anthropic: { baseUrl } } });
    json(join(path, 'settings.json'), { theme, defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-5', defaultThinkingLevel: 'medium', cacheWarming: 'off', defaultProjectTrust: 'never' });
    configs.push(path);
    return path;
  }
  const environment = (path) => ({ ...env, PI_CODING_AGENT_DIR: path });
  async function cli(path, args, label) {
    return await new Promise((resolve, reject) => {
      const child = spawn('pi', args, { cwd: work, env: environment(path) });
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`${label} timed out`));
      }, 45000);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        writeFileSync(join(out, `${label}.txt`), output);
        resolve({ code, output });
      });
    });
  }
  function tui(path, args, label) {
    const socket = `gate-${gate}-${process.pid}-${sessions.size}`;
    const tmux = (...values) => execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...values], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    tmux(
      'new-session',
      '-d',
      '-s',
      'gate',
      '-x',
      '140',
      '-y',
      '60',
      '-c',
      work,
      'env',
      '-i',
      ...Object.entries(environment(path)).map(([key, value]) => `${key}=${value}`),
      'pi',
      '--no-mcp',
      '--no-skills',
      '--no-context-files',
      '--no-prompt-templates',
      ...args,
    );
    const pane = (ansi = false) => tmux('capture-pane', '-p', ...(ansi ? ['-e'] : []), '-t', 'gate');
    const pids = () => {
      const all = [tmux('display-message', '-p', '-t', 'gate', '#{pane_pid}').trim()];
      for (let i = 0; i < all.length; i++) {
        try {
          all.push(...execFileSync('pgrep', ['-P', all[i]], { encoding: 'utf8' }).trim().split('\n').filter(Boolean));
        } catch {}
      }
      return all;
    };
    const timer = setInterval(() => {
      try {
        for (const pid of pids()) {
          try {
            const output = execFileSync('lsof', ['-a', '-n', '-P', '-p', pid, '-i'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            for (const line of output.split('\n').slice(1).filter(Boolean)) if (!/127\.0\.0\.1|\[::1\]|localhost/.test(line)) nonLoopback.add(line);
          } catch {}
        }
      } catch {}
    }, 350);
    const instance = {
      pane,
      async wait(test, name, ms = 30000) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (test(pane())) return;
          await sleep(150);
        }
        instance.capture(`timeout-${name}`);
        throw new Error(`${label}: timeout waiting for ${name}`);
      },
      async ready() {
        await instance.wait((text) => /claude-opus|anthropic/.test(text) && text.includes('─'), 'ready');
      },
      keys: (...keys) => tmux('send-keys', '-t', 'gate', ...keys),
      async send(text) {
        tmux('send-keys', '-t', 'gate', '-l', text);
        tmux('send-keys', '-t', 'gate', 'Enter');
        await sleep(250);
      },
      capture(name = label) {
        const path = join(out, `${name}.ansi`);
        writeFileSync(path, pane(true));
        writeFileSync(join(out, `${name}.txt`), pane());
        return path;
      },
      stop() {
        clearInterval(timer);
        let all = [];
        try {
          all = pids();
          tmux('kill-server');
        } catch {}
        for (const pid of all) {
          try {
            process.kill(Number(pid), 'SIGKILL');
          } catch {}
        }
        sessions.delete(instance);
      },
    };
    sessions.add(instance);
    return instance;
  }
  return {
    root,
    out,
    work,
    config,
    cli,
    tui,
    requests,
    async close() {
      for (const session of [...sessions]) session.stop();
      await new Promise((resolve) => {
        recorder.close(resolve);
        recorder.closeAllConnections();
      });
      await peer.close();
      await new Promise((resolve) => {
        sink.close(resolve);
        sink.closeAllConnections();
      });
      const network = { refusedEgress: refused, intercepted: lines(egressLog), nonLoopbackConnections: [...nonLoopback] };
      json(join(out, 'network.json'), network);
      json(join(out, 'run.json'), { root, work, configs, piVersion: execFileSync('pi', ['--version'], { env: environment(configs[0]), encoding: 'utf8' }).trim() });
      return network;
    },
  };
}

export function finish(gate, checks, extra = {}) {
  const verdict = rollup(checks);
  const result = { gate: gate.toUpperCase(), verdict, inputs, checks, ...extra };
  json(join(dev, 'results', `${gate}.json`), result);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = verdict === 'PASS' ? 0 : 1;
}
