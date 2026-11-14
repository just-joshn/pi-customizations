import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { currentInputs } from '../lib/gates.ts';
import { CAPTURE_GEOMETRY } from './geometry.mjs';
import { requireLsof } from './lsof.mjs';
import { SYNTHETIC_KEY, startPeer } from './messages-peer.mjs';
import { binaryVersion, PINS, resolvePinnedClaude } from './pins.mjs';
import { FILES, resolveReply, SCENES } from './scenes.mjs';

const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opts } = parseArgs({
  options: {
    product: { type: 'string' },
    theme: { type: 'string', default: 'dark' },
    'theme-file': { type: 'string' },
    package: { type: 'string' },
    out: { type: 'string' },
    scene: { type: 'string', multiple: true },
    width: { type: 'string', default: String(CAPTURE_GEOMETRY.width_columns) },
    keep: { type: 'boolean', default: false },
    'claude-version': { type: 'string', default: PINS.claude },
  },
});
if (opts.product !== 'claude' && opts.product !== 'pi') throw new Error('--product claude|pi');
if (binaryVersion('pi') !== PINS.pi) throw new Error(`pi ${binaryVersion('pi')} is not the pinned ${PINS.pi}`);
const claudeBin = opts.product === 'claude' ? resolvePinnedClaude({ pin: opts['claude-version'] }) : undefined;
const width = Number(opts.width);
const target = join(dev, 'captures', opts.out ?? (opts.product === 'claude' ? 'claude' : `pi-${opts.theme}`));
const out = `${target}.partial`;
const scenes = SCENES.filter((s) => (opts.scene ? opts.scene.includes(s.name) : true) && (!s.only || s.only === opts.product));

const scratch = realpathSync(mkdtempSync(join(tmpdir(), `${opts.product}-capture-`)));
const home = join(scratch, 'home');
const config = join(scratch, 'config');
const work = join(scratch, 'work');
requireLsof();
rmSync(out, { recursive: true, force: true });
for (const d of [home, config, work, out]) mkdirSync(d, { recursive: true });
const peerLog = join(scratch, 'peer.jsonl');
const socket = `capture-${process.pid}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmux = (...args) => execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...args], { encoding: 'utf8' });
const pane = (escapes) => tmux('capture-pane', '-p', ...(escapes ? ['-e', '-N'] : []), '-t', 'cap');

process.env.CAPTURE_WORK = work;
const turns = new Map(scenes.flatMap((s) => (s.replies ? Object.entries(s.replies) : [])));
const peer = await startPeer({
  logPath: peerLog,
  script: (body) => {
    const key = JSON.stringify(body?.messages ?? [])
      .match(/SCENE:[\w-]+(?:#\d+)?/g)
      ?.at(-1);
    if (!key) return undefined;
    const toolResults = (body.messages ?? []).filter((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'tool_result')).length;
    const replies = turns.get(key);
    return resolveReply(Array.isArray(replies) ? replies[Math.min(toolResults, replies.length - 1)] : replies, body);
  },
});

const refused = [];
const sink = createServer((req, res) => {
  refused.push(`HTTP ${req.headers.host ?? req.url}`);
  res.writeHead(403).end();
});
sink.on('connect', (req, sock) => {
  refused.push(`CONNECT ${req.url}`);
  sock.end('HTTP/1.1 403 Forbidden\r\n\r\n');
});
await new Promise((r) => sink.listen(0, '127.0.0.1', r));
const sinkUrl = `http://127.0.0.1:${sink.address().port}`;

for (const [path, content] of Object.entries(FILES)) {
  mkdirSync(dirname(join(work, path)), { recursive: true });
  writeFileSync(join(work, path), content);
}

const stubs = join(scratch, 'stubs');
mkdirSync(stubs);
const egressLog = join(scratch, 'egress-stub.log');
writeFileSync(join(stubs, 'ssh'), `#!/bin/sh\necho "ssh $*" >> '${egressLog}'\nexit 255\n`, { mode: 0o755 });

