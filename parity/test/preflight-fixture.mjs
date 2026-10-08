import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { onTestFinished } from 'vitest';

const content = '# Reference fixture\n';
const sha256 = createHash('sha256').update(content).digest('hex');
const sourcePath = 'pstack/skills/example/SKILL.md';

export function documents() {
  return {
    'source-lock.json': {
      schemaVersion: 1,
      status: 'locked',
      cursorPlugins: { revision: 'a'.repeat(40), completeDependencyClosure: true },
      cursorCli: { version: 'reference-test', referenceConfigurationCaptured: true },
      pi: { version: 'candidate-test', tarballIntegrityVerified: true },
    },
    'dependencies.json': {
      schemaVersion: 1,
      closureAudited: true,
      nodes: [{ id: 'pstack', readingComplete: true }],
      edges: [],
      unresolvedReferences: [],
    },
    'requirements.json': {
      schemaVersion: 1,
      acceptanceDefinitionOwner: 'independent-owner',
      acceptanceDefinitionsFrozen: true,
      coverageDenominatorComplete: true,
      requirements: [{ id: 'R1', source: { file: sourcePath, sha256 }, configurationIds: ['default'], scenarioIds: ['example'], status: 'unverified' }],
    },
    'configurations.json': {
      schemaVersion: 1,
      configurations: [{ id: 'default', platform: 'darwin-arm64' }],
      accountOwnerPrerequisites: [],
    },
    'inventory.json': {
      schemaVersion: 1,
      items: [{ path: sourcePath, sha256, disposition: { status: 'mapped', requirementIds: ['R1'] } }],
    },
    'mismatches.json': { schemaVersion: 1, items: [] },
  };
}

export async function fixture(records = documents()) {
  const root = await mkdtemp(join(tmpdir(), 'pstack-preflight-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const files = {
    ...Object.fromEntries(Object.entries(records).map(([path, value]) => [path, JSON.stringify(value)])),
    [`reference/cursor-plugins/${sourcePath}`]: content,
    'scenarios/example.json': JSON.stringify({
      schemaVersion: 1,
      id: 'example',
      requirements: ['R1'],
      actions: [{ kind: 'type', literal: '/example' }],
      fixture: { digest: sha256 },
      comparison: { oracleFrozen: true },
      execution: { pairId: 'synthetic-pair-not-acceptance' },
    }),
  };
  await Promise.all(
    Object.entries(files).map(async ([path, value]) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), value);
    }),
  );
  return root;
}

export async function snapshot(root, prefix = '') {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry) => {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? snapshot(root, path) : [[path, await readFile(join(root, path), 'utf8')]];
    }),
  );
  return groups.flat().toSorted(([left], [right]) => left.localeCompare(right));
}
