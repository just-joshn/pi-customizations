import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { cleanDirectories, makeDirectory } from './orch-fixtures.ts';

const scripts = new URL('../../skills/poteto-mode/scripts/', import.meta.url).pathname.replace(/\/$/, '');

afterEach(cleanDirectories);

test('orch and bootstrap type-check under tsc --noEmit --strict with the helper compiler options', async () => {
  const config = join(await makeDirectory(), 'tsconfig.json');
  await Bun.write(
    config,
    JSON.stringify({
      compilerOptions: { allowImportingTsExtensions: true, module: 'esnext', moduleResolution: 'bundler', noEmit: true, skipLibCheck: true, strict: true, target: 'esnext', types: ['bun-types'], typeRoots: [join(scripts, 'node_modules')] },
      files: ['orch/orch.ts', 'orch/store.ts', 'bootstrap.ts'].map((file) => join(scripts, file)),
    }),
  );
  const result = spawnSync(join(scripts, 'node_modules/.bin/tsc'), ['--project', config, '--noEmit', '--strict'], { encoding: 'utf8' });
  expect({ status: result.status, output: result.stdout + result.stderr }).toEqual({ status: 0, output: '' });
}, 120_000);
