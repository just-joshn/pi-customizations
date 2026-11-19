import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { z } from 'zod';

const root = fileURLToPath(new URL('..', import.meta.url));
const workspaceKey = 'extensions/pi-pstack-v2';
const DENY_COMMAND = /npm install-scripts deny ([^\n`]+)/;

const depMap = z.record(z.string(), z.string()).optional();
const deps = z.object({ dependencies: depMap, optionalDependencies: depMap });
const meta = deps.extend({ hasInstallScript: z.boolean().optional() });
const bunLock = z.object({
  workspaces: z.record(z.string(), deps),
  // Registry entries are [spec, registry, meta, integrity]. Workspace entries are [spec].
  packages: z.record(z.string(), z.tuple([z.string()]).rest(z.unknown())),
});

// bun.lock is JSON with trailing commas.
function readLock(): z.infer<typeof bunLock> {
  const text = readFileSync(join(root, '..', '..', 'bun.lock'), 'utf8');
  return bunLock.parse(JSON.parse(text.replace(/,(\s*[}\]])/g, '$1')));
}

const childNames = (entry: z.infer<typeof deps>): string[] => [...Object.keys(entry.dependencies ?? {}), ...Object.keys(entry.optionalDependencies ?? {})];

// Bun keys a nested install as `parent/child` and a hoisted one as `child`.
function resolveKey(packages: Record<string, unknown>, parentKey: string, name: string): string {
  const nested = parentKey ? `${parentKey}/${name}` : name;
  return nested in packages ? nested : name;
}

/** Names of packages with install scripts that installing pi-pstack-v2 pulls in, peers and dev tools excluded. */
function installScriptPackages(): string[] {
  const { workspaces, packages } = readLock();
  const seen = new Set<string>();
  const pending = childNames(workspaces[workspaceKey] ?? {}).map((name) => resolveKey(packages, '', name));
  const found = new Set<string>();
  for (let key = pending.pop(); key !== undefined; key = pending.pop()) {
    const entry = packages[key];
    if (seen.has(key) || !entry) continue;
    seen.add(key);
    const [spec, , rawInfo] = entry;
    const info = meta.parse(rawInfo ?? {});
    if (info.hasInstallScript) found.add(spec.slice(0, spec.lastIndexOf('@')));
    pending.push(...childNames(info).map((name) => resolveKey(packages, key, name)));
  }
  return [...found].sort();
}

test('the README deny command covers every dependency install script npm warns about', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const denied = readme.match(DENY_COMMAND)?.[1]?.trim().split(/\s+/).sort();
  expect(denied).toEqual(installScriptPackages());
});

test('the lockfile walk finds the packages npm 11.20 listed when installing 0.2.0', () => {
  expect(installScriptPackages()).toEqual(['cpu-features', 'ssh2']);
});
