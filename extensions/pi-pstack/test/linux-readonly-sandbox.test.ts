import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, onTestFinished, test } from 'vitest';
import { linuxReadonlyCommand, seccompFilter } from '../src/linux-readonly-sandbox.ts';

const linux = process.platform === 'linux';

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pi-pstack-bwrap-')));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const run = promisify(execFile);

// Asynchronous so the servers this test runs keep answering while the sandboxed command talks to them.
const sandboxed = async (command: string, cwd: string, signal: AbortSignal): Promise<string> => {
  try {
    const { stdout, stderr } = await run('/bin/bash', ['-c', linuxReadonlyCommand(command, cwd)], { cwd, encoding: 'utf8', signal });
    return `${stdout}${stderr}`;
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
  }
};

test('an architecture without a filter is refused instead of running unfiltered', () => {
  expect(() => seccompFilter('ia32')).toThrow('the read-only shell has no seccomp filter for ia32');
});

test.skipIf(!linux)('read-only commands and network reads run, while writes and Unix sockets are refused (G12)', async ({ signal }) => {
  const dir = tempDir();
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'RO-MARK', '--allow-empty'], { cwd: dir });
  const socketPath = join(dir, 'host.sock');
  let reached = false;
  const server = createServer((client) => {
    reached = true;
    client.end();
  });
  await new Promise<void>((resolve) => server.listen({ path: socketPath, signal }, resolve));
  onTestFinished(() => {
    server.close();
  });
  let tcpReached = false;
  const tcp = createServer((client) => {
    tcpReached = true;
    client.end();
  });
  await new Promise<void>((resolve) => tcp.listen({ host: '127.0.0.1', port: 0, signal }, resolve));
  onTestFinished(() => {
    tcp.close();
  });
  const { port } = tcp.address() as AddressInfo;
  const node = JSON.stringify(process.execPath);
  const output = await sandboxed(
    [
      'git log --oneline -1',
      'touch made.txt 2>&1 || echo WRITE-REFUSED',
      `${node} -e 'require("node:net").createConnection(process.argv[1]).on("error", (error) => console.log("SOCKET-" + error.code)).on("connect", () => console.log("SOCKET-CONNECTED"))' ${JSON.stringify(socketPath)}`,
      `${node} -e 'require("node:net").createConnection(${port}, "127.0.0.1").on("error", () => console.log("NET-REFUSED")).on("connect", () => console.log("NET-OPEN"))'`,
    ].join('; '),
    dir,
    signal,
  );
  expect(output).toContain('RO-MARK');
  expect(output).toContain('WRITE-REFUSED');
  expect(output).toContain('SOCKET-EPERM');
  expect(output).toContain('NET-OPEN');
  expect([existsSync(join(dir, 'made.txt')), reached, tcpReached]).toEqual([false, false, true]);
});
