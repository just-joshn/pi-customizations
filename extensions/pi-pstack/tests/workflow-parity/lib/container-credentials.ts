import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

export const FORGE_TOKEN = 'ghp_workflowparityforgetoken0123456789';
const FORGE_CREDENTIALS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'PSTACK_CONTAINER_FORGE_TOKEN', 'SSH_AUTH_SOCK'];
export const CREDENTIAL_PROBE = `const names=${JSON.stringify(FORGE_CREDENTIALS)}.filter(name=>Object.hasOwn(process.env,name)); console.log(JSON.stringify({present:names})); process.exitCode=names.length===0?0:1;`;
const PROCESS_PROBE = `const fs=require('node:fs');
const workers=fs.readdirSync('/proc').filter(pid=>/^\\d+$/.test(pid)).flatMap(pid=>{
  try {
    const entries=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\\0');
    if(!entries.includes('PSTACK_WORKER=1')) return [];
    const cmd=fs.readlinkSync('/proc/'+pid+'/exe');
    if(!/(^|\\/)node$/.test(cmd)) return [];
    return [{pid:Number(pid),present:${JSON.stringify(FORGE_CREDENTIALS)}.filter(name=>entries.some(entry=>entry.startsWith(name+'=')))}];
  } catch { return []; }
});
if(workers.length!==1) process.exit(2);
console.log(JSON.stringify(workers[0])); process.exitCode=workers[0].present.length===0?0:1;`;

function workerCredentialExtension(endpoint: string): string {
  return `import { readFileSync } from 'node:fs';
export default function(pi) {
  pi.on('session_start', async () => {
    if(process.env.PSTACK_CONTAINER!=='1' || process.env.PSTACK_WORKER!=='1' || !process.env.PSTACK_RUN_ID || !process.env.PSTACK_WORKER_ID) return;
    try {
    const names=${JSON.stringify(FORGE_CREDENTIALS)};
    const initial=Object.fromEntries(readFileSync('/proc/self/environ','utf8').split('\\0').filter(Boolean).map(entry=>{const i=entry.indexOf('=');return [entry.slice(0,i),entry.slice(i+1)];}));
    const fixtureMatches=names.filter(name=>initial[name]===${JSON.stringify(FORGE_TOKEN)});
    const fixturePresent=fixtureMatches.filter(name=>name==='GH_TOKEN');
    const present=names.filter(name=>Object.hasOwn(initial,name) && !fixturePresent.includes(name));
    const effectivePresent=names.filter(name=>Object.hasOwn(process.env,name));
    const result={status:present.length===0 && effectivePresent.length===0?'pass':'fail',present,fixturePresent,fixtureMatches,effectivePresent,pid:process.pid,stage:'session_start'};
    await fetch(${JSON.stringify(endpoint)}+'/'+encodeURIComponent(process.env.PSTACK_RUN_ID)+'/'+encodeURIComponent(process.env.PSTACK_WORKER_ID),{method:'POST',body:JSON.stringify(result),signal:AbortSignal.timeout(1000)});
    } catch {}
  });
}
`;
}

export interface ContainerCredentialProbe {
  runId: string;
  workerId: string;
  container: string;
  status: 'pass' | 'fail' | 'unavailable';
  present: string[];
  fixturePresent?: string[];
  fixtureMatches?: string[];
  effectivePresent?: string[];
  pid?: number;
  stage?: 'session_start';
}

type Capture = Pick<ContainerCredentialProbe, 'status' | 'present' | 'fixturePresent' | 'fixtureMatches' | 'effectivePresent' | 'pid' | 'stage'>;

function parseCapture(value: unknown): Capture | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const parsed = value as ContainerCredentialProbe;
  const validNames = (names: unknown): names is string[] => Array.isArray(names) && names.every((name) => FORGE_CREDENTIALS.includes(name));
  if (
    parsed.stage !== 'session_start' ||
    typeof parsed.pid !== 'number' ||
    !Number.isInteger(parsed.pid) ||
    !validNames(parsed.present) ||
    !validNames(parsed.fixturePresent) ||
    !validNames(parsed.effectivePresent) ||
    !parsed.fixturePresent.every((name) => name === 'GH_TOKEN') ||
    (parsed.fixtureMatches !== undefined && (!validNames(parsed.fixtureMatches) || !parsed.fixtureMatches.every((name) => parsed.present.includes(name) || parsed.fixturePresent?.includes(name))))
  )
    return undefined;
  return {
    status: parsed.present.length === 0 && parsed.effectivePresent.length === 0 ? 'pass' : 'fail',
    present: parsed.present,
    fixturePresent: parsed.fixturePresent,
    ...(parsed.fixtureMatches === undefined ? {} : { fixtureMatches: parsed.fixtureMatches }),
    effectivePresent: parsed.effectivePresent,
    pid: parsed.pid,
    stage: parsed.stage,
  };
}

