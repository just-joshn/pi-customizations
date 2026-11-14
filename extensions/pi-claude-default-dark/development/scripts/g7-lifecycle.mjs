import { copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { finish, harness, json, lines, packageDir, sleep, USER_MESSAGE_BG } from './gate-harness.mjs';

const checks = [];
const h = await harness('g7', (_body, text) => `G7 reply ${text}`);
const installed = 'claude-default-dark: installed; parity requires separate verification';
const themed = (ansi) => USER_MESSAGE_BG.test(ansi);
const add = (name, pass, evidence) => checks.push({ name, verdict: pass ? 'PASS' : 'FAIL', evidence });
const settings = (config, theme) => {
  const path = join(config, 'settings.json');
  json(path, { ...JSON.parse(readFileSync(path, 'utf8')), theme });
};
async function talk(tui, marker) {
  await tui.send(marker);
  await tui.wait((text) => text.includes(`G7 reply ${marker}`), marker);
  return tui.capture(marker);
}
async function step(name, action) {
  try {
    await action();
  } catch (error) {
    checks.push({ name, verdict: 'INCONCLUSIVE', evidence: [String(error.stack ?? error), h.out] });
  }
}
const config = h.config('agent');
try {
  const install = await h.cli(config, ['install', packageDir], 'install');
  const list = await h.cli(config, ['list'], 'list-installed');
  add('local path install appears in pi list', install.code === 0 && list.code === 0 && list.output.includes(packageDir), [join(h.out, 'install.txt'), join(h.out, 'list-installed.txt')]);
  await step('installed status and native theme list', async () => {
    const tui = h.tui(config, [], 'discovery');
    await tui.ready();
    await tui.send('/claude-theme status');
    await tui.wait((text) => text.includes(installed), 'installed-status');
    const status = tui.capture('installed-status');
    add('status prints installed notification in TUI', tui.pane().includes(installed), [status]);
    await tui.send('/settings');
    await tui.wait((text) => text.includes('Type to search'), 'settings');
    tui.keys('T', 'h', 'e', 'm', 'e');
    await tui.wait((text) => /Theme/.test(text), 'filtered-settings');
    tui.capture('settings-dark');
    tui.keys('Enter');
    await tui.wait((text) => text.includes('claude-default-dark'), 'theme-list');
    const capture = tui.capture('theme-list');
    add('installed theme listed by native settings picker', tui.pane().includes('claude-default-dark'), [capture]);
    tui.keys('Escape');
    tui.keys('Escape');
    tui.stop();
  });
  await step('explicit dark startup and command switching', async () => {
    settings(config, 'dark');
    const tui = h.tui(config, [], 'explicit-dark');
    await tui.ready();
    const before = await talk(tui, 'dark-before-switch');
    const darkSettings = join(h.out, 'explicit-dark-settings.json');
    json(darkSettings, JSON.parse(readFileSync(join(config, 'settings.json'), 'utf8')));
    add('explicit dark is not overridden on fresh start', !themed(readFileSync(before, 'utf8')), [before, darkSettings]);
    await tui.send('/claude-theme use');
    await sleep(250);
    const after = await talk(tui, 'command-use');
    add('claude-theme use switches from dark to themed userMessageBg', themed(readFileSync(after, 'utf8')), [before, after]);
    for (let count = 1; count <= 5; count++) {
      await tui.send('/claude-theme reload-probe');
      await tui.wait((text) => text.includes('Usage: /claude-theme [status|use|verify]'), `reload-probe-${count}`);
      tui.capture(`reload-probe-${count}`);
      await tui.send('/reload');
      await tui.wait((text) => text.includes('Reloaded keybindings, extensions, skills, prompts, themes, and context files') && !text.includes('Usage: /claude-theme [status|use|verify]'), `reload-${count}`);
      tui.capture(`reload-${count}`);
    }
    await tui.send('/claude-theme status');
    await tui.wait((text) => text.includes(installed), 'status-after-reloads');
    const status = tui.capture('status-after-five-reloads');
    const count = tui.pane().split(installed).length - 1;
    add('five reloads leave exactly one status notification', count === 1, [status, ...Array.from({ length: 5 }, (_, index) => join(h.out, `reload-${index + 1}.ansi`))]);
    tui.stop();
  });
  await step('settings theme selection', async () => {
    settings(config, 'claude-default-dark');
    const tui = h.tui(config, [], 'settings-theme');
    await tui.ready();
    const capture = await talk(tui, 'settings-theme-message');
    add('settings.json selection renders userMessageBg #373737', themed(readFileSync(capture, 'utf8')), [capture]);
    tui.stop();
  });
  await step('CLI theme selection', async () => {
    settings(config, 'dark');
    const tui = h.tui(config, ['--use-theme', 'claude-default-dark'], 'cli-theme');
    await tui.ready();
    const capture = await talk(tui, 'cli-theme-message');
    const cliSettings = JSON.parse(readFileSync(join(config, 'settings.json'), 'utf8'));
    json(join(h.out, 'cli-theme-settings.json'), cliSettings);
    add('--use-theme overrides dark for this invocation', themed(readFileSync(capture, 'utf8')) && cliSettings.theme === 'dark', [capture, join(h.out, 'cli-theme-settings.json')]);
    tui.stop();
  });
  await step('continue and fork', async () => {
    settings(config, 'claude-default-dark');
    const files = () =>
      readdirSync(join(config, 'sessions'), { recursive: true })
        .filter((file) => file.endsWith('.jsonl'))
        .map((file) => join(config, 'sessions', file));
    const before = files();
    const latest = before.map((path) => ({ path, entries: lines(path) })).sort((a, b) => String(b.entries[0].timestamp).localeCompare(String(a.entries[0].timestamp)))[0];
    const tui = h.tui(config, ['--continue'], 'continue');
    await tui.ready();
    await tui.wait((text) => text.includes('cli-theme-message'), 'continued-history');
    const capture = await talk(tui, 'continued-message');
    const continuedSession = join(h.out, 'continued-session.jsonl');
    copyFileSync(latest.path, continuedSession);
    add('--continue restores history and accepts another themed turn', themed(readFileSync(capture, 'utf8')) && lines(latest.path).some((entry) => JSON.stringify(entry).includes('continued-message')), [capture, continuedSession]);
    tui.stop();
    const fork = h.tui(config, ['--fork', latest.path], 'fork');
    await fork.ready();
    await fork.wait((text) => text.includes('continued-message'), 'forked-history');
    const forkCapture = await talk(fork, 'forked-message');
    fork.stop();
    const newFiles = files().filter((path) => !before.includes(path));
    const forkEntries = newFiles.flatMap((path) => lines(path));
    const forkCopies = newFiles.map((path, index) => {
      const copy = join(h.out, `fork-session-${index}.jsonl`);
      copyFileSync(path, copy);
      return copy;
    });
    add(
      '--fork restores history and accepts another themed turn in a new session',
      themed(readFileSync(forkCapture, 'utf8')) && forkEntries.some((entry) => entry.type === 'session' && entry.parentSession === latest.path) && forkEntries.some((entry) => JSON.stringify(entry).includes('forked-message')),
      [forkCapture, ...forkCopies],
    );
  });
  await step('remove and dark restart', async () => {
    const removed = await h.cli(config, ['remove', packageDir], 'remove');
    const list = await h.cli(config, ['list'], 'list-removed');
    add('pi remove removes local source', removed.code === 0 && list.code === 0 && !list.output.includes(packageDir), [join(h.out, 'remove.txt'), join(h.out, 'list-removed.txt')]);
    const missing = h.tui(config, [], 'removed-saved-theme');
    await missing.ready();
    const missingCapture = missing.capture('removed-saved-theme-startup');
    const warning = missing
      .pane()
      .split('\n')
      .filter((line) => /theme|Theme|Fell back/.test(line));
    json(join(h.out, 'uninstall-warning.json'), { observedNativeWarning: warning });
    add(
      'saved missing-theme warning is recorded without extension load errors',
      warning.some((line) => /Theme not found: claude-default-dark/.test(line)) && warning.some((line) => /Fell back/.test(line)) && !/Error loading extension|Failed to load extension|Cannot find module/.test(missing.pane()),
      [missingCapture, join(h.out, 'uninstall-warning.json')],
    );
    missing.stop();
    const tui = h.tui(config, ['--use-theme', 'dark'], 'removed-dark');
    await tui.ready();
    const capture = await talk(tui, 'removed-dark-message');
    const text = tui.pane();
    add('removed package starts on native dark and handles a turn', !themed(readFileSync(capture, 'utf8')) && !/Error loading extension|Failed to load extension|Cannot find module/.test(text), [
      capture,
      join(h.out, 'removed-saved-theme-startup.ansi'),
    ]);
    await tui.send('/claude-theme status');
    await sleep(300);
    const absent = tui.capture('removed-command');
    add('removed command no longer prints installed status', !tui.pane().includes(installed), [absent]);
    tui.stop();
  });
} finally {
  const network = await h.close();
  add('zero non-loopback connections or attempted egress', network.nonLoopbackConnections.length + network.intercepted.length + network.refusedEgress.length === 0, [join(h.out, 'network.json')]);
  finish('g7', checks);
}
