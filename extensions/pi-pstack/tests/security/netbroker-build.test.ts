import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, onTestFinished, test } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const committed = join(root, 'dist/netbroker-s390x');
const pinnedVersion = /ZIG_VERSION = '([^']+)'/.exec(readFileSync(join(root, 'scripts/build-netbroker.mjs'), 'utf8'))?.[1] ?? '';

const STUB = `#!/bin/sh
case "$1" in
  version) echo "$STUB_VERSION" ;;
  cc) while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done; cat "$STUB_BYTES" > "$out" ;;
esac
`;

function check(bytes: Buffer): { status: number | null; stdout: string; stderr: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pi-pstack-netbroker-')));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const zig = join(dir, 'zig');
  const built = join(dir, 'built');
  writeFileSync(zig, STUB);
  chmodSync(zig, 0o755);
  writeFileSync(built, bytes);
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(root, 'scripts/build-netbroker.mjs'), '--check'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ZIG: zig, STUB_BYTES: built, STUB_VERSION: pinnedVersion },
  });
  return { status, stdout, stderr };
}

test.skipIf(process.platform === 'win32')('check:netbroker fails without a success line when the committed binary differs from a rebuild', () => {
  const stale = check(Buffer.concat([readFileSync(committed), Buffer.from([0])]));
  expect({ status: stale.status, stderr: stale.stderr.includes('Stale dist/netbroker-s390x'), stdout: stale.stdout }).toEqual({ status: 1, stderr: true, stdout: '' });
});

test.skipIf(process.platform === 'win32')('check:netbroker passes when a rebuild matches the committed binary', () => {
  const fresh = check(readFileSync(committed));
  expect({ status: fresh.status, stdout: fresh.stdout.trim() }).toEqual({ status: 0, stdout: 'Checked dist/netbroker-s390x' });
});
