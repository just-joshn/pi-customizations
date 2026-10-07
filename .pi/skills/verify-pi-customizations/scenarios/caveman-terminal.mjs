import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { baseCavemanEnv, CAVEMAN_PACKAGE, closeCavemanSessions, prepareFixture, writeRaw } from './caveman-fixture.js';

const STEP_TIMEOUT_MS = 40000;
const POLL_MS = 250;

function shquote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function have(command) {
  try {
    return execFileSync('/bin/sh', ['-c', `command -v ${command}`], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return false;
  }
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function createPaneDriver(context, { socket, session }) {
  const tmux = (args) => execFileSync('tmux', ['-L', socket, '-f', '/dev/null', ...args], { encoding: 'utf8', timeout: 20000 });
  const capture = () => tmux(['capture-pane', '-p', '-t', session]);
  const captureAnsi = () => tmux(['capture-pane', '-p', '-e', '-t', session]);
  const save = (name, plain, ansi) => {
    writeRaw(context, `${name}.txt`, plain);
    writeRaw(context, `${name}.ansi.txt`, ansi);
    return context.rawPath(`${name}.txt`);
  };
  const waitForPane = async (literal, description) => {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    let text = capture();
    while (Date.now() < deadline) {
      if (text.includes(literal)) return text;
      pause(POLL_MS);
      text = capture();
    }
    throw new Error(`timed out waiting for ${description ?? JSON.stringify(literal)}; last pane ${save('timeout-pane', text, captureAnsi())}`);
  };
  const waitForBadgeClear = async () => {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    for (;;) {
      const text = capture();
      if (!text.includes('[ULTRACAVE]') && !text.includes('[CAVEMAN]')) return text;
      if (Date.now() > deadline) throw new Error('timed out waiting for the badge to clear after "stop caveman"');
      pause(POLL_MS);
    }
  };
  const send = (text) => {
    tmux(['send-keys', '-l', '-t', session, text]);
    tmux(['send-keys', '-t', session, 'Enter']);
    pause(180);
  };
  return { tmux, capture, captureAnsi, save, waitForPane, waitForBadgeClear, send };
}

async function drivePanes(driver) {
  const badge = await driver.waitForPane('[CAVEMAN]', 'the [CAVEMAN] footer badge');
  const badgeAnsi = driver.captureAnsi();
  driver.save('01-caveman-badge', badge, badgeAnsi);

  driver.send('/ultracave');
  const ultra = await driver.waitForPane('[ULTRACAVE]', 'the [ULTRACAVE] footer badge');
  driver.save('02-ultracave-badge', ultra, driver.captureAnsi());

  driver.send('stop caveman');
  const cleared = await driver.waitForBadgeClear();
  driver.save('03-badge-cleared', cleared, driver.captureAnsi());

  driver.send('/caveman');
  const back = await driver.waitForPane('[CAVEMAN]', 'the badge after /caveman');
  driver.save('04-caveman-restored', back, driver.captureAnsi());

  driver.send('hello from the terminal');
  await driver.waitForPane('SCRIPTED_ACK', 'the scripted model reply');
  driver.save('05-model-reply', driver.capture(), driver.captureAnsi());

  driver.send('/caveman-help');
  const help = await driver.waitForPane('Configure Default Mode', 'the rendered caveman-help card');
  driver.save('06-help-card', help, driver.captureAnsi());

  driver.send('/caveman-stats');
  const stats = await driver.waitForPane('Turns:', 'the rendered caveman-stats report');
  driver.save('07-stats-report', stats, driver.captureAnsi());

  return { badge, badgeAnsi, ultra, cleared, back, help, stats };
}

function judgeTerminal(receipts, context, panes) {
  const badgeOk = panes.badge.includes('[CAVEMAN]') && panes.badgeAnsi.includes('38;5;3') && panes.ultra.includes('[ULTRACAVE]') && !panes.cleared.includes('[ULTRACAVE]') && panes.back.includes('[CAVEMAN]');
  receipts.write({
    surfaceId: 'CV-UI-1',
    package: CAVEMAN_PACKAGE,
    expected: 'The status key caveman renders a badge with the active mode name in the warning color.',
    observed: `pane footer: [CAVEMAN] then [ULTRACAVE] then cleared by "stop caveman" then [CAVEMAN]; ANSI ${JSON.stringify(panes.badgeAnsi.split('\n').find((line) => line.includes('[CAVEMAN]')) ?? '')}`,
    evidence: context.rawPath('01-caveman-badge.txt'),
    verdict: badgeOk ? 'verified' : 'failed',
    reason: badgeOk ? null : 'terminal badge sequence did not match the expected modes and warning color',
  });
  const statsLines = panes.stats
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('Caveman Stats') || /^Turns:/.test(line))
    .slice(0, 3);
  const renderOk = panes.help.includes('Configure Default Mode') && panes.stats.includes('Caveman Stats') && /Turns:\s+\d+/.test(panes.stats);
  receipts.write({
    surfaceId: 'CV-UI-3',
    package: CAVEMAN_PACKAGE,
    expected: 'The caveman-help and caveman-stats custom messages render as Markdown report messages in the terminal.',
    observed: `help pane contains ${JSON.stringify('Configure Default Mode')} and the stats pane contains ${JSON.stringify(statsLines)}`,
    evidence: context.rawPath('06-help-card.txt'),
    verdict: renderOk ? 'verified' : 'failed',
    reason: renderOk ? null : 'the help card or the stats report did not render in the terminal pane',
  });
}

export default async function cavemanTerminal(context) {
  if (!have('tmux')) throw new Error('tmux is required for the terminal drive but was not found on PATH');
  const piBin = execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim();
  const pkg = join(context.repoRoot, CAVEMAN_PACKAGE);
  prepareFixture(context.scratchDir);
  const env = baseCavemanEnv(context.scratchDir);
  const socket = `caveman-term-${process.pid}`;
  const session = 'caveman-terminal';
  const driver = createPaneDriver(context, { socket, session });
  const startCommand = [shquote(piBin), '-e', shquote(pkg), '-e', shquote(join(context.scratchDir, 'extensions', 'caveman-scripted.ts')), '--model', 'caveman-scripted/smoke', '--no-session', '-a', '-nc'].join(' ');

  try {
    driver.tmux(['new-session', '-d', '-x', '120', '-y', '40', '-s', session, '-c', context.scratchDir, ...Object.entries(env).flatMap(([name, value]) => (value === undefined ? [] : ['-e', `${name}=${value}`])), startCommand]);
    judgeTerminal(context.receipts, context, await drivePanes(driver));
  } finally {
    spawnSync('tmux', ['-L', socket, '-f', '/dev/null', 'kill-server'], { stdio: 'ignore' });
    // tmux leaves the socket file behind on macOS after the server exits.
    rmSync(join('/tmp', `tmux-${process.getuid()}`, socket), { force: true });
    rmSync(join(tmpdir(), `tmux-${process.getuid()}`, socket), { force: true });
    await closeCavemanSessions(context);
  }
}
