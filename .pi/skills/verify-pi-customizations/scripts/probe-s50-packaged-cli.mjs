import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const packagePath = join(root, 'extensions/pi-s50');
function command(cwd, binary, args, exitCode = 0) {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, exitCode, `${binary} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test('packed s50 entry point runs when copied under node_modules', () => {
  const scratch = mkdtempSync(join(tmpdir(), 's50-packed-cli-'));
  try {
    command(packagePath, 'bun', ['pm', 'pack', '--destination', scratch]);
    const archive = readdirSync(scratch).find((name) => name.endsWith('.tgz'));
    assert.ok(archive, 'packing must produce an archive');
    const consumer = join(scratch, 'consumer');
    const installed = join(consumer, 'node_modules/pi-s50');
    mkdirSync(installed, { recursive: true });
    mkdirSync(join(consumer, 'node_modules/.bin'));
    command(consumer, 'tar', ['-xzf', join(scratch, archive), '--strip-components=1', '-C', installed]);
    symlinkSync(join(root, 'node_modules/@earendil-works'), join(consumer, 'node_modules/@earendil-works'));
    symlinkSync(join(root, 'extensions/pi-s50/node_modules/typebox'), join(consumer, 'node_modules/typebox'));
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    symlinkSync(join(installed, manifest.bin.s50), join(consumer, 'node_modules/.bin/s50'));
    const binary = join(consumer, 'node_modules/.bin/s50');
    assert.match(command(consumer, binary, ['--help']), /^usage: s50 <command>\n/);
    assert.equal(command(consumer, binary, ['status'], 1).trim(), 'no run in .s50/');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
