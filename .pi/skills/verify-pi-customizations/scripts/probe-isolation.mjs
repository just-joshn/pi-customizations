#!/usr/bin/env node
// Measures what a drive observes with and without `--no-extensions`, so the isolation claim is
// rerunnable rather than remembered. Prints the command names each mode reports and the difference.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const PACKAGE = join(ROOT, 'extensions/pi-pstack');

function commands(extraArgs) {
  const scratch = mkdtempSync(join(tmpdir(), 'isolation-probe-'));
  try {
    const out = execFileSync('pi', ['--mode', 'rpc', '--no-session', ...extraArgs, '-e', PACKAGE], {
      cwd: scratch,
      env: { ...process.env, PI_CODING_AGENT_DIR: scratch },
      encoding: 'utf8',
      input: '{"id":"1","type":"get_commands"}\n',
      timeout: 120_000,
    });
    const record = out
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((entry) => entry.id === '1');
    return record.data.commands
      .filter((command) => command.source === 'extension')
      .map((command) => command.name)
      .sort();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const isolated = commands(['--no-extensions']);
const contaminated = commands([]);
const extras = contaminated.filter((name) => !isolated.includes(name));

const lines = [
  `isolated (--no-extensions): ${isolated.length} extension commands: ${isolated.join(', ')}`,
  `default (built-ins loaded): ${contaminated.length} extension commands`,
  `difference: ${extras.length} ${extras.join(', ') || '(none)'}`,
];
console.log(lines.join('\n'));

const outDir = join(ROOT, 'artifacts/baseline');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'isolation-probe.txt'), `${lines.join('\n')}\n`);
