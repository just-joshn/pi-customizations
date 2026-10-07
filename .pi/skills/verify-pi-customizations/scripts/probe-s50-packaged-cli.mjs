import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const packagePath = join(root, 'extensions/pi-s50');
function command(cwd, binary, args) {
  const result = spawnSync(binary, args, { cwd, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${binary} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test('packed s50 installs a shell command that runs from node_modules', () => {
  const scratch = mkdtempSync(join(tmpdir(), 's50-packed-cli-'));
  try {
    command(packagePath, 'bun', ['pm', 'pack', '--destination', scratch]);
    const archive = readdirSync(scratch).find((name) => name.endsWith('.tgz'));
    assert.ok(archive, 'packing must produce an archive');
    const consumer = join(scratch, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({ name: 's50-consumer', private: true, type: 'module', dependencies: { 'pi-s50': `file:${join(scratch, archive)}`, '@earendil-works/pi-coding-agent': '1.0.4', typebox: '1.3.27' } }),
    );
    command(consumer, 'bun', ['install', '--offline']);
    const output = command(consumer, join(consumer, 'node_modules/.bin/s50'), ['status']);
    assert.equal(output.trim(), 'no run in .s50/');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