const capturePath = (dir: string, runId: string, workerId: string) =>
  join(
    dir,
    `${createHash('sha256')
      .update(JSON.stringify([runId, workerId]))
      .digest('hex')}.json`,
  );

export interface CredentialCapture {
  packageDir: string;
  captureDir: string;
  close(): Promise<void>;
}

/** Only the extension package is mounted. Captures stay in its unmounted sibling until the driver collects them. */
export async function startCredentialCapture(): Promise<CredentialCapture | undefined> {
  const root = mkdtempSync(join(tmpdir(), 'pstack-measurement-'));
  const packageDir = join(root, 'extension');
  const captureDir = join(root, 'captures');
  mkdirSync(packageDir);
  mkdirSync(captureDir);
  const prefix = `/${randomUUID()}/`;
  const server = createServer((request, response) => {
    const ids = request.url?.startsWith(prefix) ? request.url.slice(prefix.length).split('/') : [];
    if (request.method !== 'POST' || ids.length !== 2 || ids.some((id) => !/^[a-zA-Z0-9-]{1,80}$/.test(id))) {
      response.writeHead(404).end();
      return;
    }
    let body = '';
    request.on('error', () => undefined);
    request.on('data', (chunk) => {
      body += String(chunk);
      if (body.length > 16_384) request.destroy();
    });
    request.on('end', () => {
      try {
        const captured = parseCapture(JSON.parse(body));
        if (captured === undefined) return void response.writeHead(400).end();
        writeFileSync(capturePath(captureDir, ids[0] as string, ids[1] as string), JSON.stringify(captured), { mode: 0o600, flag: 'wx' });
        response.writeHead(204).end();
      } catch {
        response.writeHead(400).end();
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No credential receiver port');
    const host =
      Object.values(networkInterfaces())
        .flat()
        .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address ?? '127.0.0.1';
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'workflow-parity-credential-probe', pi: { extensions: ['./index.mjs'] } }));
    writeFileSync(join(packageDir, 'index.mjs'), workerCredentialExtension(`http://${host}:${address.port}${prefix.slice(0, -1)}`));
    return {
      packageDir,
      captureDir,
      close: async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch {
    server.close();
    rmSync(root, { recursive: true, force: true });
    return undefined;
  }
}

export function probeContainerCredentials(docker: string, env: NodeJS.ProcessEnv, container: string): Pick<ContainerCredentialProbe, 'status' | 'present' | 'pid'> {
  const result = spawnSync(docker, ['exec', container, 'node', '-e', PROCESS_PROBE], { env, encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0 && result.status !== 1) return { status: 'unavailable', present: [] };
  try {
    const parsed = JSON.parse(result.stdout) as { present: string[]; pid: number };
    if (!Array.isArray(parsed.present) || parsed.present.some((name) => !FORGE_CREDENTIALS.includes(name)) || !Number.isInteger(parsed.pid)) return { status: 'unavailable', present: [] };
    return { status: result.status === 0 && parsed.present.length === 0 ? 'pass' : 'fail', present: parsed.present, pid: parsed.pid };
  } catch {
    return { status: 'unavailable', present: [] };
  }
}

export function recordContainerCredentials(repo: string, sandbox: string, captureDir?: string): ContainerCredentialProbe[] {
  const root = join(repo, '.pi/pstack/runs');
  const probes: ContainerCredentialProbe[] = [];
  for (const runId of existsSync(root) ? readdirSync(root) : []) {
    const events = join(root, runId, 'events.jsonl');
    if (!existsSync(events)) continue;
    for (const line of readFileSync(events, 'utf8').split('\n').filter(Boolean)) {
      const event = JSON.parse(line) as { kind: string; workerId: string; data?: { container?: { name: string } } };
      const container = event.kind === 'spawn' ? event.data?.container?.name : undefined;
      if (container === undefined) continue;
      const captured = captureDir === undefined ? undefined : capturePath(captureDir, runId, event.workerId);
      let result: Capture = { status: 'unavailable', present: [] };
      if (captured !== undefined && existsSync(captured)) {
        try {
          result = parseCapture(JSON.parse(readFileSync(captured, 'utf8'))) ?? result;
        } catch {
          // An absent or incomplete capture cannot establish isolation.
        }
      }
      probes.push({ runId, workerId: event.workerId, container, ...result });
    }
  }
  writeFileSync(join(sandbox, 'container-credential-probes.json'), JSON.stringify(probes, null, 2));
  return probes;
}
