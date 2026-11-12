import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, onTestFinished, test } from 'vitest';
import { linuxReadonlyCommand } from '../../src/linux-readonly-sandbox.ts';
import { seccompFilter } from '../../src/seccomp-filter.ts';

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

const hasPython = linux && spawnSync('python3', ['--version']).status === 0;
const LEAKED_FD = 11;

const HOST = `
import json, os, socket, subprocess, sys
path, command = sys.argv[1:]
service = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
service.bind(path)
service.settimeout(0.5)
leaked = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
os.dup2(leaked.fileno(), ${LEAKED_FD}, inheritable=True)
result = subprocess.run(['/bin/bash', '-c', command], pass_fds=[${LEAKED_FD}], capture_output=True, text=True)
received = []
try:
    while True:
        received.append(service.recv(100).decode())
except socket.timeout:
    pass
print(json.dumps({'sandboxed': json.loads(result.stdout), 'received': received}))
`;

const probe = (path: string) => `
import json, socket
out = {}
for name, send in {
    'pair': lambda: socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)[0].sendto(b'PAIR', ${JSON.stringify(path)}),
    'leaked': lambda: socket.socket(fileno=${LEAKED_FD}).sendto(b'LEAK', ${JSON.stringify(path)}),
}.items():
    try:
        send()
        out[name] = 'sent'
    except OSError as error:
        out[name] = error.strerror
print(json.dumps(out))
`;

test.skipIf(!hasPython)('a datagram socketpair and an inherited descriptor cannot send to a host Unix socket', async ({ signal }) => {
  const dir = tempDir();
  const path = join(dir, 'host.sock');
  const command = linuxReadonlyCommand(`python3 -c '${probe(path).replaceAll("'", "'\\''")}'`, dir);
  const { stdout } = await run('python3', ['-c', HOST, path, command], { cwd: dir, encoding: 'utf8', signal });
  expect(JSON.parse(stdout)).toEqual({ sandboxed: { pair: 'Operation not permitted', leaked: 'Bad file descriptor' }, received: [] });
});
