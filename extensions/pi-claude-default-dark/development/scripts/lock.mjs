import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { CAPTURE_GEOMETRY } from './geometry.mjs';
import { binaryVersion, PINS, resolvePinnedClaude } from './pins.mjs';

const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opts } = parseArgs({ options: { check: { type: 'boolean', default: false }, lock: { type: 'string' } } });
const lockPath = opts.lock ?? join(dev, 'reference-lock.json');
const palettePath = join(dev, 'captures/terminal-palette.json');
const capturesDir = join(dev, 'captures/claude');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const which = (cmd) => realpathSync(cmd.includes('/') ? cmd : run('/bin/sh', ['-c', `command -v ${cmd}`]));

const claude = resolvePinnedClaude();
const piVersion = binaryVersion('pi');
if (piVersion !== PINS.pi) {
  console.error(`version mismatch: pi ${piVersion} (want ${PINS.pi})`);
  process.exit(1);
}

const piPackage = join(homedir(), '.pi/agent/install/releases', PINS.pi, 'node_modules/@earendil-works/pi-coding-agent');
const piHash = createHash('sha256');
for (const file of ['package.json', 'dist/cli.js', 'dist/modes/interactive/theme/dark.json']) piHash.update(readFileSync(join(piPackage, file)));

const alacritty = '/Applications/Alacritty.app/Contents';
const alacrittyVersion = run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleShortVersionString', join(alacritty, 'Info.plist')]);
const alacrittyConfig = readFileSync(join(homedir(), '.config/alacritty/alacritty.toml'), 'utf8');
const fontSize = Number(alacrittyConfig.match(/^size\s*=\s*([\d.]+)/m)?.[1] ?? Number.NaN);
const fontFamily = alacrittyConfig.match(/^family\s*=\s*"([^"]+)"/m)?.[1] ?? 'Menlo';
const palette = existsSync(palettePath) ? JSON.parse(readFileSync(palettePath, 'utf8')) : null;

const captureHash = existsSync(capturesDir)
  ? (() => {
      const hash = createHash('sha256');
      for (const file of readdirSync(capturesDir)
        .filter((f) => f.endsWith('.ansi'))
        .sort())
        hash.update(file).update(readFileSync(join(capturesDir, file)));
      return hash.digest('hex');
    })()
  : null;

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const recorded = JSON.parse(JSON.stringify(lock));
lock.target.actual_binary_sha256 = sha256(which(claude));
lock.target.palette_capture_sha256 = captureHash;
lock.host.actual_binary_sha256 = piHash.digest('hex');
lock.terminal = {
  emulator: 'Alacritty',
  emulator_version: alacrittyVersion,
  operating_system: `macOS ${run('sw_vers', ['-productVersion'])} ${run('uname', ['-m'])}`,
  font: fontFamily,
  font_size: Number.isFinite(fontSize) ? fontSize : null,
  ...CAPTURE_GEOMETRY,
  background_rgb: palette?.background_rgb ?? null,
  foreground_rgb: palette?.foreground_rgb ?? null,
  ansi16_rgb: palette?.ansi16_rgb?.every(Boolean) ? palette.ansi16_rgb : null,
};

const recordedOnly = new Set(['terminal.font', 'terminal.font_size']);

if (opts.check) {
  const drift = [];
  for (const section of ['target', 'host', 'terminal'])
    for (const key of new Set([...Object.keys(recorded[section] ?? {}), ...Object.keys(lock[section])]))
      if (!recordedOnly.has(`${section}.${key}`) && JSON.stringify(recorded[section]?.[key]) !== JSON.stringify(lock[section][key])) drift.push(`${section}.${key}`);
  if (recorded.target.version !== PINS.claude) drift.push('target.version');
  if (recorded.host.version !== PINS.pi) drift.push('host.version');
  console.log(JSON.stringify({ drift }));
  process.exit(drift.length ? 1 : 0);
}

const nulls = [];
const walk = (value, path) => {
  if (value === null) nulls.push(path);
  else if (typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
};
walk(lock.target, 'target');
walk(lock.host, 'host');
walk(lock.terminal, 'terminal');
lock.test_results.G0 = nulls.length === 0 ? 'PASS' : 'INCONCLUSIVE';
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
console.log(JSON.stringify({ G0: lock.test_results.G0, missing: nulls }));
