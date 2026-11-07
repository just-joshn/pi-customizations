import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, onTestFinished, test } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const node = process.env['PSTACK_HELPER_NODE'] ?? process.execPath;
const npmBin = realpathSync(spawnSync('/bin/sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).stdout.trim());
const npm = npmBin.endsWith('.js') ? npmBin : join(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js');
const bun = process.env['PSTACK_HELPER_BUN'] ?? realpathSync(spawnSync('/bin/sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).stdout.trim());
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { files: string[] };
const helpers = [
  { source: 'src/subscriptions/supervisor-main.ts', output: 'dist/supervisor-main.js', before: 'Usage: pstack-routines-supervisor', after: 'Usage: PACK-STALE pstack-routines-supervisor' },
  { source: 'src/cloud/release-main.ts', output: 'dist/release-machine.js', before: 'is not set.', after: 'is PACK-STALE not set.' },
  { source: 'skills/statechart/scripts/statechart.ts', output: 'skills/statechart/scripts/statechart.js', before: 'Usage: statechart SPEC.tla', after: 'Usage: PACK-STALE statechart SPEC.tla' },
  { source: 'skills/statechart/scripts/worker.ts', output: 'skills/statechart/scripts/worker.js', before: 'console.error(messageOf(error));', after: 'console.error("PACK-STALE", messageOf(error));' },
];

function pack(name: string, mutation?: { path: string; before?: string; after: string }, withBun = true) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-pack-')));
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const source = join(home, 'package');
  mkdirSync(source);
  cpSync(join(root, 'package.json'), join(source, 'package.json'));
  for (const entry of manifest.files) cpSync(join(root, entry), join(source, entry), { recursive: true });
  let mutated: string | undefined;
  if (mutation !== undefined) {
    const file = join(source, mutation.path);
    const original = readFileSync(file, 'utf8');
    if (mutation.before !== undefined) expect(original.split(mutation.before)).toHaveLength(2);
    mutated = mutation.before === undefined ? original + mutation.after : original.replace(mutation.before, mutation.after);
    writeFileSync(file, mutated);
  }
  const bin = join(home, 'bin');
  mkdirSync(bin);
  symlinkSync(node, join(bin, 'node'));
  if (withBun) symlinkSync(bun, join(bin, 'bun'));
  const env = {
    HOME: home,
    TMPDIR: home,
    PATH: `${bin}:/usr/bin:/bin`,
    PI_CODING_AGENT_DIR: join(home, 'agent'),
    BUN_INSTALL_CACHE_DIR: join(home, 'bun-cache'),
    npm_config_userconfig: '/dev/null',
    npm_config_globalconfig: join(home, 'global.npmrc'),
    npm_config_cache: join(home, 'npm-cache'),
    npm_config_registry: 'https://registry.npmjs.org',
    npm_config_update_notifier: 'false',
  };
  const result = spawnSync(node, [npm, 'pack', '--json', '--pack-destination', home], { cwd: source, env, encoding: 'utf8', timeout: 60_000 });
  const receipts = process.env['PSTACK_HELPER_PACK_RECEIPTS'];
  if (receipts !== undefined) {
    mkdirSync(receipts, { recursive: true });
    appendFileSync(
      join(receipts, 'commands.jsonl'),
      `${JSON.stringify({ name, command: node, args: [npm, 'pack', '--json', '--pack-destination', home], cwd: source, env, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, mutation, mutatedSha256: mutated === undefined ? undefined : createHash('sha256').update(mutated).digest('hex') })}\n`,
    );
    if (mutated !== undefined) writeFileSync(join(receipts, `${name}.mutated`), mutated);
    const archive = readdirSync(home).find((file) => file.endsWith('.tgz'));
    if (archive !== undefined) {
      cpSync(join(home, archive), join(receipts, `${name}.tgz`));
      appendFileSync(
        join(receipts, 'archives.jsonl'),
        `${JSON.stringify({
          name,
          sha256: createHash('sha256')
            .update(readFileSync(join(home, archive)))
            .digest('hex'),
        })}\n`,
      );
    }
  }
  return result;
}

test('default packing accepts unchanged prebuilt helpers', () => {
  const result = pack('unchanged');
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('justjoshn-pi-pstack-');
});

test.for(helpers)('default packing rejects stale source for $output', ({ source, output, before, after }) => {
  const result = pack(`source-${output.replaceAll('/', '-')}`, { path: source, before, after });
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain(`Stale helper ${output}.`);
});

test.for(helpers)('default packing rejects stale emitted $output', ({ output }) => {
  const result = pack(`output-${output.replaceAll('/', '-')}`, { path: output, after: '\nconsole.error("PACK-STALE");\n' });
  expect(result.status, result.stderr).toBe(1);
  expect(result.stderr).toContain(`Stale helper ${output}.`);
});

test('a producer without Bun cannot bypass the helper check', () => {
  const result = pack('no-bun-producer', undefined, false);
  expect(result.status, result.stderr).toBe(127);
  expect(result.stderr).toMatch(/bun: (command )?not found/);
});
