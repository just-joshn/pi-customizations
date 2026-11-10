import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, onTestFinished, test } from 'vitest';

const script = join(realpathSync(fileURLToPath(new URL('../packaging', import.meta.url))), 'install-supervisor-unit.sh');
const supervisorBin = join(realpathSync(fileURLToPath(new URL('../bin', import.meta.url))), 'pstack-routines-supervisor');

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('fails usage without --workspace', () => {
  const result = spawnSync(script, [], { encoding: 'utf8' });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('--workspace');
});

test.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('dry-run writes a user unit and does not call the service manager', () => {
  const workspace = tempDir('pstack-unit-ws-');
  const outdir = tempDir('pstack-unit-out-');
  const home = tempDir('pstack-unit-home-');
  const stubs = join(home, 'stubs');
  mkdirSync(stubs);
  writeFileSync(join(stubs, 'launchctl'), '#!/bin/sh\necho launchctl >> "$HOME/service-manager-invoked"\nexit 99\n');
  writeFileSync(join(stubs, 'systemctl'), '#!/bin/sh\necho systemctl >> "$HOME/service-manager-invoked"\nexit 99\n');
  chmodSync(join(stubs, 'launchctl'), 0o755);
  chmodSync(join(stubs, 'systemctl'), 0o755);

  const result = spawnSync(script, ['--workspace', workspace, '--dry-run', outdir], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${stubs}:${process.env['PATH'] ?? ''}` },
  });

  expect(result.status, result.stderr).toBe(0);
  const written = result.stdout.trim();
  const extension = process.platform === 'darwin' ? '.plist' : '.service';
  expect(written.startsWith(`${outdir}/`)).toBe(true);
  expect(written.endsWith(extension)).toBe(true);
  const body = readFileSync(written, 'utf8');
  expect(body).toContain(workspace);
  expect(body).toContain(supervisorBin);
  expect(existsSync(join(home, 'service-manager-invoked'))).toBe(false);
  expect(existsSync(join(home, 'Library', 'LaunchAgents'))).toBe(false);
  expect(existsSync(join(home, '.config', 'systemd', 'user'))).toBe(false);
});
