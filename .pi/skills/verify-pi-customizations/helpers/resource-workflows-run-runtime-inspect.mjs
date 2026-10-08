import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const inspectProgram = `import ctypes,http.client,json,subprocess,sys,time
class Info(ctypes.Structure):
    _fields_=[(n,ctypes.c_uint32) for n in ['flags','status','xstatus','pid','ppid','uid','gid','ruid','rgid','svuid','svgid','rfu']]+[('comm',ctypes.c_char*16),('name',ctypes.c_char*32)]+[(n,ctypes.c_uint32) for n in ['nfiles','pgid','pjobc','tdev','tpgid','nice']]+[('sec',ctypes.c_uint64),('usec',ctypes.c_uint64)]
lib=ctypes.CDLL('/usr/lib/libproc.dylib')
def birth(pid):
    info=Info()
    size=lib.proc_pidinfo(pid,3,0,ctypes.byref(info),ctypes.sizeof(info))
    return {'pid':info.pid,'birth':str(info.sec)+':'+str(info.usec)} if size==ctypes.sizeof(info) else None
def read(argv):
    return subprocess.check_output(argv,stderr=subprocess.DEVNULL,text=True)
def application(pid):
    before=birth(pid)
    if not before: return None
    command=read(['/bin/ps','-ww','-p',str(pid),'-o','command=']).strip()
    cwd=read(['/usr/sbin/lsof','-a','-p',str(pid),'-d','cwd','-Fn'])
    after=birth(pid)
    return dict(after,command=command,cwdRecord=cwd) if before==after else None
mode=sys.argv[1]
try:
    if mode in ['process','listener']:
        app=application(int(sys.argv[2]))
        if app and mode=='listener':
            app['listeners']=read(['/usr/sbin/lsof','-nP','-a','-p',sys.argv[2],'-iTCP:'+sys.argv[3],'-sTCP:LISTEN','-Fn'])
            connection=http.client.HTTPConnection('127.0.0.1',int(sys.argv[3]),timeout=0.5)
            try:
                connection.request('GET','/greet?name=Ada')
                response=connection.getresponse()
                body=response.read(65537)
                if len(body)>65536: raise ValueError('Host HTTP body limit exceeded.')
                app['response']={'status':response.status,'body':body.decode('utf8')}
                app['sampledAt']=time.time()*1000
            finally:
                connection.close()
            if birth(app['pid'])!={k:app[k] for k in ['pid','birth']}: app=None
        result=app
    else:
        socket=sys.argv[2]
        tmux=['tmux','-S',socket]
        fmt='#{pid}\\t#{pane_id}\\t#{pane_pid}\\t#{pane_dead}'
        args=['display-message','-p','-t','f016-run:0.0',fmt]
        before=read(tmux+args).strip()
        server,pane,pid,dead=before.split('\\t')
        if dead!='0' or not pane.startswith('%'): result=None
        elif mode=='baseline':
            text=read(tmux+['capture-pane','-p','-t',pane])
            result={'serverPid':int(server),'paneId':pane,'pid':int(pid),'text':text,'sampledAt':time.time()*1000} if read(tmux+args).strip()==before else None
        else:
            captured=json.loads(sys.argv[3])
            ownedServer=next((p for p in captured if p['pid']==int(server) and p.get('socketLease')==socket),None)
            ownedApp=next((p for p in captured if p['pid']==int(pid)),None)
            firstServer=birth(int(server))
            firstApp=birth(int(pid))
            if not ownedServer or not ownedApp or firstServer!={k:ownedServer[k] for k in ['pid','birth']} or firstApp!={k:ownedApp[k] for k in ['pid','birth']}: result=None
            else:
                app=application(int(pid))
                text=read(tmux+['capture-pane','-p','-t',pane])
                result=dict(app,server=firstServer,paneId=pane,text=text,sampledAt=time.time()*1000) if app and read(tmux+args).strip()==before and birth(int(server))==firstServer and birth(int(pid))==firstApp else None
except subprocess.CalledProcessError:
    result=None
print(json.dumps(result))
`;

export async function runRead(program, args, absent = false, deadline = Infinity) {
  const timeout = Math.min(1000, deadline - Date.now());
  if (timeout <= 0) throw new Error('Runtime total deadline exceeded.');
  try {
    const result = await execute(program, args, { encoding: 'utf8', timeout, maxBuffer: 65536 });
    return result.stdout;
  } catch (error) {
    if (absent && error.code === 1) return '';
    throw error;
  }
}

