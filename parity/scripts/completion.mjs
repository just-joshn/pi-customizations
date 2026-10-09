import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { diagnostic, isRecord, parityDirectory, readArtifact, readJson } from './preflight-files.mjs';

const GATE_VERSION = 1;
const CLOSED_MISMATCH = /^(closed|resolved)(-|$)/;
const VERIFIED = 'verified-pass-paired';

const ledgers = [
  ['source-lock.json', (value) => isRecord(value.cursorPlugins) && isRecord(value.pi) && isRecord(value.cursorCli)],
  ['dependencies.json', (value) => Array.isArray(value.nodes) && Array.isArray(value.edges) && Array.isArray(value.unresolvedReferences)],
  ['requirements.json', (value) => Array.isArray(value.requirements) && value.requirements.every(isRecord)],
  ['configurations.json', (value) => Array.isArray(value.configurations)],
  ['mismatches.json', (value) => Array.isArray(value.items) && value.items.every(isRecord)],
];

function pairedEvidence(requirement) {
  const entries = Array.isArray(requirement.evidence) ? requirement.evidence : [];
  return entries.find(
    (item) =>
      isRecord(item) &&
      item.type === 'paired-run' &&
      typeof item.pair === 'string' &&
      item.pair.length > 0 &&
      isRecord(item.attempts) &&
      typeof item.attempts.cursor === 'string' &&
      item.attempts.cursor.length > 0 &&
      typeof item.attempts.pi === 'string' &&
      item.attempts.pi.length > 0,
  );
}

function sourceLockBlockers(value) {
  if (!value) return [];
  return [
    ...(value.status !== 'locked' ? [diagnostic('SOURCE_LOCK_INCOMPLETE', 'source-lock.json', 'status', 'The source lock is not finalized.', '§2')] : []),
    ...(value.cursorPlugins.completeDependencyClosure !== true
      ? [diagnostic('SOURCE_CLOSURE_INCOMPLETE', 'source-lock.json', 'cursorPlugins.completeDependencyClosure', 'Complete dependency source closure remains required.', '§2')]
      : []),
    ...(value.cursorCli.referenceConfigurationCaptured !== true
      ? [diagnostic('REFERENCE_CONFIGURATION_MISSING', 'source-lock.json', 'cursorCli.referenceConfigurationCaptured', 'Working reference configuration has not been captured.', '§2')]
      : []),
    ...(value.pi.tarballIntegrityVerified !== true
      ? [diagnostic('PI_PACKAGE_INTEGRITY_UNVERIFIED', 'source-lock.json', 'pi.tarballIntegrityVerified', 'Pi runtime package integrity has not been verified.', '§2')]
      : []),
  ];
}

function dependencyBlockers(value) {
  if (!value) return [];
  const ids = new Set(value.nodes.map((node) => node.id).filter((id) => typeof id === 'string' && id.length > 0));
  return [
    ...(!value.nodes.length ? [diagnostic('DEPENDENCY_INVENTORY_EMPTY', 'dependencies.json', 'nodes', 'Dependency inventory is empty.', '§3')] : []),
    ...(value.closureAudited !== true ? [diagnostic('DEPENDENCY_AUDIT_MISSING', 'dependencies.json', 'closureAudited', 'Independent recursive closure audit remains required.', '§3')] : []),
    ...value.unresolvedReferences.map((_, index) =>
      diagnostic('DEPENDENCY_REFERENCE_UNRESOLVED', 'dependencies.json', `unresolvedReferences[${index}]`, 'Dependency reference is unresolved.', '§3'),
    ),
    ...value.nodes.flatMap((node, index) =>
      node.readingComplete === false ? [diagnostic('SOURCE_READING_INCOMPLETE', 'dependencies.json', `nodes[${index}]`, 'Required source reading remains incomplete.', '§3')] : [],
    ),
    ...value.edges.flatMap((edge, index) => [
      ...(edge.status !== 'resolved' ? [diagnostic('DEPENDENCY_EDGE_UNRESOLVED', 'dependencies.json', `edges[${index}]`, 'Dependency edge has not been resolved.', '§3')] : []),
      ...(!ids.has(edge.from) || !ids.has(edge.to)
        ? [diagnostic('DEPENDENCY_NODE_MISSING', 'dependencies.json', `edges[${index}]`, 'Dependency edge refers to a missing node.', '§3')]
        : []),
    ]),
  ];
}