const env = {
  HOME: home,
  PATH: `${stubs}:${process.env.PATH}`,
  LANG: 'en_US.UTF-8',
  TERM: CAPTURE_GEOMETRY.TERM,
  COLORTERM: CAPTURE_GEOMETRY.COLORTERM,
  ANTHROPIC_API_KEY: SYNTHETIC_KEY,
  HTTPS_PROXY: sinkUrl,
  HTTP_PROXY: sinkUrl,
  NO_PROXY: '127.0.0.1,localhost',
};
let command;
if (opts.product === 'claude') {
  writeFileSync(
    join(config, '.claude.json'),
    JSON.stringify({
      theme: 'dark',
      hasCompletedOnboarding: true,
      lastOnboardingVersion: '2.1.322',
      customApiKeyResponses: { approved: [SYNTHETIC_KEY.slice(-20)], rejected: [] },
      projects: { [work]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true, allowedTools: [] } },
    }),
  );
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: config,
    ANTHROPIC_BASE_URL: peer.baseUrl,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
  });
  mkdirSync(join(work, '.claude'));
  writeFileSync(join(work, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Read', 'Edit', 'Bash'] } }));
  command = [claudeBin];
} else {
  writeFileSync(join(config, 'models.json'), JSON.stringify({ providers: { anthropic: { baseUrl: peer.baseUrl } } }));
  if (opts['theme-file']) {
    mkdirSync(join(config, 'themes'));
    writeFileSync(join(config, 'themes', basename(opts['theme-file'])), readFileSync(opts['theme-file']));
  }
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ theme: opts.theme, defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-5' }));
  Object.assign(env, { PI_CODING_AGENT_DIR: config, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' });
  if (opts.package) execFileSync('pi', ['install', realpathSync(opts.package)], { cwd: work, env, encoding: 'utf8' });
  command = ['pi', '--no-session'];
}

// tmux is only the pty and grid recorder. The app must see Alacritty's env, not tmux's: with TMUX set, Claude Code drops to 256 colors.
tmux('new-session', '-d', '-s', 'cap', '-x', String(width), '-y', String(CAPTURE_GEOMETRY.height_rows), '-c', work, 'env', '-i', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), ...command);

const appPids = () => {
  const root = tmux('display-message', '-p', '-t', 'cap', '#{pane_pid}').trim();
  const kids = (pid) => {
    try {
      return execFileSync('pgrep', ['-P', pid], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };
  const all = [root];
  for (let i = 0; i < all.length; i++) all.push(...kids(all[i]));
  return all;
};
const remote = new Set();
const watch = setInterval(() => {
  try {
    for (const pid of appPids()) {
      let lines = [];
      try {
        lines = execFileSync('lsof', ['-a', '-n', '-P', '-p', pid, '-i'], { encoding: 'utf8' }).split('\n').slice(1);
      } catch {}
      for (const line of lines) if (line && !/127\.0\.0\.1|\[::1\]|localhost/.test(line)) remote.add(line.replace(/\s+/g, ' '));
    }
  } catch {}
}, 300);

const ctx = {
  product: opts.product,
  pane: () => pane(false),
  keys: (...names) => tmux('send-keys', '-t', 'cap', ...names),
  type: (text) => tmux('send-keys', '-t', 'cap', '-l', text),
  sleep,
  async waitFor(test, label, ms = 30_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (test(pane(false))) return;
      await sleep(150);
    }
    writeFileSync(join(scratch, `timeout-${label}.txt`), pane(true));
    throw new Error(`timeout waiting for ${label}; pane saved in ${scratch}`);
  },
  async settle() {
    let last = '';
    for (let stable = 0; stable < 5; ) {
      await sleep(200);
      const now = pane(true);
      stable = now === last ? stable + 1 : 0;
      last = now;
    }
    return last;
  },
  capture: (name, text) => writeFileSync(join(out, `${name}.ansi`), text ?? pane(true)),
  captured: [],
};

const result = {
  product: opts.product,
  theme: opts.product === 'claude' ? 'dark' : opts.theme,
  themeSha256: (() => {
    const file = opts['theme-file'] ?? (opts.package && join(opts.package, 'themes/claude-default-dark.json'));
    return file ? createHash('sha256').update(readFileSync(file)).digest('hex') : undefined;
  })(),
  packageSha256: opts.package ? currentInputs(realpathSync(opts.package)).package : undefined,
  width,
  scenes: {},
  failures: {},
};
try {
  const idle = opts.product === 'claude' ? (p) => p.includes('❯') && p.includes('shift+tab') : (p) => /claude-opus|anthropic/.test(p) && p.includes('─');
  await ctx.waitFor(idle, 'startup', 45_000);
  for (const scene of scenes) {
    try {
      await scene.run(ctx);
      result.scenes[scene.name] = scene.comparable === false ? 'pi-only' : 'comparable';
    } catch (error) {
      result.failures[scene.name] = String(error.message ?? error);
      ctx.keys('Escape');
      await sleep(500);
    }
  }
} finally {
  clearInterval(watch);
  let pids = [];
  try {
    pids = appPids();
    tmux('kill-server');
  } catch {}
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch {}
  }
  await peer.close();
  sink.close();
  sink.closeAllConnections();
  const requests = (existsSync(peerLog) ? readFileSync(peerLog, 'utf8') : '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  Object.assign(result, {
    requests: requests.length,
    requestUrls: [...new Set(requests.map((r) => r.url))],
    auth: [...new Set(requests.map((r) => r.auth))],
    refusedEgress: [...new Set([...refused, ...(existsSync(egressLog) ? readFileSync(egressLog, 'utf8').trim().split('\n') : [])])],
    nonLoopbackConnections: [...remote],
  });
  writeFileSync(join(out, 'run.json'), `${JSON.stringify(result, null, 2)}\n`);
  const failed = Object.keys(result.failures).length > 0;
  if (!failed) {
    rmSync(target, { recursive: true, force: true });
    renameSync(out, target);
  }
  if (!opts.keep && !failed) rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(JSON.stringify({ ...result, scratch, captures: failed ? out : target }));
  process.exitCode = failed ? 1 : 0;
}
