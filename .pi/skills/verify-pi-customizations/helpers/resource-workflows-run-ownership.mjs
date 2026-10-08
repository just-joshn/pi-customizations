import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { createConnection } from 'node:net';

const identityProgram = `import ctypes,json,sys
class Info(ctypes.Structure):
    _fields_=[(n,ctypes.c_uint32) for n in ['flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','rfu']]+[('comm',ctypes.c_char*16),('name',ctypes.c_char*32)]+[(n,ctypes.c_uint32) for n in ['nfiles','pgid','pjobc','tdev','tpgid','nice']]+[('sec',ctypes.c_uint64),('usec',ctypes.c_uint64)]
info=Info()
lib=ctypes.CDLL('/usr/lib/libproc.dylib')
size=lib.proc_pidinfo(int(sys.argv[1]),3,0,ctypes.byref(info),ctypes.sizeof(info))
print(json.dumps({'pid':info.pid,'parent':info.ppid,'group':info.pgid,'birth':str(info.sec)+':'+str(info.usec)} if size==ctypes.sizeof(info) else None))
`;

export function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || process.platform !== 'darwin') return null;
  try {
    return JSON.parse(execFileSync('python3', ['-c', identityProgram, String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    return null;
  }
}

function descendants(pid) {
  try {
    return execFileSync('/usr/bin/pgrep', ['-P', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .trim()
      .split('\n')
      .map(Number)
      .filter((id) => id > 1);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

function listenerAt(pid, port) {
  if (!port) return false;
  try {
    return execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), `-iTCP:${port}`, '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .split('\n')
      .some((line) => line.startsWith('n'));
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function connectionAbsent(address) {
  return new Promise((resolve) => {
    const socket = createConnection(address);
    const finish = (absent) => {
      socket.destroy();
      resolve(absent);
    };
    socket.once('connect', () => finish(false));
    socket.once('error', (error) => finish(['ECONNREFUSED', 'ENOENT'].includes(error.code)));
    socket.setTimeout(1000, () => finish(false));
  });
}

export const listenerAbsent = (port) => (port ? connectionAbsent({ host: '127.0.0.1', port }) : Promise.resolve(true));
const socketAbsent = (socket) => (socket ? connectionAbsent({ path: socket }) : Promise.resolve(true));

function socketIdentity(socket) {
  if (!socket || !existsSync(socket) || !lstatSync(socket).isSocket()) return null;
  try {
    const pid = Number(execFileSync('tmux', ['-S', socket, 'display-message', '-p', '#{pid}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
    const identity = processIdentity(pid);
    return identity ? { ...identity, socketLease: socket } : null;
  } catch {
    return null;
  }
}

const same = (left, right) => Boolean(left && right && left.pid === right.pid && left.birth === right.birth);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function identityAlive(identity) {
  const current = processIdentity(identity.pid);
  if (current) return same(identity, current);
  try {
    process.kill(identity.pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

async function stopIdentity(identity) {
  if (!same(identity, processIdentity(identity.pid))) return { ...identity, signalled: false, exited: !identityAlive(identity) };
  try {
    process.kill(identity.pid, 'SIGTERM');
  } catch (error) {
    return { ...identity, signalled: false, exited: !identityAlive(identity), error: error.message };
  }
  const deadline = Date.now() + 5000;
  while (identityAlive(identity) && Date.now() < deadline) await delay(20);
  if (same(identity, processIdentity(identity.pid))) {
    try {
      process.kill(identity.pid, 'SIGKILL');
    } catch (error) {
      return { ...identity, signalled: true, exited: !identityAlive(identity), error: error.message };
    }
    const finalDeadline = Date.now() + 5000;
    while (identityAlive(identity) && Date.now() < finalDeadline) await delay(20);
  }
  return { ...identity, signalled: true, exited: !identityAlive(identity) };
}

function captureDescendants(captured) {
  let result = [...captured];
  const visit = (identity) => {
    if (!same(identity, processIdentity(identity.pid))) return;
    for (const childPid of descendants(identity.pid)) {
      const child = processIdentity(childPid);
      if (!child || child.parent !== identity.pid || !same(identity, processIdentity(identity.pid)) || result.some((item) => same(item, child))) continue;
      result = [...result, child];
      visit(child);
    }
  };
  for (const identity of captured) visit(identity);
  return result;
}

export function openRunOwnership({ pid, port = null, socket = null, includeRoot = false }) {
  const root = processIdentity(pid);
  let captured = root ? [root] : [];
  let errors = root ? [] : ['Root process identity unavailable.'];
  function capture() {
    try {
      const terminal = socketIdentity(socket);
      if (terminal && !captured.some((item) => same(item, terminal))) captured = [...captured, terminal];
      captured = captureDescendants(captured);
    } catch (error) {
      errors = [...errors, error.message];
    }
  }
  capture();
  const timer = setInterval(capture, 100);
  const resources = () => captured.filter((item) => includeRoot || !same(item, root));
  async function snapshot() {
    capture();
    const absent = await listenerAbsent(port);
    return {
      beforeRescue: true,
      complete: false,
      gaps: ['Polling captured ancestry cannot prove absence of short-lived or daemonized descendants.', ...errors],
      socket,
      listenerAbsent: absent,
      socketAbsent: await socketAbsent(socket),
      resources: resources().map((identity) => ({ ...identity, alive: identityAlive(identity), listenerAbsent: absent && !listenerAt(identity.pid, port) })),
    };
  }
  async function rescue() {
    clearInterval(timer);
    capture();
    let results = [];
    for (const identity of resources().toReversed()) results = [...results, await stopIdentity(identity)];
    const absent = await listenerAbsent(port);
    return { performed: results.some((result) => result.signalled), confirmed: results.every((result) => result.exited) && absent && (await socketAbsent(socket)), listenerAbsent: absent, resources: results, captureComplete: false };
  }
  return {
    capture,
    snapshot,
    rescue,
    close: () => clearInterval(timer),
    get captured() {
      return [...captured];
    },
  };
}
