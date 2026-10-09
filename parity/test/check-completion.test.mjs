import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { expect, onTestFinished, test } from 'vitest';

import { runCompletion } from '../scripts/check-completion.mjs';
import { evaluateCompletion } from '../scripts/completion.mjs';

const execute = promisify(execFile);
const cli = resolve('scripts/check-completion.mjs');

function codes(report) {
  return report.blockers.map((item) => item.code);
}

async function writeTree(root, files) {
  await Promise.all(
    Object.entries(files).map(async ([path, value]) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
    }),
  );
}

function sealedDocuments() {
  return {
    'source-lock.json': {
      schemaVersion: 1,
      status: 'locked',
      cursorPlugins: { revision: 'a'.repeat(40), completeDependencyClosure: true },
      cursorCli: { version: 'reference-test', referenceConfigurationCaptured: true, fullDistributionManifestSha256: 'b'.repeat(64) },
      pi: { version: '1.1.0', revision: 'c'.repeat(40), tarballIntegrityVerified: true, registryIntegrity: 'sha512-test' },
      implementationBaseline: { revision: 'd'.repeat(40), packageDigest: 'e'.repeat(64) },
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
      requirements: [
        {
          id: 'R1',
          configurationIds: ['default'],
          scenarioIds: ['example'],
          status: 'verified-pass-paired',
          evidence: [
            {
              type: 'paired-run',
              pair: 'parity/evidence/pairs/example.json',
              attempts: { cursor: 'cursor-attempt', pi: 'pi-attempt' },
            },
          ],
        },
      ],
    },
    'configurations.json': {
      schemaVersion: 1,
      configurations: [{ id: 'default', platform: 'darwin-arm64' }],
      accountOwnerPrerequisites: [],
    },
    'mismatches.json': { schemaVersion: 1, items: [] },
    'scenarios/example.json': {
      schemaVersion: 1,
      fixture: { digest: 'fixture' },
      comparison: { oracleFrozen: true },
      execution: { pairId: 'example-pair' },
      actions: [{ kind: 'type', literal: '/example' }],
    },
    'evidence/pairs/example.json': {
      schemaVersion: 1,
      pairId: 'example-pair',
      sides: { cursor: 'cursor-attempt', pi: 'pi-attempt' },
    },
  };
}

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pstack-completion-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const documents = { ...sealedDocuments(), ...overrides };
  await writeTree(root, documents);
  return root;
}

async function runCli(args) {
  try {
    const result = await execute(process.execPath, [cli, ...args], { cwd: resolve('..') });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

test('missing requirements.json blocks completion and still writes completion.json', async () => {
  const root = await fixture();
  await rm(join(root, 'requirements.json'));
  const result = await runCompletion([root]);
  expect(result.exitCode).toBe(2);
  expect(result.report.verdict).toBe('BLOCKED');
  expect(codes(result.report)).toContain('ARTIFACT_MISSING');
  const written = JSON.parse(await readFile(join(root, 'completion.json'), 'utf8'));
  expect(written.verdict).toBe('BLOCKED');
  expect(written.blockers.some((item) => item.code === 'ARTIFACT_MISSING' && item.file === 'requirements.json')).toBe(true);
});

test('an open mismatch blocks completion', async () => {
  const root = await fixture({
    'mismatches.json': {
      schemaVersion: 1,
      items: [{ id: 'MODE-PLAIN-ENTER-STICKY', status: 'open', requirementId: 'R1' }],
    },
  });
  const report = await evaluateCompletion(root);
  expect(report.verdict).toBe('BLOCKED');
  expect(codes(report)).toContain('BEHAVIOR_MISMATCH_OPEN');
  expect(report.blockers.find((item) => item.code === 'BEHAVIOR_MISMATCH_OPEN').message).toContain('MODE-PLAIN-ENTER-STICKY');
});

test('an unverified requirement blocks completion', async () => {
  const documents = sealedDocuments();
  const root = await fixture({
    'requirements.json': {
      ...documents['requirements.json'],
      requirements: [{ ...documents['requirements.json'].requirements[0], status: 'unverified', evidence: [] }],
    },
  });
  const report = await evaluateCompletion(root);
  expect(report.verdict).toBe('BLOCKED');
  expect(codes(report)).toEqual(['REQUIREMENT_UNVERIFIED']);
});

test('forged verified-pass-paired without paired evidence cannot pass', async () => {
  const documents = sealedDocuments();
  const root = await fixture({
    'requirements.json': {
      ...documents['requirements.json'],
      requirements: [
        {
          ...documents['requirements.json'].requirements[0],
          status: 'verified-pass-paired',
          evidence: [{ type: 'observation-note', note: 'forged claim' }],
        },
      ],
    },
  });
  const report = await evaluateCompletion(root);
  expect(report.verdict).toBe('BLOCKED');
  expect(codes(report)).toContain('REQUIREMENT_VERIFIED_WITHOUT_EVIDENCE');
});

test('a sealed fixture can pass and fill completion fields', async () => {
  const root = await fixture();
  const result = await runCompletion([root]);
  expect(result.exitCode).toBe(0);
  expect(result.report).toMatchObject({
    kind: 'completion',
    verdict: 'PASS',
    blockers: [],
    piVersion: '1.1.0',
    requirementCount: 1,
    executedJourneyCount: 1,
  });
  expect(result.report.cursorReference).toEqual({ pluginsRevision: 'a'.repeat(40), cliVersion: 'reference-test' });
  expect(result.report.evidenceIndex).toEqual([
    { requirementId: 'R1', pair: 'parity/evidence/pairs/example.json', attempts: { cursor: 'cursor-attempt', pi: 'pi-attempt' } },
  ]);
  const written = JSON.parse(await readFile(join(root, 'completion.json'), 'utf8'));
  expect(written.verdict).toBe('PASS');
  expect(written.deploymentManifestDigest).toBe('b'.repeat(64));
});

test('invalid CLI arguments exit 1 without writing a PASS artifact', async () => {
  const result = await runCompletion(['--help']);
  expect(result.exitCode).toBe(1);
  expect(codes(result.report)).toEqual(['INVALID_ARGUMENTS']);
  expect(result.completionPath).toBeNull();
});

test('CLI against current parity tree exits non-zero with BLOCKED', async () => {
  const result = await runCli([]);
  expect(result.code).toBe(2);
  const report = JSON.parse(result.stdout);
  expect(report.verdict).toBe('BLOCKED');
  expect(codes(report)).toEqual(expect.arrayContaining(['SOURCE_LOCK_INCOMPLETE', 'ACCEPTANCE_DEFINITIONS_UNFROZEN', 'REQUIREMENT_UNVERIFIED', 'BEHAVIOR_MISMATCH_OPEN']));
});
