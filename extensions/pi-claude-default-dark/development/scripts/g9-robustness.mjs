import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { currentInputs, rollup } from '../lib/gates.ts';
import { requireLsof } from './lsof.mjs';

const dev = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = { package: currentInputs(join(dev, '..')).package };
const packageDir = resolve(dev, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runPi(name, { themeText, selected = 'claude-default-dark', commands = [], installed = false, colorTerm = 'truecolor' } = {}) {
  requireLsof();
  const out = join(dev, 'results', name);
  mkdirSync(out, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'claude-theme-gate-'));
  const home = join(scratch, 'home');
  const config = join(scratch, 'agent');
  const work = join(scratch, 'work');
  const stubs = join(scratch, 'stubs');
  for (const dir of [home, config, work, stubs, join(config, 'themes')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(stubs, 'ssh'), `#!/bin/sh\necho "ssh $*" >> '${out}/ssh.log'\nexit 255\n`, { mode: 0o755 });
  if (themeText !== undefined) writeFileSync(join(config, 'themes/claude-default-dark.json'), themeText);
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ theme: selected, packages: installed ? [packageDir] : [], defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-5' }));
  const refused = [];
  const sink = createServer((req, res) => {
    refused.push(`HTTP ${req.headers.host} ${req.url}`);
    res.writeHead(403).end();
  });
  sink.on('connect', (req, socket) => {
    refused.push(`CONNECT ${req.url}`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise((r) => sink.listen(0, '127.0.0.1', r));
  const proxy = `http://127.0.0.1:${sink.address().port}`;
  const env = {
    HOME: home,
    PATH: `${stubs}:${process.env.PATH}`,
    LANG: 'en_US.UTF-8',
    TERM: 'xterm-256color',
    PI_CODING_AGENT_DIR: config,
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    HTTPS_PROXY: proxy,
    HTTP_PROXY: proxy,
    ALL_PROXY: proxy,
    NO_PROXY: '127.0.0.1,localhost',
  };
  if (colorTerm !== null) env.COLORTERM = colorTerm;
  const socket = `claude-gate-${process.pid}-${name}`;
  const tmux = (...args) => execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const pane = (escapes = false) => tmux('capture-pane', '-p', ...(escapes ? ['-e'] : []), '-S', '-2000', '-t', 'gate');
  const nonLoopback = new Set();
  let pids = [];
  const inspect = () => {
    try {
      pids = [tmux('display-message', '-p', '-t', 'gate', '#{pane_pid}').trim()];
      for (let i = 0; i < pids.length; i++) {
        const children = spawnSync('pgrep', ['-P', pids[i]], { encoding: 'utf8' }).stdout.trim();
        if (children) pids.push(...children.split('\n'));
      }
      for (const pid of pids) {
        const connections = spawnSync('lsof', ['-a', '-n', '-P', '-p', pid, '-i'], { encoding: 'utf8' }).stdout.split('\n').slice(1);
        for (const line of connections) if (line && !/127\.0\.0\.1|\[::1\]|localhost/.test(line)) nonLoopback.add(line.replace(/\s+/g, ' '));
      }
    } catch {}
  };
  let ready = false;
  let error;
  let watcher;
  const snapshots = [];
  try {
    tmux('new-session', '-d', '-s', 'gate', '-x', '120', '-y', '50', '-c', work, 'env', '-i', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), 'pi', '--no-session', ...(installed ? [] : ['-e', join(packageDir, 'extensions/index.ts')]));
    watcher = setInterval(inspect, 400);
    const end = Date.now() + 25_000;
    while (Date.now() < end) {
      await sleep(200);
      const text = pane();
      if (text.includes('v1.5.2') && text.includes('─')) {
        ready = true;
        break;
      }
    }
    await sleep(500);
    snapshots.push({ action: 'startup', text: pane() });
    writeFileSync(join(out, 'startup.ansi'), pane(true));
    for (const [i, command] of commands.entries()) {
      tmux('send-keys', '-t', 'gate', '-l', command);
      tmux('send-keys', '-t', 'gate', 'Enter');
      let previous = '';
      let stable = 0;
      for (let n = 0; n < 30 && stable < 4; n++) {
        await sleep(200);
        const text = pane();
        stable = text === previous ? stable + 1 : 0;
        previous = text;
      }
      snapshots.push({ action: command, text: pane() });
      writeFileSync(join(out, `command-${i}.ansi`), pane(true));
    }
    inspect();
    writeFileSync(join(out, 'screen.ansi'), pane(true));
  } catch (e) {
    error = String(e);
  } finally {
    clearInterval(watcher);
    try {
      tmux('kill-server');
    } catch {}
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {}
    }
    sink.closeAllConnections();
    await new Promise((r) => sink.close(r));
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  writeFileSync(join(out, 'screens.json'), `${JSON.stringify(snapshots, null, 2)}\n`);
  const result = { ready, error, ansi: join(out, 'screen.ansi'), snapshots: join(out, 'screens.json'), refusedEgress: refused, nonLoopbackConnections: [...nonLoopback], term: env.TERM, COLORTERM: colorTerm ?? 'unset', selected, installed };
  writeFileSync(join(out, 'run.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checks = [];
  const themePath = join(packageDir, 'themes/claude-default-dark.json');
  const theme = JSON.parse(readFileSync(themePath, 'utf8'));
  const fixtures = {
    'bad-color': JSON.stringify({ ...theme, colors: { ...theme.colors, accent: '#notrgb' } }),
    'missing-role': JSON.stringify({ ...theme, colors: Object.fromEntries(Object.entries(theme.colors).filter(([role]) => role !== 'accent')) }),
    'invalid-json': '{"name":"claude-default-dark", broken',
  };
  for (const [name, themeText] of Object.entries(fixtures)) {
    const out = join(dev, 'results', `g9-${name}`);
    mkdirSync(out, { recursive: true });
    const fixture = join(out, 'theme.json');
    writeFileSync(fixture, themeText);
    const validation = spawnSync(process.execPath, ['scripts/validate-theme.mjs', fixture], { cwd: dev, encoding: 'utf8' });
    const log = join(out, 'validation.log');
    writeFileSync(log, `${validation.stdout}\n${validation.stderr}`);
    checks.push({ name: `${name}-validator`, verdict: validation.status !== 0 && /invalid|error|missing|parse|json|color/i.test(validation.stderr) ? 'PASS' : 'FAIL', evidence: { path: log, exit: validation.status } });
    const run = await runPi(`g9-${name}`, { themeText, commands: ['/claude-theme status', '/claude-theme use'] });
    const screens = JSON.parse(readFileSync(run.snapshots, 'utf8'));
    const startup = screens[0]?.text ?? '';
    const visibleError = /(?:failed|invalid|error|not found|missing|unexpected|cannot|could not)/i.test(startup);
    checks.push({
      name: `${name}-real-pi`,
      verdict: run.ready && visibleError ? 'PASS' : 'FAIL',
      evidence: { ...run, startup, requirement: 'Selected malformed theme must report a visible load error and keep Pi usable rather than silently falling back.' },
    });
  }
  const collision = structuredClone(theme);
  collision.colors.accent = '#010203';
  const collisionRun = await runPi('g9-collision', { themeText: JSON.stringify(collision), installed: true, commands: ['/claude-theme status', '/claude-theme use'] });
  const collisionAnsi = existsSync(collisionRun.ansi) ? readFileSync(collisionRun.ansi, 'utf8') : '';
  const localColor = /\x1b\[38;2;1;2;3m/.test(collisionAnsi);
  const collisionText = JSON.parse(readFileSync(collisionRun.snapshots, 'utf8'))[0]?.text ?? '';
  const collisionWarning = /"claude-default-dark" collision:/.test(collisionText) && collisionText.includes('✓ auto (user)') && collisionText.includes('(skipped)');
  checks.push({
    name: 'name-collision',
    verdict: collisionRun.ready && collisionWarning ? 'PASS' : 'INCONCLUSIVE',
    evidence: {
      ...collisionRun,
      localAccentObserved: localColor,
      collisionWarning,
      resolution: collisionWarning
        ? 'Pi displays a Theme conflicts warning. It marks the scratch agent themes/claude-default-dark.json as selected with ✓ auto (user), and marks the package themes/claude-default-dark.json as skipped.'
        : 'No explicit precedence warning was observed. Theme precedence cannot be inferred from a successful status notification.',
    },
  });
  const absent = await runPi('g9-absent', { selected: 'dark', commands: ['/claude-theme status', '/claude-theme use'] });
  const absentScreens = JSON.parse(readFileSync(absent.snapshots, 'utf8'));
  checks.push({ name: 'absent-status', verdict: /theme resource not found/.test(absentScreens[1]?.text ?? '') ? 'PASS' : 'FAIL', evidence: absent.snapshots });
  checks.push({ name: 'absent-use', verdict: /(?:theme.*not found|failed.*theme|unknown theme)/i.test(absentScreens[2]?.text ?? '') ? 'PASS' : 'FAIL', evidence: absent.snapshots });
  const present = await runPi('g9-present', { installed: true, commands: ['/claude-theme status'] });
  const source = readFileSync(join(packageDir, 'extensions/index.ts'), 'utf8');
  const status = JSON.parse(readFileSync(present.snapshots, 'utf8'))[1]?.text ?? '';
  const staticSafe = source.includes('parity requires separate verification') && !/parity\s+(?:passed|verified|achieved|100%)/i.test(source);
  checks.push({
    name: 'status-no-parity-claim',
    verdict: staticSafe && /installed; parity requires separate verification/.test(status) ? 'PASS' : 'FAIL',
    evidence: { source: 'extensions/index.ts', staticSafe, dynamic: present.snapshots },
  });
  const runs = [...Object.keys(fixtures).map((name) => `g9-${name}`), 'g9-collision', 'g9-absent', 'g9-present'].map((name) => ({ name, ...JSON.parse(readFileSync(join(dev, 'results', name, 'run.json'), 'utf8')) }));
  checks.push({
    name: 'zero-observed-nonloopback-connections',
    verdict: runs.every((r) => r.nonLoopbackConnections.length === 0 && r.refusedEgress.length === 0) ? 'PASS' : 'FAIL',
    evidence: {
      runs: runs.map((r) => ({ name: r.name, nonLoopbackConnections: r.nonLoopbackConnections, refusedEgress: r.refusedEgress })),
      limitation: 'lsof samples descendant sockets every 400ms. Proxy sink and ssh stub refuse egress; sampling does not prove absence of sub-400ms direct sockets.',
    },
  });
  const verdict = rollup(checks);
  writeFileSync(join(dev, 'results/g9.json'), `${JSON.stringify({ gate: 'G9', verdict, inputs, checks }, null, 2)}\n`);
  console.log(JSON.stringify({ gate: 'G9', verdict }));
  process.exitCode = verdict === 'PASS' ? 0 : 1;
}
