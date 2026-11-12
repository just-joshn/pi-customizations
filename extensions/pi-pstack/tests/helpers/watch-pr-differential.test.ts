import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, onTestFinished, test } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixtures = [
  { name: 'help', argv: ['--help'] },
  { name: 'invalid PR', argv: ['--pr', '0'] },
  { name: 'conflicting modes', argv: ['--stack', '--queued-stack'] },
  { name: 'merged', state: 'MERGED' },
  { name: 'closed', state: 'CLOSED' },
  { name: 'ready', state: 'OPEN' },
  { name: 'draft', state: 'OPEN', draft: true },
  { name: 'failed check', state: 'OPEN', check: 'fail' },
  { name: 'pending check', state: 'OPEN', check: 'pending' },
  { name: 'query failure', state: 'OPEN', error: true },
  { name: 'ready policy', state: 'OPEN', watch: true, expected: 0 },
  { name: 'draft policy', state: 'OPEN', draft: true, watch: true, expected: 6 },
  { name: 'failed check policy', state: 'OPEN', check: 'fail', watch: true, expected: 4 },
];

test.for(fixtures)('Node bundle matches Bun source for $name without installing dependencies', (fixture) => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-watch-diff-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const installed = join(dir, 'node_modules/@justjoshn/pi-pstack');
  mkdirSync(join(installed, 'dist'), { recursive: true });
  writeFileSync(join(installed, 'package.json'), '{"type":"module"}\n');
  copyFileSync(join(root, 'dist/watch-pr.js'), join(installed, 'dist/watch-pr.js'));
  const launcherDir = join(installed, 'generated/skills/poteto-mode/scripts/watch-pr');
  mkdirSync(launcherDir, { recursive: true });
  const launcher = join(launcherDir, 'watch-pr');
  copyFileSync(join(root, 'generated/skills/poteto-mode/scripts/watch-pr/watch-pr'), launcher);
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  const preload = join(dir, 'clock.mjs');
  writeFileSync(preload, 'Date.prototype.toISOString = () => "2026-11-11T00:00:00.000Z";\n');
  const gh = join(bin, 'gh');
  writeFileSync(gh, `#!/bin/sh
if [ "$FIXTURE_ERROR" = true ]; then printf 'fixture query failure' >&2; exit 1; fi
case "$1 $2" in
  'pr view') printf '%s' "$FIXTURE_PR" ;;
  'pr checks') printf '%s' "$FIXTURE_CHECKS" ;;
  'api graphql') printf '%s' '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}},"commits":{"nodes":[]}}}}}' ;;
  *) exit 90 ;;
esac
`);
  chmodSync(gh, 0o755);
  const env = {
    ...process.env, PATH: bin, HOME: dir,
    FIXTURE_ERROR: String(fixture.error ?? false),
    FIXTURE_PR: JSON.stringify({ state: fixture.state, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED', headRefOid: 'abc', headRefName: 'feature', baseRefName: 'main', mergedAt: fixture.state === 'MERGED' ? '2026-11-11T00:00:00Z' : null, isDraft: fixture.draft ?? false }),
    FIXTURE_CHECKS: JSON.stringify([{ name: 'unit', state: fixture.check === 'fail' ? 'FAILURE' : fixture.check === 'pending' ? 'PENDING' : 'SUCCESS', bucket: fixture.check ?? 'pass', description: 'fixture', link: 'https://example.com/check', workflow: 'test' }]),
  };
  const argv = fixture.argv ?? ['--owner', 'example', '--repo', 'repo', '--pr', '1', ...(fixture.watch ? [] : ['--status-only']), '--max-query-errors', '1'];
  const bunPath = spawnSync('/bin/sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).stdout.trim();
  const upstream = spawnSync(bunPath, ['--preload', preload, join(root, 'generated/skills/poteto-mode/scripts/watch-pr/watch-pr'), ...argv], { cwd: dir, env, encoding: 'utf8', timeout: 5_000 });
  const bundled = spawnSync(process.execPath, ['--import', preload, join(installed, 'dist/watch-pr.js'), ...argv], { cwd: dir, env, encoding: 'utf8', timeout: 5_000 });
  const launched = spawnSync(launcher, argv, { cwd: dir, env: { ...env, NODE_OPTIONS: `--import=${preload}` }, encoding: 'utf8', timeout: 5_000 });
  expect(launched.error).toBeUndefined();
  expect(launched.status).toBe(bundled.status);
  expect(launched.stdout).toBe(bundled.stdout);
  expect(launched.stderr).toBe(bundled.stderr);
  expect(upstream.error).toBeUndefined();
  expect(bundled.error).toBeUndefined();
  expect(upstream.status).toBe(fixture.expected ?? (fixture.error ? 7 : fixture.name === 'invalid PR' || fixture.name === 'conflicting modes' ? 64 : 0));
  expect(bundled.status).toBe(upstream.status);
  expect(bundled.stdout).toBe(upstream.stdout);
  expect(bundled.stderr).toBe(upstream.stderr);
  if (fixture.state) expect(JSON.parse(bundled.stdout)).toHaveProperty('exitCode');
});
