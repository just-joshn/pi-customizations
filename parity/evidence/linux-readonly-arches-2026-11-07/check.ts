// Usage: node check.ts <path to linux-readonly-sandbox.ts>
// Runs each probe unsandboxed (the baseline) and through linuxReadonlyCommand, and prints PASS or FAIL per probe.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const { linuxReadonlyCommand } = (await import(process.argv[2] as string)) as { linuxReadonlyCommand: (command: string, cwd: string) => string };

const shell = async (command: string, cwd: string): Promise<string> => {
  try {
    const { stdout, stderr } = await run('/bin/sh', ['-c', command], { cwd, encoding: 'utf8', timeout: 300_000 });
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: unknown };
    return `${failed.stdout ?? ''}${failed.stderr ?? ''}`.trim() || `exit ${String(failed.code)}`;
  }
};

const dir = mkdtempSync(join(tmpdir(), 'ro-check-'));
await shell('git init -q && git -c user.email=t@t -c user.name=t commit -qm RO-MARK --allow-empty', dir);

let sandboxCommand: string;
try {
  sandboxCommand = linuxReadonlyCommand('true', dir);
} catch (error) {
  console.log(`SANDBOX-REFUSED: ${(error as Error).message}`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}
console.log(`sandbox command: ${sandboxCommand}`);

let unixConnections = 0;
const unixServer = createServer((client) => {
  unixConnections++;
  client.end();
});
const socketPath = join(dir, 'host.sock');
await new Promise<void>((resolve) => unixServer.listen(socketPath, resolve));
const httpServer = createHttpServer((_request, response) => response.end('HTTP-BODY-OK'));
await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
const { port } = httpServer.address() as AddressInfo;

// glibc on s390x creates every socket through socketcall(SYS_SOCKET), which the filter refuses for every domain.
const socketcallLibc = process.arch === 's390x';
const socketSyscall: Record<string, number> = { x64: 41, arm64: 198, arm: 281, ppc64: 326, s390x: 359 };
const node = JSON.stringify(process.execPath);
const python = `python3 ${JSON.stringify(join(here, 'syscalls.py'))}`;
const probes: { name: string; command: string; sandboxed: RegExp; host?: RegExp; after?: () => string | undefined }[] = [
  { name: 'cat', command: 'cat /etc/debian_version', host: /^\d+\.\d+/, sandboxed: /^\d+\.\d+/ },
  { name: 'ls', command: 'ls /opt', host: /node/, sandboxed: /node/ },
  { name: 'git log', command: 'git log --oneline -1', host: /RO-MARK/, sandboxed: /RO-MARK/ },
  {
    name: 'touch',
    command: 'touch made.txt && echo WROTE || echo WRITE-REFUSED',
    host: /WROTE/,
    sandboxed: /^(?=[\s\S]*WRITE-REFUSED)(?=[\s\S]*Read-only file system)/,
    after: () => (existsSync(join(dir, 'made.txt')) ? 'made.txt exists after the sandboxed run' : undefined),
  },
  {
    name: 'node unix connect',
    command: `${node} -e 'require("node:net").createConnection(process.argv[1]).on("error", (e) => console.log("SOCKET-" + e.code)).on("connect", function () { console.log("SOCKET-CONNECTED"); this.end(); })' ${JSON.stringify(socketPath)}; echo "node exit $?"`,
    host: /SOCKET-CONNECTED/,
    sandboxed: /SOCKET-EPERM/,
  },
  {
    name: 'node stdout on an inherited socket',
    command: `${node} -e 'const fs = require("node:fs"); fs.writeSync(2, "stdout socket=" + fs.fstatSync(1).isSocket() + " stream=" + process.stdout.constructor.name + "\\n")'`,
    host: /stdout socket=true stream=Socket/,
    sandboxed: /stdout socket=true stream=Socket/,
  },
  { name: 'python socket(AF_UNIX)', command: `${python} unix`, host: /socket-unix: ok/, sandboxed: /socket-unix: EPERM/ },
  { name: 'direct socket syscall', command: `${python} direct ${socketSyscall[process.arch]}`, host: /direct-socket-unix: ok\ndirect-socket-inet: ok/, sandboxed: /direct-socket-unix: EPERM\ndirect-socket-inet: ok/ },
  { name: 'io_uring_setup', command: `${python} io_uring`, sandboxed: /io_uring_setup: EPERM/ },
  {
    name: `node fetch loopback${socketcallLibc ? ' (refused: glibc socketcall)' : ''}`, command: `${node} -e 'fetch("http://127.0.0.1:${port}/").then((r) => r.text()).then(console.log, (e) => console.log("FETCH-FAILED", e.cause?.code ?? e))'; echo "node exit $?"`,
    host: /HTTP-BODY-OK/,
    sandboxed: socketcallLibc ? /FETCH-FAILED EPERM/ : /HTTP-BODY-OK/,
  },
  { name: `curl loopback${socketcallLibc ? ' (refused: glibc socketcall)' : ''}`, command: `curl -sS http://127.0.0.1:${port}/`, host: /HTTP-BODY-OK/, sandboxed: socketcallLibc ? /Failed to connect/ : /HTTP-BODY-OK/ },
];
if (['arm', 'ppc64', 's390x'].includes(process.arch)) probes.push({ name: 'socketcall(SYS_SOCKET, AF_UNIX)', command: `${python} socketcall`, sandboxed: /socketcall-socket-unix: EPERM/ });
if (process.arch === 'arm') probes.push({ name: 'OABI syscall(socket, AF_UNIX)', command: `${python} indirect`, sandboxed: /indirect-socket-unix: EPERM/ });

let failures = 0;
for (const probe of probes) {
  const connectionsBefore = unixConnections;
  const sandboxed = await shell(linuxReadonlyCommand(probe.command, dir), dir);
  const problems = [probe.sandboxed.test(sandboxed) ? undefined : `sandboxed output does not match ${probe.sandboxed}`, probe.after?.(), unixConnections === connectionsBefore ? undefined : 'the host Unix socket server accepted a sandboxed connection'];
  const host = await shell(probe.command, dir);
  if (probe.host !== undefined && !probe.host.test(host)) problems.push(`host output does not match ${probe.host}`);
  const failed = problems.filter((problem) => problem !== undefined);
  if (failed.length > 0) failures++;
  console.log(`${failed.length === 0 ? 'PASS' : 'FAIL'} ${probe.name}\n  host:      ${host.replaceAll('\n', ' | ')}\n  sandboxed: ${sandboxed.replaceAll('\n', ' | ')}${failed.map((problem) => `\n  problem:   ${problem}`).join('')}`);
}
unixServer.close();
httpServer.close();
rmSync(dir, { recursive: true, force: true });
console.log(`RESULT: ${failures === 0 ? 'PASS' : 'FAIL'} ${probes.length - failures}/${probes.length} on ${process.arch} ${process.version}`);
process.exit(failures === 0 ? 0 : 1);
