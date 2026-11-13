import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

import { expect, test } from 'vitest';
import { DEFAULT_IMAGE } from '../../src/container.ts';
import { CREDENTIAL_PROBE, probeContainerCredentials } from './lib/container-credentials.ts';
import { engineAvailable } from './lib/container-lock.ts';

test.skipIf(!engineAvailable())('a host probe fails when a live container has a credential variable', async () => {
  for (const contaminated of [false, true]) {
    const name = `pstack-env-probe-${randomUUID()}`;
    const child = spawn('docker', ['run', '--rm', '--name', name, ...(contaminated ? ['--env', 'GH_TOKEN=synthetic-probe-token'] : []), DEFAULT_IMAGE, 'node', '-e', 'console.log("ready"); setTimeout(()=>{}, 1500)'], { stdio: 'pipe' });
    const exited = once(child, 'close');
    await once(child.stdout, 'data');
    const result = probeContainerCredentials('docker', process.env, name);
    expect(result).toEqual({ status: contaminated ? 'fail' : 'pass', present: contaminated ? ['GH_TOKEN'] : [] });
    const [code] = await exited;
    expect(code).toBe(0);
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
