import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { analyzeShellCommand } from '../src/core/command.ts';
import { createHarness, textOf } from './harness.ts';

/** Regressions for the fifteenth adversarial pass, wave B. Each test names the finding it locks down. */

const pathsOf = (command: string) => analyzeShellCommand(command, '/home/tester').paths;
const untrustedOf = (command: string): string | undefined => analyzeShellCommand(command, '/home/tester').untrusted;

const ARCHIVE_REASON = 'the archive members name the paths this command writes, and the analyzer does not read them';
const FILES_FROM_REASON = 'the list file names the source paths this command copies, and the analyzer does not read it';
const SCP_REASON = 'scp runs a command the analyzer does not follow';
const SFTP_REASON = 'sftp runs a command the analyzer does not follow';
const OUTSIDE_REASON = 'outside the workspace';
const POLICY_REASON = 'is the project policy file';

/** True when the host has the named command, so a platform-only test can skip instead of fail. */
function hasCommand(name: string): boolean {
  try {
    execFileSync('command', ['-v', name]);
    return true;
  } catch {
    return false;
  }
}

describe('finding 5: the tar family records its archive and directory writes for every name', () => {
  it('treats -f and -C as writes for bsdtar and gtar, exactly as it does for tar', () => {
    for (const name of ['tar', 'bsdtar', 'gtar']) {
      expect(pathsOf(`${name} -cf /outside/x.tar a.txt`), name).toContainEqual({ path: '/outside/x.tar', write: true });
      expect(pathsOf(`${name} -czf /outside/x.tgz a.txt`), name).toContainEqual({ path: '/outside/x.tgz', write: true });
      expect(pathsOf(`${name} -rf /outside/x.tar a.txt`), name).toContainEqual({ path: '/outside/x.tar', write: true });
      expect(pathsOf(`${name} -cf x.tar -C /outside a.txt`), name).toContainEqual({ path: '/outside', write: true });
      expect(pathsOf(`${name} cpf /outside/x.tar a.txt`), name).toContainEqual({ path: '/outside/x.tar', write: true });
      expect(pathsOf(`${name} --create --file /outside/x.tar a.txt`), name).toContainEqual({ path: '/outside/x.tar', write: true });
      expect(pathsOf(`${name} -tf /outside/x.tar`), name).toContainEqual({ path: '/outside/x.tar', write: false });
    }

    for (const command of ['bsdtar -cf out.tar a.txt', 'gtar -cf out.tar a.txt', 'bsdtar -tf out.tar']) {
      expect(untrustedOf(command) ?? '', command).toBe('');
    }
    expect(untrustedOf('bsdtar -xf evil.tar')).toContain(ARCHIVE_REASON);
  });

  it('refuses an outside and a policy archive, and keeps an in-workspace bsdtar round trip', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [] } });
    const outside = path.join(h.root, 'outside.tar');
    try {
      await h.write('a.txt', 'plain a\n');
      const policy = h.file('.pi/pi-tools.json');
      const before = await readFile(policy, 'utf8');

      const escaped = await h.call('bash', { command: `bsdtar -cf ${outside} a.txt` });
      const overwritten = await h.call('bash', { command: 'bsdtar -cf .pi/pi-tools.json a.txt' });
      const created = await h.call('bash', { command: 'bsdtar -cf out.tar a.txt' });
      const listed = await h.call('bash', { command: 'bsdtar -tf out.tar' });

      expect(escaped.isError).toBe(true);
      expect(textOf(escaped)).toContain(OUTSIDE_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(overwritten.isError).toBe(true);
      expect(textOf(overwritten)).toContain(POLICY_REASON);
      expect(await readFile(policy, 'utf8')).toBe(before);
      expect(created.isError).toBeUndefined();
      expect(existsSync(h.file('out.tar'))).toBe(true);
      expect(textOf(listed)).toContain('a.txt');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 6: ditto extraction writes the member paths the archive holds', () => {
  it('refuses every extraction form and keeps the copy and create forms', () => {
    for (const command of ['ditto -x -k evil.zip .', 'ditto -xk evil.zip .', 'ditto --extract -k evil.zip .', 'ditto -x evil.zip out/']) {
      expect(untrustedOf(command), command).toContain(ARCHIVE_REASON);
    }

    for (const command of ['ditto notes.txt copy', 'ditto -c -k payload pkg.zip', 'ditto --help', 'ditto -V']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('leaves the policy and the ignore file alone when the extraction is refused', async () => {
    if (!hasCommand('ditto')) {
      return;
    }
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [] } });
    const stage = path.join(h.root, 'stage');
    try {
      const payload = path.join(stage, 'payload');
      await mkdir(path.join(payload, '.pi'), { recursive: true });
      await writeFile(path.join(payload, '.pi', 'pi-tools.json'), JSON.stringify({ mode: 'unrestricted' }), 'utf-8');
      await writeFile(path.join(payload, '.piignore'), 'EVIL\n', 'utf-8');
      const zip = path.join(stage, 'evil.zip');
      execFileSync('ditto', ['-c', '-k', payload, zip]);

      const policy = h.file('.pi/pi-tools.json');
      const before = await readFile(policy, 'utf8');
      const result = await h.call('bash', { command: `ditto -x -k "${zip}" .` });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(ARCHIVE_REASON);
      expect(await readFile(policy, 'utf8')).toBe(before);
      expect(existsSync(h.file('.piignore'))).toBe(false);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 7: rsync --files-from names its source paths in a list file', () => {
  it('refuses the long option, its value forms, and its prefixes, and keeps the ordinary copies', () => {
    for (const command of ['rsync -a --files-from=list.txt . dest/', 'rsync -a --files-from list.txt . dest/', 'rsync -a --files-f=list.txt . dest/', 'rsync -a --files-from=- . dest/']) {
      expect(untrustedOf(command), command).toContain(FILES_FROM_REASON);
    }

    for (const command of ['rsync -a a.txt copy.txt', 'rsync -av a.txt dest/', 'rsync -a --exclude-from=list.txt a.txt dest/', 'rsync -a --list-only a.txt dest/']) {
      expect(untrustedOf(command), command).toBeUndefined();
    }
  });

  it('refuses the copy that would put a denied file in the destination', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    try {
      await h.write('.env', 'SECRET=1\n');
      await h.write('list.txt', '.env\n');
      await h.write('a.txt', 'plain a\n');
      await mkdir(h.file('dest'), { recursive: true });

      const listed = await h.call('bash', { command: 'rsync -a --files-from=list.txt . dest/' });
      const copied = await h.call('bash', { command: 'rsync -a a.txt dest/' });

      expect(listed.isError).toBe(true);
      expect(textOf(listed)).toContain(FILES_FROM_REASON);
      expect(existsSync(h.file('dest/.env'))).toBe(false);
      expect(copied.isError).toBeUndefined();
      expect(existsSync(h.file('dest/a.txt'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 8: scp and sftp run ssh, a transport the analyzer never reads', () => {
  it('refuses both transports in every spelling', () => {
    for (const command of ['scp -q a.txt host:/tmp/x', 'scp a.txt /outside/scp.txt', 'scp -r dir host:dir', 'scp host:a.txt .', 'scp -P 22 a.txt host:x']) {
      expect(untrustedOf(command), command).toContain(SCP_REASON);
    }
    for (const command of ['sftp -q host', 'sftp -b batch.txt host', 'sftp host:/tmp/x']) {
      expect(untrustedOf(command), command).toContain(SFTP_REASON);
    }
  });

  it('refuses an outside copy, a policy copy, and an upload of a denied file', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { rules: [{ kind: 'read', action: 'deny', pattern: '**/.env' }] } });
    const outside = path.join(h.root, 'scp.txt');
    try {
      await h.write('.env', 'SECRET_TOKEN=denied\n');
      await h.write('a.txt', 'plain a\n');
      const policy = h.file('.pi/pi-tools.json');
      const before = await readFile(policy, 'utf8');

      const escaped = await h.call('bash', { command: `scp -q a.txt ${outside}` });
      const overwritten = await h.call('bash', { command: 'scp -q a.txt .pi/pi-tools.json' });
      const uploaded = await h.call('bash', { command: `scp -q .env ${outside}` });

      expect(escaped.isError).toBe(true);
      expect(textOf(escaped)).toContain(SCP_REASON);
      expect(existsSync(outside)).toBe(false);
      expect(overwritten.isError).toBe(true);
      expect(textOf(overwritten)).toContain(SCP_REASON);
      expect(await readFile(policy, 'utf8')).toBe(before);
      expect(uploaded.isError).toBe(true);
      expect(textOf(uploaded)).not.toContain('SECRET_TOKEN');
    } finally {
      await h.cleanup();
    }
  });
});

describe('finding 9: ssh-keygen and sqlite3 write the path the argv names', () => {
  it('records the -f key file and the first sqlite3 operand as writes, and keeps the read modes', () => {
    expect(pathsOf("ssh-keygen -q -t ed25519 -N '' -f key")).toContainEqual({ path: 'key', write: true });
    expect(pathsOf('ssh-keygen -f /outside/key')).toContainEqual({ path: '/outside/key', write: true });
    expect(pathsOf('ssh-keygen -fkey')).toContainEqual({ path: 'key', write: true });
    expect(pathsOf('ssh-keygen --filename=/outside/key')).toContainEqual({ path: '/outside/key', write: true });
    expect(pathsOf('ssh-keygen -p -f key')).toContainEqual({ path: 'key', write: true });
    expect(pathsOf('ssh-keygen -R host -f known_hosts')).toContainEqual({ path: 'known_hosts', write: true });
    expect(pathsOf('ssh-keygen -lf key.pub')).toContainEqual({ path: 'key.pub', write: false });
    expect(pathsOf('ssh-keygen -y -f key')).toContainEqual({ path: 'key', write: false });

    expect(pathsOf("sqlite3 app.db 'create table t(x);'")).toEqual([{ path: 'app.db', write: true }]);
    expect(pathsOf("sqlite3 :memory: 'create table t(x);'")).toEqual([]);
    expect(pathsOf("sqlite3 -readonly app.db 'select 1;'")).toEqual([{ path: 'app.db', write: false }]);
    expect(pathsOf("sqlite3 -init setup.sql app.db 'select 1;'")).toEqual([{ path: 'app.db', write: true }]);
    expect(pathsOf("sqlite3 -cmd '.print hi' app.db 'select 1;'")).toEqual([{ path: 'app.db', write: true }]);
  });

  it('refuses the outside key and database, and keeps both working inside the workspace', async () => {
    const h = await createHarness({ hasUI: false, confirm: false, config: { mode: 'auto', rules: [] } });
    const outsideKey = path.join(h.root, 'key');
    const outsideDb = path.join(h.root, 'db.sqlite');
    try {
      const escapedKey = await h.call('bash', { command: `ssh-keygen -q -t ed25519 -N '' -f ${outsideKey}` });
      const escapedDb = await h.call('bash', { command: `sqlite3 ${outsideDb} 'create table t(x);'` });
      const key = await h.call('bash', { command: "ssh-keygen -q -t ed25519 -N '' -f key" });
      const fingerprint = await h.call('bash', { command: 'ssh-keygen -lf key.pub' });
      const db = await h.call('bash', { command: "sqlite3 app.db 'create table t(x);'" });

      expect(escapedKey.isError).toBe(true);
      expect(textOf(escapedKey)).toContain(OUTSIDE_REASON);
      expect(existsSync(outsideKey)).toBe(false);
      expect(escapedDb.isError).toBe(true);
      expect(textOf(escapedDb)).toContain(OUTSIDE_REASON);
      expect(existsSync(outsideDb)).toBe(false);
      expect(key.isError).toBeUndefined();
      expect(existsSync(h.file('key'))).toBe(true);
      expect(existsSync(h.file('key.pub'))).toBe(true);
      expect(fingerprint.isError).toBeUndefined();
      expect(textOf(fingerprint)).toContain('ED25519');
      expect(db.isError).toBeUndefined();
      expect(existsSync(h.file('app.db'))).toBe(true);
    } finally {
      await h.cleanup();
    }
  });
});