function requirementBlockers(value) {
  if (!value) return [];
  const blockers = [
    ...(!value.requirements.length ? [diagnostic('REQUIREMENT_INVENTORY_EMPTY', 'requirements.json', 'requirements', 'Requirement inventory is empty.', '§4')] : []),
    ...(!value.acceptanceDefinitionOwner || value.acceptanceDefinitionsFrozen !== true
      ? [diagnostic('ACCEPTANCE_DEFINITIONS_UNFROZEN', 'requirements.json', 'acceptanceDefinitionsFrozen', 'Independent acceptance definitions are not frozen.', '§4')]
      : []),
    ...(value.coverageDenominatorComplete !== true
      ? [diagnostic('COVERAGE_DENOMINATOR_INCOMPLETE', 'requirements.json', 'coverageDenominatorComplete', 'Full requirement-by-configuration denominator is incomplete.', '§4')]
      : []),
  ];
  for (const [index, item] of value.requirements.entries()) {
    const locator = `requirements[${index}]`;
    if (typeof item.id !== 'string' || !item.id) {
      blockers.push(diagnostic('REQUIREMENT_ID_MISSING', 'requirements.json', locator, 'Requirement is missing an identifier.', '§4'));
      continue;
    }
    if (item.status !== VERIFIED) {
      blockers.push(
        diagnostic('REQUIREMENT_UNVERIFIED', 'requirements.json', `${locator}.status`, `Requirement ${item.id} is not verified-pass-paired.`, '§9'),
      );
      continue;
    }
    if (!pairedEvidence(item)) {
      blockers.push(
        diagnostic(
          'REQUIREMENT_VERIFIED_WITHOUT_EVIDENCE',
          'requirements.json',
          `${locator}.evidence`,
          `Requirement ${item.id} claims verified-pass-paired without paired Cursor+Pi evidence.`,
          '§9',
        ),
      );
    }
  }
  return blockers;
}

