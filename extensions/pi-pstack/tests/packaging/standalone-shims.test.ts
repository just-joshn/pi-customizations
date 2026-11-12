import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { findEnvKeys } from '../../scripts/pi-standalone-shims.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const envKeysFile = 'node_modules/@earendil-works/pi-ai/dist/env-api-keys.js';

function providerEnvPairs(source: string): Map<string, string> {
  const table = /(?:envMap|API_KEY_ENV)\s*=\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
  const pairs = [...table.matchAll(/['"]?([\w-]+)['"]?\s*:\s*['"](\w+)['"]/g)].map((m) => [m[1]!, m[2]!] as const);
  return new Map(pairs);
}

const piAi = new Map<string, string>([['the pi-ai the tests resolve', join(root, envKeysFile)]]);
const releases = join(process.env['PI_CODING_AGENT_DIR'] ?? join(homedir(), '.pi', 'agent'), 'install', 'releases');
const hosts = existsSync(releases)
  ? readdirSync(releases).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((v) => [`installed Pi ${v}`, join(releases, v, envKeysFile)] as const).filter(([, file]) => existsSync(file))
  : [];
for (const [label, file] of hosts) piAi.set(label, file);
const newestHost = hosts.at(-1)?.[0];

describe('standalone bundles reproduce pi-ai findEnvKeys', () => {
  test.each([...piAi])('every provider credential variable in %s is found by the shim', (_label, file) => {
    const pairs = providerEnvPairs(readFileSync(file, 'utf8'));
    expect(pairs.size).toBeGreaterThan(30);
    for (const [provider, variable] of pairs) {
      expect(findEnvKeys(provider, { [variable]: 'set' }), provider).toEqual([variable]);
    }
  });

  test.skipIf(newestHost === undefined)('the shim knows no provider the newest installed Pi lacks', () => {
    const host = providerEnvPairs(readFileSync(piAi.get(newestHost!)!, 'utf8'));
    const shim = providerEnvPairs(readFileSync(join(root, 'scripts/pi-standalone-shims.mjs'), 'utf8'));
    expect(Object.fromEntries(shim)).toEqual(Object.fromEntries(host));
  });
});

test('the helper receipt records the pi-ai catalog the standalone bundles inline', () => {
  const receipt = JSON.parse(readFileSync(join(root, 'dist/helpers.json'), 'utf8')) as { standaloneCatalog?: { package: string; version: string; bundles: string[] } };
  const installed = JSON.parse(readFileSync(join(root, 'node_modules/@earendil-works/pi-ai/package.json'), 'utf8')) as { version: string };
  expect(receipt.standaloneCatalog).toEqual({
    package: '@earendil-works/pi-ai',
    version: installed.version,
    bundles: ['dist/routine-setup.js', 'dist/automation-serve.js'],
  });
  for (const bundle of receipt.standaloneCatalog?.bundles ?? []) expect(readFileSync(join(root, bundle), 'utf8')).toContain('function getBuiltinProviders()');
});
