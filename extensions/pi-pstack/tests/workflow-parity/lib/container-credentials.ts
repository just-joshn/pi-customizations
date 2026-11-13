import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FORGE_CREDENTIALS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'PSTACK_CONTAINER_FORGE_TOKEN', 'SSH_AUTH_SOCK'];
export const CREDENTIAL_PROBE = `const names=${JSON.stringify(FORGE_CREDENTIALS)}.filter(name=>Object.hasOwn(process.env,name)); console.log(JSON.stringify({present:names})); process.exitCode=names.length===0?0:1;`;

export interface ContainerCredentialProbe {
  runId: string;
  workerId: string;
  container: string;
  status: 'pass' | 'fail' | 'unavailable';
  present: string[];
}

export function probeContainerCredentials(docker: string, env: NodeJS.ProcessEnv, container: string): Pick<ContainerCredentialProbe, 'status' | 'present'> {
  const result = spawnSync(docker, ['exec', container, 'node', '-e', CREDENTIAL_PROBE], { env, encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0 && result.status !== 1) return { status: 'unavailable', present: [] };
  try {
    const parsed = JSON.parse(result.stdout) as { present: string[] };
    if (!Array.isArray(parsed.present) || parsed.present.some((name) => !FORGE_CREDENTIALS.includes(name))) return { status: 'unavailable', present: [] };
    return { status: result.status === 0 && parsed.present.length === 0 ? 'pass' : 'fail', present: parsed.present };
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
      const enginePath = join(root, runId, 'workers', event.workerId, 'claim/engine.json');
      const engine = existsSync(enginePath) ? (JSON.parse(readFileSync(enginePath, 'utf8')) as { docker: string; env: NodeJS.ProcessEnv }) : undefined;
      const result = engine === undefined ? { status: 'unavailable' as const, present: [] } : probeContainerCredentials(engine.docker, engine.env, container);
      probes.push({ runId, workerId: event.workerId, container, ...result });
    }
  }
  writeFileSync(join(sandbox, 'container-credential-probes.json'), JSON.stringify(probes, null, 2));
  return probes;
}