async function scenarioEvidenceBlockers(root, value) {
  if (!value) return [];
  const blockers = [];
  for (const [index, item] of value.requirements.entries()) {
    const scenarioIds = Array.isArray(item.scenarioIds) ? item.scenarioIds : [];
    if (!scenarioIds.length) {
      blockers.push(diagnostic('REQUIREMENT_SCENARIOS_EMPTY', 'requirements.json', `requirements[${index}].scenarioIds`, 'Requirement has no user-journey scenarios.', '§8'));
      continue;
    }
    const evidence = pairedEvidence(item);
    if (item.status === VERIFIED && evidence) {
      const pair = await readArtifact(root, evidence.pair.replace(/^parity\//, ''));
      if (!pair.ok) blockers.push(pair.blocker);
    }
    for (const scenarioId of scenarioIds) {
      if (typeof scenarioId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(scenarioId)) {
        blockers.push(diagnostic('UNSAFE_ARTIFACT_PATH', 'requirements.json', `requirements[${index}].scenarioIds`, 'Scenario identifiers cannot contain path separators or traversal.', '§8'));
        continue;
      }
      const scenario = await readJson(root, `scenarios/${scenarioId}.json`, (doc) => isRecord(doc));
      if (!scenario.ok) {
        blockers.push(scenario.blocker);
        continue;
      }
      if (!scenario.value.execution?.pairId) {
        blockers.push(diagnostic('SCENARIO_PAIR_MISSING', `scenarios/${scenarioId}.json`, 'execution.pairId', 'No executed reference-and-candidate pair is linked.', '§8'));
      }
    }
  }
  return blockers;
}

function mismatchBlockers(value) {
  if (!value) return [];
  return value.items.flatMap((item, index) => {
    if (typeof item.status === 'string' && CLOSED_MISMATCH.test(item.status)) return [];
    return [
      diagnostic(
        'BEHAVIOR_MISMATCH_OPEN',
        'mismatches.json',
        `items[${index}]`,
        `Behavioral mismatch ${item.id ?? index} remains unresolved.`,
        '§9',
      ),
    ];
  });
}

function identityFields(values, blockers, evidenceIndex) {
  const lock = values['source-lock.json'];
  const requirements = values['requirements.json'];
  const configurations = values['configurations.json'];
  return {
    cursorReference: lock
      ? {
          pluginsRevision: lock.cursorPlugins?.revision ?? null,
          cliVersion: lock.cursorCli?.version ?? null,
        }
      : null,
    piVersion: lock?.pi?.version ?? null,
    sourceRevisions: lock
      ? {
          cursorPlugins: lock.cursorPlugins?.revision ?? null,
          pi: lock.pi?.revision ?? null,
          implementationBaseline: lock.implementationBaseline?.revision ?? null,
        }
      : null,
    candidateRevision: lock?.implementationBaseline?.revision ?? null,
    packageDigest: lock?.implementationBaseline?.packageDigest ?? lock?.pi?.registryIntegrity ?? null,
    deploymentManifestDigest: lock?.cursorCli?.fullDistributionManifestSha256 ?? null,
    acceptanceDefinitionHashes: {
      frozen: requirements?.acceptanceDefinitionsFrozen === true,
      owner: requirements?.acceptanceDefinitionOwner ?? null,
    },
    configurationMatrix: configurations ? 'configurations.json' : null,
    requirementCount: requirements?.requirements?.length ?? 0,
    executedJourneyCount: evidenceIndex.length,
    evidenceIndex,
  };
}

function evidenceIndexFrom(requirements) {
  if (!requirements) return [];
  return requirements.requirements.flatMap((item) => {
    const evidence = pairedEvidence(item);
    if (!evidence) return [];
    return [{ requirementId: item.id, pair: evidence.pair, attempts: evidence.attempts }];
  });
}

export async function evaluateCompletion(directory) {
  const root = await parityDirectory(directory);
  if (!root) {
    return {
      kind: 'completion',
      gateVersion: GATE_VERSION,
      verdict: 'BLOCKED',
      blockers: [diagnostic('INVALID_PARITY_DIRECTORY', '', '', 'Select an existing parity directory.', '§9')],
      ...identityFields({}, [diagnostic('INVALID_PARITY_DIRECTORY', '', '', 'Select an existing parity directory.', '§9')], []),
      evaluatedAt: new Date().toISOString(),
    };
  }

  const loaded = await Promise.all(ledgers.map(async ([path, validate]) => [path, await readJson(root, path, validate)]));
  const values = Object.fromEntries(loaded.filter(([, result]) => result.ok).map(([path, result]) => [path, result.value]));
  const loadBlockers = loaded.filter(([, result]) => !result.ok).map(([, result]) => result.blocker);
  const requirements = values['requirements.json'];
  const evidenceIndex = evidenceIndexFrom(requirements);
  const blockers = [
    ...loadBlockers,
    ...sourceLockBlockers(values['source-lock.json']),
    ...dependencyBlockers(values['dependencies.json']),
    ...requirementBlockers(requirements),
    ...(await scenarioEvidenceBlockers(root, requirements)),
    ...mismatchBlockers(values['mismatches.json']),
  ];

  return {
    kind: 'completion',
    gateVersion: GATE_VERSION,
    verdict: blockers.length === 0 ? 'PASS' : 'BLOCKED',
    blockers,
    ...identityFields(values, blockers, evidenceIndex),
    evaluatedAt: new Date().toISOString(),
  };
}

export async function writeCompletion(root, report) {
  const target = join(root, 'completion.json');
  const temporary = join(root, 'completion.json.tmp');
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, target);
  return target;
}
