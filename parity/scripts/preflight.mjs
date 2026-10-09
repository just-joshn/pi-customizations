import { createHash } from 'node:crypto';

import { diagnostic, isRecord, isUnsafeArtifactPath, parityDirectory, readArtifact, readJson } from './preflight-files.mjs';

const records = (value) => Array.isArray(value) && value.every(isRecord);
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
const identified = (value) => records(value) && value.every((item) => typeof item.id === 'string' && item.id.length > 0);
const source = (value) => isRecord(value) && typeof value.file === 'string' && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256);
const ledgers = [
  ['source-lock.json', (value) => isRecord(value.cursorPlugins) && isRecord(value.pi) && isRecord(value.cursorCli)],
  ['dependencies.json', (value) => identified(value.nodes) && records(value.edges) && strings(value.unresolvedReferences)],
  ['requirements.json', (value) => identified(value.requirements) && value.requirements.every((item) => source(item.source) && strings(item.configurationIds) && strings(item.scenarioIds))],
  ['configurations.json', (value) => identified(value.configurations) && identified(value.accountOwnerPrerequisites)],
  ['inventory.json', (value) => records(value.items) && value.items.every((item) => typeof item.path === 'string' && typeof item.sha256 === 'string' && isRecord(item.disposition))],
  ['mismatches.json', (value) => identified(value.items)],
];

function report(blockers) {
  return {
    kind: 'preflight',
    verdict: 'BLOCKED',
    blockers: [
      ...blockers,
      diagnostic('ACCEPTANCE_AUTHORITY_UNAVAILABLE', 'contract.md', '§4', 'External independently protected acceptance authority has not been established.', '§4'),
      diagnostic('PAIRED_ACCEPTANCE_VERIFIER_UNIMPLEMENTED', 'contract.md', '§8 and §9', 'The authenticated paired user-journey acceptance verifier is not implemented. This preflight cannot certify parity.'),
    ],
  };
}

function sourceLock(value) {
  if (!value) return [];
  const checks = [
    [value.status !== 'locked', 'SOURCE_LOCK_INCOMPLETE', 'status', 'The source lock is not finalized.'],
    [value.cursorPlugins.completeDependencyClosure !== true, 'SOURCE_CLOSURE_INCOMPLETE', 'cursorPlugins.completeDependencyClosure', 'Complete dependency source closure remains required.'],
    [value.cursorCli.referenceConfigurationCaptured !== true, 'REFERENCE_CONFIGURATION_MISSING', 'cursorCli.referenceConfigurationCaptured', 'Working reference configuration has not been captured.'],
    [value.pi.tarballIntegrityVerified !== true, 'PI_PACKAGE_INTEGRITY_UNVERIFIED', 'pi.tarballIntegrityVerified', 'Pi runtime package integrity has not been verified.'],
  ];
  return checks.filter(([failed]) => failed).map(([, code, locator, message]) => diagnostic(code, 'source-lock.json', locator, message, '§2'));
}

function dependencies(value) {
  if (!value) return [];
  const ids = new Set(value.nodes.map((node) => node.id));
  return [
    ...(!value.nodes.length ? [diagnostic('DEPENDENCY_INVENTORY_EMPTY', 'dependencies.json', 'nodes', 'Dependency inventory is empty.')] : []),
    ...(ids.size !== value.nodes.length ? [diagnostic('DEPENDENCY_IDS_DUPLICATED', 'dependencies.json', 'nodes', 'Dependency identifiers are duplicated.')] : []),
    ...(value.closureAudited !== true ? [diagnostic('DEPENDENCY_AUDIT_MISSING', 'dependencies.json', 'closureAudited', 'Independent recursive closure audit remains required.', '§3')] : []),
    ...value.unresolvedReferences.map((_, index) => diagnostic('DEPENDENCY_REFERENCE_UNRESOLVED', 'dependencies.json', `unresolvedReferences[${index}]`, 'Dependency reference is unresolved.', '§3')),
    ...value.nodes.flatMap((node, index) => (node.readingComplete === false ? [diagnostic('SOURCE_READING_INCOMPLETE', 'dependencies.json', `nodes[${index}]`, 'Required source reading remains incomplete.', '§3')] : [])),
    ...value.edges.flatMap((edge, index) => [
      ...(edge.status !== 'resolved' ? [diagnostic('DEPENDENCY_EDGE_UNRESOLVED', 'dependencies.json', `edges[${index}]`, 'Dependency edge has not been resolved.', '§3')] : []),
      ...(!ids.has(edge.from) || !ids.has(edge.to) ? [diagnostic('DEPENDENCY_NODE_MISSING', 'dependencies.json', `edges[${index}]`, 'Dependency edge refers to a missing node.', '§3')] : []),
    ]),
  ];
}

