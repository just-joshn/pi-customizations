import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, test } from 'vitest';
import { CONTAINER_PI_ROOT, containerPreamble, DEFAULT_IMAGE, resolvePiInstall } from '../../src/container.ts';
import { CREDENTIAL_PROBE, FORGE_TOKEN, probeContainerCredentials, recordContainerCredentials, WORKER_CREDENTIAL_EXTENSION } from './lib/container-credentials.ts';
import { engineAvailable } from './lib/container-lock.ts';
import { PI } from './lib/driver.ts';

function piInstall() {
  const agent = dirname(dirname(PI));
  const version = readFileSync(join(agent, 'install/current-version'), 'utf8').trim();
  return resolvePiInstall(process.env['PSTACK_E2E_PI_ENTRY'] ?? join(agent, 'install/releases', version, 'node_modules/.bin/pi'));
}
const PI_FLAGS = ['--mode', 'rpc', '--offline', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--no-mcp'];

test.skipIf(!engineAvailable())('a host probe fails when the live Pi process receives a credential on stdin', async () => {
  const pi = piInstall();
  const dir = mkdtempSync(join(tmpdir(), 'live-pi-credential-'));
  writeFileSync(join(dir, 'ready.mjs'), `export default pi => pi.on('session_start', () => { console.log('ready'); setTimeout(() => process.exit(0), 1500); });`);
  try {
    for (const contaminated of [false, true]) {
      const name = `pstack-env-probe-${randomUUID()}`;
      const child = spawn(
        'docker',
        [
          'run',
          '--rm',
          '-i',
          '--init',
          '--name',
          name,
          '--mount',
          `type=bind,src=${pi.root},dst=${CONTAINER_PI_ROOT},readonly`,
          '--mount',
          `type=bind,src=${dir},dst=/capture,readonly`,
          DEFAULT_IMAGE,
          'sh',
          '-c',
          `while IFS= read -r line; do [ -n "$line" ] || break; export "\${line%%=*}=$(printf %s "\${line#*=}" | base64 -d)"; done; exec "$@"`,
          'pi-worker',
          'node',
          pi.script,
          ...PI_FLAGS,
          '--extension',
          '/capture/ready.mjs',
        ],
        { stdio: 'pipe' },
      );
      child.stdin.write(containerPreamble({ HOME: '/home/worker', PI_CODING_AGENT_DIR: '/home/worker/.pi/agent', PSTACK_WORKER: '1', ...(contaminated ? { GH_TOKEN: 'synthetic-probe-token' } : {}) }));
      const exited = once(child, 'close');
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.stdin.write(`${JSON.stringify({ type: 'get_state', id: 'ready' })}\n`);
      await Promise.race([
        once(child.stdout, 'data'),
        exited.then(([code]) => {
          throw new Error(`Pi exited before ready (${code}): ${stderr}`);
        }),
      ]);
      const creationEnvironment = spawnSync('docker', ['exec', name, 'node', '-e', CREDENTIAL_PROBE], { encoding: 'utf8' });
      expect(creationEnvironment.status).toBe(0);
      expect(JSON.parse(creationEnvironment.stdout)).toEqual({ present: [] });
      const result = probeContainerCredentials('docker', process.env, name);
      expect(result).toMatchObject({ status: contaminated ? 'fail' : 'pass', present: contaminated ? ['GH_TOKEN'] : [] });
      expect(JSON.stringify(result)).not.toContain('synthetic-probe-token');
      const [code] = await exited;
      expect(code).toBe(0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!engineAvailable())('live worker capture distinguishes startup provenance and effective token removal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-credential-capture-'));
  const pi = piInstall();
  writeFileSync(join(dir, 'probe.mjs'), WORKER_CREDENTIAL_EXTENSION);
  try {
    for (const kind of ['clean', 'fake', 'real', 'fake-source', 'real-source', 'fake-retained', 'unavailable']) {
      rmSync(join(dir, 'credential-probe.json'), { force: true });
      const token = kind === 'real' || kind === 'real-source' ? 'operator-sentinel-must-not-appear' : FORGE_TOKEN;
      writeFileSync(
        join(dir, 'fixture.mjs'),
        `export default function(pi) {
        if(['fake','fake-source'].includes(${JSON.stringify(kind)})) { delete process.env.GH_TOKEN; delete process.env.PSTACK_CONTAINER_FORGE_TOKEN; process.env.PSTACK_FAKE_FORGE_CAPABILITY='1'; }
        pi.on('session_start', () => { setTimeout(() => process.exit(0), 0); });
      }`,
      );
      const result = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '-i',
          '--mount',
          `type=bind,src=${dir},dst=/workers/capture`,
          '--mount',
          `type=bind,src=${pi.root},dst=${CONTAINER_PI_ROOT},readonly`,
          DEFAULT_IMAGE,
          'sh',
          '-c',
          `while IFS= read -r line; do [ -n "$line" ] || break; export "\${line%%=*}=$(printf %s "\${line#*=}" | base64 -d)"; done; exec "$@"`,
          'capture',
          'node',
          pi.script,
          ...PI_FLAGS,
          '--extension',
          '/workers/capture/fixture.mjs',
          '--extension',
          '/workers/capture/probe.mjs',
        ],
        {
          input: containerPreamble({
            HOME: '/home/worker',
            PI_CODING_AGENT_DIR: '/home/worker/.pi/agent',
            PSTACK_CONTAINER: '1',
            PSTACK_WORKER: '1',
            PSTACK_RUN_ROOT: kind === 'unavailable' ? '/missing' : '/',
            PSTACK_WORKER_ID: 'capture',
            ...(kind === 'clean' ? {} : kind.endsWith('-source') ? { PSTACK_CONTAINER_FORGE_TOKEN: token } : { GH_TOKEN: token }),
          }),
          encoding: 'utf8',
        },
      );
      expect(result.status, result.stderr).toBe(0);
      if (kind === 'unavailable') {
        expect(existsSync(join(dir, 'credential-probe.json'))).toBe(false);
        continue;
      }
      expect(existsSync(join(dir, 'credential-probe.json'))).toBe(false);
      const evidence = readFileSync(join(dir, 'credential-probe.json'), 'utf8');
      const captured = JSON.parse(evidence);
      expect(captured).toMatchObject({
        status: kind === 'clean' || kind === 'fake' ? 'pass' : 'fail',
        stage: 'session_start',
        present: kind === 'real' ? ['GH_TOKEN'] : kind.endsWith('-source') ? ['PSTACK_CONTAINER_FORGE_TOKEN'] : [],
        fixtureMatches: kind === 'fake-source' ? ['PSTACK_CONTAINER_FORGE_TOKEN'] : ['fake', 'fake-retained'].includes(kind) ? ['GH_TOKEN'] : [],
        fixturePresent: kind === 'fake' || kind === 'fake-retained' ? ['GH_TOKEN'] : [],
        effectivePresent: kind === 'real-source' ? ['PSTACK_CONTAINER_FORGE_TOKEN'] : kind === 'real' || kind === 'fake-retained' ? ['GH_TOKEN'] : [],
      });
      expect(evidence).not.toContain(token);
      expect(evidence).not.toContain('operator-sentinel-must-not-appear');
      const run = join(dir, 'repo/.pi/pstack/runs/live');
      const out = join(run, 'workers/capture/out');
      mkdirSync(out, { recursive: true });
      copyFileSync(join(dir, 'credential-probe.json'), join(out, 'credential-probe.json'));
      writeFileSync(join(run, 'events.jsonl'), `${JSON.stringify({ kind: 'spawn', workerId: 'capture', data: { container: { name: 'already-removed' } } })}\n`);
      const recorded = recordContainerCredentials(join(dir, 'repo'), dir);
      expect(recorded).toMatchObject([{ ...captured, runId: 'live', workerId: 'capture', container: 'already-removed' }]);
      expect(readFileSync(join(dir, 'container-credential-probes.json'), 'utf8')).not.toContain(token);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const probe = (env: NodeJS.ProcessEnv) => spawnSync(process.execPath, ['-e', CREDENTIAL_PROBE], { env, encoding: 'utf8' });
test('the non-model probe proves absence and records only variable names', () => {
  const clean = probe({ PATH: process.env['PATH'] });
  expect(clean.status).toBe(0);
  expect(JSON.parse(clean.stdout)).toEqual({ present: [] });
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'PSTACK_CONTAINER_FORGE_TOKEN', 'SSH_AUTH_SOCK']) {
    const contaminated = probe({ PATH: process.env['PATH'], [name]: 'secret-must-not-be-in-evidence' });
    expect(contaminated.status).toBe(1);
    expect(JSON.parse(contaminated.stdout)).toEqual({ present: [name] });
    expect(contaminated.stdout).not.toContain('secret-must-not-be-in-evidence');
  }
});
