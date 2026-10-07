// biome-ignore-all lint/security/noSecrets: fixture paths, not credentials
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';
import { backupDirFor, backupPathFor, isSensitivePath, stateBaseDir } from '../../src/compress/paths.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

test.for(['C:/dev/CREDENTIALS/hetzner/webhosting.md', 'project/secrets/service-notes.md', 'project/secret/service-notes.md', 'project/api-keys/service-notes.md', 'project/private_keys/service-notes.md', 'C:/Users/u/AccessKeys/notes.md'])(
  'sensitive directory %s is blocked',
  (path) => {
    expect(isSensitivePath(path)).toBe(true);
  },
);

test.for(['/a/.env.local', '/a/id_ed25519.pub', '/a/server.PEM', '/a/my-token-notes.md', '.netrc'])('sensitive basename %s is blocked', (path) => {
  expect(isSensitivePath(path)).toBe(true);
});

test.for(['/home/u/.ssh/notes.md', '/home/u/.AWS/config.md', '/home/u/.kube/readme.md'])('dot directory %s is blocked', (path) => {
  expect(isSensitivePath(path)).toBe(true);
});

test.for(['project/docs/service-notes.md', '/a/notes.md', 'README.md', 'project/docker/README.md'])('ordinary path %s is allowed', (path) => {
  expect(isSensitivePath(path)).toBe(false);
});

test('isSensitivePath allows the empty string', () => {
  expect(isSensitivePath('')).toBe(false);
});

test('backupDirFor uses XDG_DATA_HOME', () => {
  vi.stubEnv('XDG_DATA_HOME', '/data');
  expect(backupDirFor('/proj/docs/a.md')).toBe(join('/data', 'caveman-compress', 'backups', 'docs'));
});

test('backupPathFor names the backup <stem>.original.md', () => {
  vi.stubEnv('XDG_DATA_HOME', '/data');
  expect(backupPathFor('/proj/docs/a.md')).toBe(join('/data', 'caveman-compress', 'backups', 'docs', 'a.original.md'));
});

test.skipIf(process.platform === 'win32')('empty XDG_DATA_HOME falls back to HOME/.local/share', () => {
  vi.stubEnv('XDG_DATA_HOME', '');
  vi.stubEnv('HOME', '/home/tester');
  expect(stateBaseDir('locks')).toBe(join('/home/tester', '.local', 'share', 'caveman-compress', 'locks'));
});

test.skipIf(process.platform === 'win32')('unset XDG_DATA_HOME falls back to HOME/.local/share', () => {
  vi.stubEnv('XDG_DATA_HOME', undefined);
  vi.stubEnv('HOME', '/home/tester');
  expect(stateBaseDir('backups')).toBe(join('/home/tester', '.local', 'share', 'caveman-compress', 'backups'));
});