export function unchanged(identity) {
  const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  return hash(identity.executable) === identity.sha256 && (identity.packageSha256 === null ? missingPackage(identity) : hash(join(identity.packageRoot, 'package.json')) === identity.packageSha256);
}

export function assertSource(identity) {
  if (!unchanged(identity)) throw new Error('Application source or package changed during observation.', { cause: 'source-changed' });
}

function missingPackage(identity) {
  try {
    readFileSync(join(identity.packageRoot, 'package.json'));
    return false;
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
}

export const sameProcess = (left, right) => Boolean(left && right && left.pid === right.pid && left.birth === right.birth);

async function kernelSnapshot(mode, args, deadline) {
  if (process.platform !== 'darwin') return null;
  return JSON.parse(await runRead('python3', ['-c', inspectProgram, mode, ...args], false, deadline));
}

let systemPython;

async function applicationCommand(identity, command, deadline) {
  if (identity.kind === 'server') return command === `${process.execPath} server.mjs`;
  systemPython ??= JSON.parse(
    await runRead('/usr/bin/python3', ['-c', 'import sys,os,json; print(json.dumps([os.path.realpath(sys.executable),os.path.realpath(sys.prefix + "/Resources/Python.app/Contents/MacOS/Python")]))'], false, deadline),
  );
  return ['/usr/bin/python3', realpathSync('/usr/bin/python3'), ...systemPython].some((executable) => command === `${executable} -I terminal.py`);
}

async function application(identity, snapshot, deadline) {
  if (!snapshot || !(await applicationCommand(identity, snapshot.command, deadline)) || !snapshot.cwdRecord.split('\n').includes(`n${identity.cwd}`)) return null;
  assertSource(identity);
  const entry = identity.kind === 'server' ? 'server.mjs' : 'terminal.py';
  return {
    pid: snapshot.pid,
    birth: snapshot.birth,
    command: snapshot.command,
    argv: identity.kind === 'server' ? [process.execPath, entry] : [snapshot.command.slice(0, -' -I terminal.py'.length), '-I', entry],
    cwd: identity.cwd,
    executable: identity.executable,
    sha256: identity.sha256,
  };
}

export async function inspectProcess(identity, candidate, deadline) {
  assertSource(identity);
  if (!Number.isSafeInteger(candidate.pid) || candidate.pid <= 1) return null;
  const snapshot = await kernelSnapshot('process', [String(candidate.pid)], deadline);
  if (!sameProcess(candidate, snapshot)) return null;
  return application(identity, snapshot, deadline);
}

export async function inspectListener(identity, candidate, deadline) {
  assertSource(identity);
  if (!Number.isSafeInteger(candidate.pid) || candidate.pid <= 1) return null;
  const snapshot = await kernelSnapshot('listener', [String(candidate.pid), String(identity.port)], deadline);
  if (!sameProcess(candidate, snapshot) || !snapshot.listeners.split('\n').includes(`n127.0.0.1:${identity.port}`)) return null;
  const app = await application(identity, snapshot, deadline);
  return app ? { ...app, address: '127.0.0.1', port: identity.port, response: snapshot.response, sampledAt: snapshot.sampledAt } : null;
}

export async function readPane(identity, deadline) {
  assertSource(identity);
  const pane = await kernelSnapshot('baseline', [identity.socket], deadline);
  assertSource(identity);
  return pane;
}

export async function inspectPane(identity, captured, deadline) {
  assertSource(identity);
  const snapshot = await kernelSnapshot('pane', [identity.socket, JSON.stringify(captured)], deadline);
  const app = await application(identity, snapshot, deadline);
  return app ? { ...app, socket: identity.socket, server: snapshot.server, paneId: snapshot.paneId, text: snapshot.text, sampledAt: snapshot.sampledAt } : null;
}

export async function requestGreeting(identity, deadline) {
  const output = await runRead('/usr/bin/curl', ['-q', '--silent', '--show-error', '--max-time', '1', '--noproxy', '*', '--write-out', '\n%{http_code}', `http://127.0.0.1:${identity.port}/greet?name=Ada`], false, deadline);
  const boundary = output.lastIndexOf('\n');
  return { status: Number(output.slice(boundary + 1)), body: output.slice(0, boundary) };
}