function requirements(value, configurations) {
  if (!value) return [];
  const ids = new Set(value.requirements.map((item) => item.id));
  const configIds = new Set(configurations?.configurations.map((item) => item.id) ?? []);
  return [
    ...(!value.requirements.length ? [diagnostic('REQUIREMENT_INVENTORY_EMPTY', 'requirements.json', 'requirements', 'Requirement inventory is empty.')] : []),
    ...(ids.size !== value.requirements.length ? [diagnostic('REQUIREMENT_IDS_DUPLICATED', 'requirements.json', 'requirements', 'Requirement identifiers are duplicated.')] : []),
    ...(!value.acceptanceDefinitionOwner || value.acceptanceDefinitionsFrozen !== true
      ? [diagnostic('ACCEPTANCE_DEFINITIONS_UNFROZEN', 'requirements.json', 'acceptanceDefinitionsFrozen', 'Independent acceptance definitions are not frozen.', '§4')]
      : []),
    ...(value.coverageDenominatorComplete !== true ? [diagnostic('COVERAGE_DENOMINATOR_INCOMPLETE', 'requirements.json', 'coverageDenominatorComplete', 'Full requirement-by-configuration denominator is incomplete.')] : []),
    ...value.requirements.flatMap((item, index) => [
      ...(!item.configurationIds.length ? [diagnostic('REQUIREMENT_CONFIGURATIONS_EMPTY', 'requirements.json', `requirements[${index}]`, 'Requirement has no configuration obligations.')] : []),
      ...(!item.scenarioIds.length ? [diagnostic('REQUIREMENT_SCENARIOS_EMPTY', 'requirements.json', `requirements[${index}]`, 'Requirement has no user-journey scenarios.')] : []),
      ...item.configurationIds
        .filter((id) => configurations && !configIds.has(id))
        .map(() => diagnostic('CONFIGURATION_MISSING', 'requirements.json', `requirements[${index}].configurationIds`, 'Required configuration is not in the matrix.')),
    ]),
  ];
}

function openWork(configurations, mismatches) {
  return [
    ...(configurations?.configurations.length === 0 ? [diagnostic('CONFIGURATION_INVENTORY_EMPTY', 'configurations.json', 'configurations', 'Configuration inventory is empty.')] : []),
    ...(configurations?.accountOwnerPrerequisites ?? []).flatMap((item, index) =>
      item.status !== 'resolved' ? [diagnostic('ACCOUNT_OWNER_PREREQUISITE_OPEN', 'configurations.json', `accountOwnerPrerequisites[${index}]`, 'Account-owner prerequisite remains open.')] : [],
    ),
    ...(mismatches?.items ?? []).flatMap((item, index) => (item.status !== 'resolved' ? [diagnostic('BEHAVIOR_MISMATCH_OPEN', 'mismatches.json', `items[${index}]`, 'Behavioral mismatch remains unresolved.')] : [])),
  ];
}

function* unsupportedClaims(value, file, locator = '') {
  let pending = { value, locator, next: undefined };
  while (pending) {
    const { value: item, locator: path, next } = pending;
    if (isRecord(item) && (item.passed === true || item.status === 'passed' || item.verdict === 'PASS' || item.verdict === 'VERIFIED')) {
      yield diagnostic('UNSUPPORTED_ACCEPTANCE_CLAIM', file, path, 'A mutable passing declaration is not authenticated acceptance evidence.');
    }
    const children = Array.isArray(item)
      ? item.map((child, index) => ({ value: child, locator: `${path}[${index}]` }))
      : isRecord(item)
        ? Object.entries(item).map(([key, child]) => ({ value: child, locator: path ? `${path}.${key}` : key }))
        : [];
    pending = children.reduceRight((tail, child) => ({ ...child, next: tail }), next);
  }
}

