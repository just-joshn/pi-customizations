#!/usr/bin/env node
/**
 * Project live parity/requirements.json into DRAFT acceptance partition bytes.
 * Does not freeze ledgers. Does not claim independent ownership or freeze authority.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const parityRoot = join(repoRoot, 'parity');
const outDir = join(parityRoot, 'acceptance', 'setup-pstack');
const referenceRoot = join(parityRoot, 'reference', 'cursor-plugins');

function sha256Bytes(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function classFromId(id) {
  if (id.includes('-MODE-')) return 'mode';
  if (id.includes('-SETUP-') || id.includes('-CMD-SETUP-')) return 'setup';
  if (id.includes('-CMD-')) return 'command';
  if (id.includes('-PRIN-')) return 'principle';
  if (id.includes('-HOST-')) return 'host';
  return 'behavior';
}

function basisFor(requirement) {
  const evidenceTypes = (requirement.evidence ?? []).map((e) => e.type);
  const basis = ['source-explicit'];
  if (evidenceTypes.some((t) => String(t).includes('paired'))) {
    basis.push('reference-observed-once');
  }
  if (requirement.status === 'unverified') {
    basis.push('unobserved-runtime-control');
  }
  return basis;
}

function tryExcerpt(source) {
  const abs = join(referenceRoot, source.file);
  if (!existsSync(abs)) {
    return { excerpt: null, excerptStatus: 'source-file-absent', observedSha256: null };
  }
  const raw = readFileSync(abs);
  const observedSha256 = sha256Bytes(raw);
  const text = raw.toString('utf8');
  if (observedSha256 !== source.sha256) {
    return {
      excerpt: null,
      excerptStatus: 'source-sha256-mismatch',
      observedSha256,
    };
  }
  const locator = source.locator ?? '';
  const headingMatch = locator.match(/^(#{1,6}\s+.+?)(?:,|$)/);
  if (headingMatch) {
    const heading = headingMatch[1].trim();
    const idx = text.indexOf(heading);
    if (idx >= 0) {
      const after = text.slice(idx);
      const next = after.search(/\n#{1,6}\s+/);
      const block = (next >= 0 ? after.slice(0, next) : after).trim();
      const excerpt = block.length > 1200 ? `${block.slice(0, 1200)}…` : block;
      return { excerpt, excerptStatus: 'locator-heading', observedSha256 };
    }
  }
  const needle = locator.replace(/^.*?\b(beginning to|paragraph beginning to)\s+/i, '').trim();
  if (needle.length >= 12) {
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, text.lastIndexOf('\n', idx) + 1);
      const end = Math.min(text.length, idx + Math.min(needle.length + 400, 800));
      return {
        excerpt: text.slice(start, end).trim(),
        excerptStatus: 'locator-substring',
        observedSha256,
      };
    }
  }
  return { excerpt: null, excerptStatus: 'locator-unresolved', observedSha256 };
}

function referenceEvidence(requirement) {
  const refs = (requirement.evidence ?? [])
    .map((e) => e.pair ?? e.path ?? e.type)
    .filter(Boolean);
  if (refs.length === 0) {
    return { status: 'none', refs: [] };
  }
  if (requirement.status === 'verified-pass-paired') {
    return { status: 'paired-recorded', refs };
  }
  return { status: 'partial-or-unverified', refs };
}

function projectDefinition(requirement) {
  const { excerpt, excerptStatus, observedSha256 } = tryExcerpt(requirement.source);
  const sourceEntry = {
    key: requirement.source.file,
    revision: requirement.source.revision,
    file: requirement.source.file,
    locator: requirement.source.locator,
    sha256: requirement.source.sha256,
    excerptStatus,
  };
  if (observedSha256) sourceEntry.observedSha256 = observedSha256;
  if (excerpt) sourceEntry.excerpt = excerpt;

  return {
    id: requirement.id,
    requirementId: requirement.id,
    behavior: requirement.trigger,
    class: classFromId(requirement.id),
    basis: basisFor(requirement),
    sources: [sourceEntry],
    exactStrings: [],
    matrix: {
      ledger: (requirement.configurationIds ?? []).map((id) => `ledger.${id}`),
    },
    preconditions: requirement.preconditions ?? [],
    startingState: requirement.startingState ?? null,
    actions: (requirement.actions ?? []).map((a) => ({
      input: a.input,
      expect: a.expectedObservation,
    })),
    requiredEffects: requirement.requiredSideEffects ?? [],
    forbiddenEffects: requirement.forbiddenSideEffects ?? [],
    orderingTimingConcurrencyCancellationPersistence:
      requirement.orderingTimingConcurrencyCancellationPersistence ?? null,
    scenarioIds: requirement.scenarioIds ?? [],
    dependencies: requirement.dependencies ?? [],
    referenceEvidence: referenceEvidence(requirement),
    hostTranslation: null,
    openQuestions: [],
    ledgerStatus: requirement.status,
    status: 'DRAFT',
  };
}

function buildConfigurations(ledgerConfigurations) {
  const ledgerAxis = Object.fromEntries(
    ledgerConfigurations.map((c) => [
      `ledger.${c.id}`,
      {
        description: c.description,
        ledgerStatus: c.status,
        ...(c.platform ? { platform: c.platform } : {}),
        ...(Array.isArray(c.platforms) ? { platforms: c.platforms } : {}),
        ...(c.environment !== undefined ? { environment: c.environment } : {}),
      },
    ]),
  );

  return {
    schemaVersion: 1,
    status: 'DRAFT',
    owner: null,
    purpose:
      'Configuration axes for acceptance definitions regenerated from the live requirements ledger. Each definition names a matrix over these axes. Axes a definition does not name are pinned to the baseline value. Regeneration does not establish external custody or freeze authority.',
    baseline: {
      ledger: 'ledger.default',
    },
    axes: {
      ledger: ledgerAxis,
    },
    openAxes: [
      'Supported reference platforms from the official Cursor CLI contract.',
      'Matched paired environments for every ledger configuration cell.',
      'Account-owner prerequisites that still block some reference journeys.',
    ],
    ledgerMatrixRef: 'parity/configurations.json',
  };
}

function main() {
  const requirementsPath = join(parityRoot, 'requirements.json');
  const ledgerConfigsPath = join(parityRoot, 'configurations.json');
  const requirementsDoc = JSON.parse(readFileSync(requirementsPath, 'utf8'));
  const ledgerDoc = JSON.parse(readFileSync(ledgerConfigsPath, 'utf8'));
  const requirements = requirementsDoc.requirements ?? [];

  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new Error('live requirements inventory is empty');
  }

  const definitions = requirements.map(projectDefinition);
  const definitionIds = definitions.map((d) => d.requirementId).sort();
  const liveIds = requirements.map((r) => r.id).sort();
  if (JSON.stringify(definitionIds) !== JSON.stringify(liveIds)) {
    throw new Error('projected definition IDs do not match live requirement IDs');
  }

  const definitionsDoc = {
    schemaVersion: 1,
    status: 'DRAFT',
    partition: 'live-requirements-inventory acceptance definitions (regen-001)',
    owner: null,
    frozen: false,
    denominatorComplete: requirementsDoc.coverageDenominatorComplete === true,
    regeneratedFrom: {
      requirementsPath: 'parity/requirements.json',
      requirementCount: requirements.length,
      coverageDenominatorComplete: requirementsDoc.coverageDenominatorComplete === true,
      acceptanceDefinitionOwner: requirementsDoc.acceptanceDefinitionOwner ?? null,
      acceptanceDefinitionsFrozen: requirementsDoc.acceptanceDefinitionsFrozen === true,
      note: 'Regeneration alone does not authorize freeze. External custody remains required.',
    },
    reference: {
      repository: 'https://github.com/cursor/plugins',
      revision: 'ccb5507cec1546dc88135c1139c811e6c59115ba',
      checkout: 'parity/reference/cursor-plugins',
    },
    refuseToForge:
      'These bytes are DRAFT projections for external custodian review. They do not set acceptanceDefinitionsFrozen, do not name an acceptance owner, and do not satisfy external custody.',
    definitions,
  };

  const configurationsDoc = buildConfigurations(ledgerDoc.configurations ?? []);

  mkdirSync(outDir, { recursive: true });
  const definitionsBytes = Buffer.from(stableStringify(definitionsDoc), 'utf8');
  const configurationsBytes = Buffer.from(stableStringify(configurationsDoc), 'utf8');
  const definitionsPath = join(outDir, 'definitions.json');
  const configurationsPath = join(outDir, 'configurations.json');
  writeFileSync(definitionsPath, definitionsBytes);
  writeFileSync(configurationsPath, configurationsBytes);

  const summary = {
    definitionsPath: 'parity/acceptance/setup-pstack/definitions.json',
    configurationsPath: 'parity/acceptance/setup-pstack/configurations.json',
    definitionsSha256: sha256Bytes(definitionsBytes),
    configurationsSha256: sha256Bytes(configurationsBytes),
    requirementIdCount: definitionIds.length,
    liveRequirementCount: liveIds.length,
    coverageMatch: definitionIds.length === liveIds.length,
    owner: null,
    frozen: false,
    acceptanceDefinitionsFrozenLive: requirementsDoc.acceptanceDefinitionsFrozen === true,
  };

  const summaryPath = join(here, 'regen-summary.json');
  writeFileSync(summaryPath, stableStringify(summary));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main();
