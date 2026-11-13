import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

export const WORKER_CREDENTIAL_EXTENSION = `import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
export default function(pi) {
  pi.on('session_start', () => {
    if(process.env.PSTACK_CONTAINER!=='1' || process.env.PSTACK_WORKER!=='1') return;
    try {
    const names=${JSON.stringify(FORGE_CREDENTIALS)};
    const initial=Object.fromEntries(readFileSync('/proc/self/environ','utf8').split('\\0').filter(Boolean).map(entry=>{const i=entry.indexOf('=');return [entry.slice(0,i),entry.slice(i+1)];}));
    const fixturePresent=names.filter(name=>name==='GH_TOKEN' && initial[name]===${JSON.stringify(FORGE_TOKEN)});
    const present=names.filter(name=>Object.hasOwn(initial,name) && !fixturePresent.includes(name));
    const effectivePresent=names.filter(name=>Object.hasOwn(process.env,name));
    const result={status:present.length===0 && effectivePresent.length===0?'pass':'fail',present,fixturePresent,effectivePresent,pid:process.pid,stage:'session_start'};
    const file=join(process.env.PSTACK_RUN_ROOT,'workers',process.env.PSTACK_WORKER_ID,'credential-probe.json');
    writeFileSync(file+'.new',JSON.stringify(result));
    renameSync(file+'.new',file);
    } catch {}
  });
}
`;

export interface ContainerCredentialProbe {
  runId: string;
  workerId: string;
  container: string;
  status: 'pass' | 'fail' | 'unavailable';
  present: string[];
  fixturePresent?: string[];
  effectivePresent?: string[];
  pid?: number;
  stage?: 'session_start';
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

export function recordContainerCredentials(repo: string, sandbox: string): ContainerCredentialProbe[] {
  const root = join(repo, '.pi/pstack/runs');
  const probes: ContainerCredentialProbe[] = [];
  for (const runId of existsSync(root) ? readdirSync(root) : []) {
    const events = join(root, runId, 'events.jsonl');
    if (!existsSync(events)) continue;
    for (const line of readFileSync(events, 'utf8').split('\n').filter(Boolean)) {
      const event = JSON.parse(line) as { kind: string; workerId: string; data?: { container?: { name: string } } };
      const container = event.kind === 'spawn' ? event.data?.container?.name : undefined;
      if (container === undefined) continue;
      const captured = join(root, runId, 'workers', event.workerId, 'out', 'credential-probe.json');
      let result: Pick<ContainerCredentialProbe, 'status' | 'present' | 'fixturePresent' | 'effectivePresent' | 'pid' | 'stage'> = { status: 'unavailable', present: [] };
      if (existsSync(captured)) {
        try {
          const parsed = JSON.parse(readFileSync(captured, 'utf8')) as ContainerCredentialProbe;
          const validNames = (names: unknown): names is string[] => Array.isArray(names) && names.every((name) => FORGE_CREDENTIALS.includes(name));
          if (
            parsed.stage === 'session_start' &&
            typeof parsed.pid === 'number' &&
            Number.isInteger(parsed.pid) &&
            validNames(parsed.present) &&
            validNames(parsed.fixturePresent) &&
            validNames(parsed.effectivePresent) &&
            parsed.fixturePresent.every((name) => name === 'GH_TOKEN')
          ) {
            result = {
              status: parsed.present.length === 0 && parsed.effectivePresent.length === 0 ? 'pass' : 'fail',
              present: parsed.present,
              fixturePresent: parsed.fixturePresent,
              effectivePresent: parsed.effectivePresent,
              pid: parsed.pid,
              stage: parsed.stage,
            };
          }
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