async function sourceDigest(root, path, expected, code, file, locator) {
  if (isUnsafeArtifactPath(path)) return [diagnostic('UNSAFE_ARTIFACT_PATH', String(path), '', 'Reference source paths must be relative and traversal-free.')];
  const artifact = await readArtifact(root, `reference/cursor-plugins/${path}`);
  if (!artifact.ok) return [artifact.blocker];
  const actual = createHash('sha256').update(artifact.bytes).digest('hex');
  return actual === expected ? [] : [diagnostic(code, file, locator, 'Reference source bytes do not match the recorded SHA-256.', '§2')];
}

async function inventory(root, value) {
  if (!value) return [];
  if (!value.items.length) return [diagnostic('SOURCE_INVENTORY_EMPTY', 'inventory.json', 'items', 'Source inventory is empty.')];
  const checks = await Promise.all(
    value.items.map(async (item, index) => [
      ...(!item.disposition.status || item.disposition.status === 'unassigned' ? [diagnostic('SOURCE_DISPOSITION_MISSING', 'inventory.json', `items[${index}]`, 'Source item has no reviewed disposition.', '§4')] : []),
      ...(await sourceDigest(root, item.path, item.sha256, 'SOURCE_HASH_MISMATCH', 'inventory.json', `items[${index}].sha256`)),
    ]),
  );
  return checks.flat();
}

function scenarioShape(value) {
  return isRecord(value.fixture) && isRecord(value.comparison) && isRecord(value.execution) && records(value.actions);
}

async function scenario(root, id) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) return [diagnostic('UNSAFE_ARTIFACT_PATH', 'requirements.json', 'scenarioIds', 'Scenario identifiers cannot contain path separators or traversal.')];
  const path = `scenarios/${id}.json`;
  const result = await readJson(root, path, scenarioShape);
  if (!result.ok) return [result.blocker];
  const value = result.value;
  return [
    ...unsupportedClaims(value, path),
    ...(!value.fixture.digest ? [diagnostic('SCENARIO_FIXTURE_UNPINNED', path, 'fixture.digest', 'Scenario fixture digest is missing.')] : []),
    ...(value.comparison.oracleFrozen !== true ? [diagnostic('SCENARIO_ORACLE_UNFROZEN', path, 'comparison.oracleFrozen', 'Scenario comparison definitions are not frozen.')] : []),
    ...(!value.actions.length ? [diagnostic('SCENARIO_ACTIONS_EMPTY', path, 'actions', 'Scenario has no literal user actions.')] : []),
    ...(!value.execution.pairId ? [diagnostic('SCENARIO_PAIR_MISSING', path, 'execution.pairId', 'No executed reference-and-candidate pair is linked.')] : []),
  ];
}

async function journeys(root, value) {
  if (!value) return [];
  const sourceChecks = await Promise.all(value.requirements.map((item, index) => sourceDigest(root, item.source.file, item.source.sha256, 'REQUIREMENT_SOURCE_HASH_MISMATCH', 'requirements.json', `requirements[${index}].source.sha256`)));
  const scenarioIds = [...new Set(value.requirements.flatMap((item) => item.scenarioIds))];
  const scenarioChecks = await Promise.all(scenarioIds.map((id) => scenario(root, id)));
  return [...sourceChecks.flat(), ...scenarioChecks.flat()];
}

export async function inspectParity(directory) {
  const root = await parityDirectory(directory);
  if (!root) return report([diagnostic('INVALID_PARITY_DIRECTORY', '', '', 'Select an existing parity directory.')]);
  const loaded = await Promise.all(ledgers.map(async ([path, validate]) => [path, await readJson(root, path, validate)]));
  const values = Object.fromEntries(loaded.filter(([, result]) => result.ok).map(([path, result]) => [path, result.value]));
  return report([
    ...loaded.filter(([, result]) => !result.ok).map(([, result]) => result.blocker),
    ...loaded.flatMap(([path, result]) => (result.ok ? [...unsupportedClaims(result.value, path)] : [])),
    ...sourceLock(values['source-lock.json']),
    ...dependencies(values['dependencies.json']),
    ...requirements(values['requirements.json'], values['configurations.json']),
    ...(await inventory(root, values['inventory.json'])),
    ...(await journeys(root, values['requirements.json'])),
    ...openWork(values['configurations.json'], values['mismatches.json']),
  ]);
}
