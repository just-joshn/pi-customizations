import { artifactIdForContent, digestOf } from '../canonical.mjs';
import { artifactRef, coverage, graphEdge, graphNode } from '../envelope.mjs';
import { isTextFile } from './target-source.mjs';

export const STATIC_LIMITATION =
  'JavaScript and HTML were parsed as inert text; bundle bootstrap code was never executed.';
export const RELATION_LIMITATION =
  'Static imports, entrypoints, workers, endpoints, and storage relationships do not prove runtime execution.';
export const BINDING_LIMITATION =
  'CommonJS and ESM binding relationships were recovered from inert syntax and resolved only within the inventoried artifact container.';
export const DYNAMIC_PATH_LIMITATION =
  'Static paths and relationships may remain unresolved when expressions are dynamic or obfuscated.';
export const WEBPACK_LIMITATION =
  'Webpack/Rspack factories were recovered from AST literals; REA did not invoke push handlers or bundle bootstrap code.';
export const ELECTRON_LIMITATION =
  'Electron relationships are derived from inert syntax; runtime registration, reachability, defaults, and enforcement remain unproven.';
export const ELECTRON_IDENTITY_LIMITATION =
  'Electron API identity follows proven lexical module aliases and structurally verified module-namespace interop. Other reassignments, dynamic selections, and visibly overwritten namespace members are unresolved; missing findings do not establish absence. Arbitrary call side effects and runtime registration are not evaluated.';
export const COVERAGE_LIMITATION =
  'Graph coverage is incomplete; unavailable facts remain explicit and must not be read as absence.';
export const NATIVE_MEMBER_LIMITATION =
  'Native member names are requested by JavaScript syntax and are not verified binary exports in this workflow.';
export const PARSER_LIMITATION =
  'This port scans tokens with its own lexer rather than the reference parser; counts describe this scan and a differently ordered expression may stay unresolved.';
export const RUNTIME_RELATION_LIMITATION =
  'Static syntax does not prove that this relationship executes at runtime.';
export const SEMANTIC_VALUE_LIMITATION =
  'Values and aliases were recovered from inert syntax only; no JavaScript was executed.';
export const SEMANTIC_MUTATION_LIMITATION =
  'Cross-function mutation and dynamic property resolution remain unknown.';
export const SEMANTIC_CALL_LIMITATION =
  'Local call, argument, return, and closure relations are static candidates and do not prove runtime invocation.';
export const SEMANTIC_PROMISE_LIMITATION =
  'Promise ownership covers explicit unshadowed Promise construction, static factories, aggregation, chaining, and await syntax only.';
export const SEMANTIC_RETURN_LIMITATION =
  'Return sites include only direct callable returns; nested callable returns remain separate.';
export const RETURN_SHAPE_LIMITATION =
  'Return shapes are inferred from inert syntax and do not prove runtime behavior.';
export const AST_COVERAGE_LIMITATION =
  'AST coverage is incomplete; omitted or dynamic facts must not be interpreted as absence.';
export const BARE_PACKAGE_LIMITATION =
  'No matching bare package was inventoried in an enclosing node_modules directory.';
export const NATIVE_SYMBOL_LIMITATION =
  'The .node artifact path is resolved, but requested JavaScript members have not been verified against native symbols.';
export const NATIVE_REQUEST_EDGE_LIMITATION =
  'Requested JavaScript members are not verified native exports.';
export const IPC_LITERAL_PAIR_LIMITATION =
  'Literal channel equality does not prove that the handler is registered or reachable at runtime.';
export const WEB_PREFERENCES_LIMITATION =
  'Only explicitly present webPreferences are reported; omitted properties are not interpreted as Electron defaults.';
export const LEXICAL_WRAPPER_LIMITATION =
  'Lexical wrapper substitution is a static candidate; guards, runtime overrides and execution remain unverified.';
export const STATIC_UNRESOLVED_LIMITATION =
  'The static reference could not be resolved within the inventoried artifact.';
export const NATIVE_EXPORT_OBSERVE_LIMITATION =
  'JavaScript syntax identifies requested member names; it does not prove that the native binary exports or implements them.';

export const SEMANTIC_ANALYSIS_LIMITATIONS = [
  SEMANTIC_MUTATION_LIMITATION,
  SEMANTIC_CALL_LIMITATION,
  SEMANTIC_PROMISE_LIMITATION,
  SEMANTIC_RETURN_LIMITATION,
  SEMANTIC_VALUE_LIMITATION,
];

export const EXPOSE_EDGE_LIMITATIONS = [
  SEMANTIC_MUTATION_LIMITATION,
  SEMANTIC_CALL_LIMITATION,
  SEMANTIC_PROMISE_LIMITATION,
  SEMANTIC_RETURN_LIMITATION,
  RUNTIME_RELATION_LIMITATION,
  SEMANTIC_VALUE_LIMITATION,
];

export function semanticImportEdgeLimitations(resolutionStatus) {
  if (resolutionStatus === 'external') {
    return [
      SEMANTIC_MUTATION_LIMITATION,
      SEMANTIC_CALL_LIMITATION,
      BARE_PACKAGE_LIMITATION,
      SEMANTIC_PROMISE_LIMITATION,
      SEMANTIC_RETURN_LIMITATION,
      RUNTIME_RELATION_LIMITATION,
      SEMANTIC_VALUE_LIMITATION,
    ];
  }
  return [...EXPOSE_EDGE_LIMITATIONS];
}

export function staticImportEdgeLimitations(resolutionStatus) {
  if (resolutionStatus === 'external') {
    return [BARE_PACKAGE_LIMITATION, RUNTIME_RELATION_LIMITATION];
  }
  return [RUNTIME_RELATION_LIMITATION];
}

export const ORACLE_BASE_LIMITATIONS = [
  BINDING_LIMITATION,
  STATIC_LIMITATION,
  RELATION_LIMITATION,
  DYNAMIC_PATH_LIMITATION,
  WEBPACK_LIMITATION,
];

const jsPrefix = 'jag';

export function extractor(operation) {
  return { name: 'rea-javascript-artifact-reconstruction', version: '1', operation, executable_sha256: null };
}

export function retainOperationForKind(kind, { logicalPath = null } = {}) {
  if (kind === 'package') return 'parse-package-json';
  if (kind === 'electron-main' || kind === 'preload-entrypoint' || kind === 'electron-renderer') {
    return 'discover-electron-entrypoint';
  }
  if (kind === 'artifact' && logicalPath === 'artifact-root') return 'inventory-root';
  if (kind === 'javascript-asset' || kind === 'artifact' || kind === 'source-map' || kind === 'native-addon') {
    return 'inventory-relevant-file';
  }
  return `retain-${kind}`;
}

export function fileArtifact(sha256, _logicalPath = null, _bytes = null, _unpacked = null) {
  return artifactRef({ available: true, sha256 });
}

export function contentDigestIdentity(sha256) {
  return { strategy: 'content-digest', stability: 'global-exact', sha256 };
}

export function artifactLocalIdentity(sha256, namespace, key) {
  return { strategy: 'artifact-local-key', stability: 'artifact-version', artifact_sha256: sha256, namespace, key };
}

export function fileOccurrence({ containerSha256, path, sha256 }) {
  return { container_sha256: containerSha256, path, sha256 };
}

export function fileNode({
  kind,
  logicalPath,
  sha256,
  bytes,
  properties = {},
  limitations = [],
  authority = 'artifact-bytes',
  confidence = 'exact',
  state = 'observed',
  identity = null,
  label = null,
  locationPath = null,
  locationValue = null,
  extractorOperation = null,
  resultCoverage = null,
  includePath = true,
  includeBytes = true,
}) {
  const pathKey = locationPath ?? logicalPath;
  const baseProperties = {
    ...(includePath ? { path: logicalPath } : {}),
    ...(includeBytes ? { bytes } : {}),
    ...properties,
  };
  return graphNode({
    prefix: jsPrefix,
    kind,
    identity: identity ?? { ...contentDigestIdentity(sha256), key: logicalPath, artifact_sha256: sha256 },
    observations: [
      {
        label: label ?? logicalPath,
        properties: baseProperties,
        authority,
        state,
        confidence,
        artifact: fileArtifact(sha256, logicalPath, bytes),
        location: {
          available: true,
          value: locationValue ?? { kind: 'artifact-path', path: pathKey },
        },
        extractor: extractor(extractorOperation ?? retainOperationForKind(kind, { logicalPath: pathKey })),
        coverage: resultCoverage ?? coverage({ status: 'complete', omittedCount: 0 }),
        limitations: [...limitations],
      },
    ],
  });
}

export function moduleNode({
  namespace,
  key,
  artifactSha256,
  label,
  properties,
  authority = 'ast-static-analysis',
  state = 'inferred',
  confidence = 'high',
  location = null,
  limitations = [],
  fileText = null,
  extractorOperation = 'recover-source-module',
  resultCoverage = null,
}) {
  const sourceRangeLocation =
    typeof key === 'string' && fileText !== null
      ? {
          available: true,
          value: {
            kind: 'source-range',
            source: key.includes(':') ? key.slice(key.indexOf(':') + 1) : key,
            start: { line: 1, column: 0 },
            end: { line: Math.max(1, fileText.split('\n').length), column: 0 },
          },
        }
      : null;
  return graphNode({
    prefix: jsPrefix,
    kind: 'javascript-module',
    identity: { strategy: 'artifact-local-key', stability: 'artifact-version', namespace, key, artifact_sha256: artifactSha256 },
    observations: [
      {
        label,
        properties,
        authority,
        state,
        confidence,
        artifact: artifactRef({ available: true, sha256: artifactSha256 }),
        location: location ?? sourceRangeLocation ?? { available: true, value: { kind: 'artifact-path', path: key } },
        extractor: extractor(extractorOperation),
        coverage: resultCoverage ?? coverage({ status: 'complete', omittedCount: 0 }),
        limitations: limitations.length > 0 ? [...limitations] : [...SEMANTIC_ANALYSIS_LIMITATIONS],
      },
    ],
  });
}

export function importsEdge(sourceNodeId, targetNodeId, request, resolution, artifactSha256) {
  return graphEdge({
    source: sourceNodeId,
    target: targetNodeId,
    relation: 'imports',
    properties: {
      module_link_kind: request.kind,
      specifier: request.specifier,
      imported_name: request.importedName,
      imported_path: request.importedName === null ? [] : [request.importedName],
      local_name: request.localName,
      exported_name: null,
      resolved_path: resolution.resolvedPath,
      resolution_status: resolution.status,
      target_file_kind: resolution.targetFileKind,
      target_json_status: resolution.targetJsonStatus ?? null,
    },
    evidence: {
      authority: 'static-relationship-inference',
      state: 'inferred',
      confidence: request.kind === 'import' || request.kind === 'require' ? 'high' : 'medium',
      artifact: artifactRef({ available: true, sha256: artifactSha256 }),
      location: { available: true, value: { kind: 'source-range', source: request.source, start: request.range.start, end: request.range.end } },
      extractor: extractor('resolve-module-link'),
      coverage: coverage({ status: 'complete' }),
      limitations: [RELATION_LIMITATION, COVERAGE_LIMITATION],
      evidence_ids: [],
    },
  });
}

export function assetProperties({
  logicalPath,
  bytes,
  sha256,
  parseStatus,
  fileKind,
  jsonTopLevelKeys = null,
  analysisCoverage = null,
  omittedJsonTopLevelKeys = 0,
}) {
  return {
    path: logicalPath,
    bytes,
    inventory_artifact_id: artifactIdForContent(sha256),
    unpacked: false,
    file_kind: fileKind,
    text_status: isTextFile(logicalPath) ? 'included' : 'not-applicable',
    parse_status: parseStatus,
    ...(analysisCoverage === null ? {} : { analysis_coverage: analysisCoverage }),
    json_parse_status: null,
    json_top_level_keys: jsonTopLevelKeys ?? [],
    omitted_json_top_level_keys: omittedJsonTopLevelKeys,
    vendor_markers: [],
  };
}

export function digestFor(buffer) {
  return digestOf(buffer);
}

export function edgeId(edge) {
  return edge.edge_id ?? `${edge.source_node_id}->${edge.relation}->${edge.target_node_id}`;
}

export function sortEdges(edges) {
  const seen = new Set();
  const unique = [];
  for (const edge of [...edges].sort((left, right) => (edgeId(left) < edgeId(right) ? -1 : 1))) {
    const id = edgeId(edge);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(edge);
  }
  return unique;
}

export function sortNodes(nodes) {
  return [...nodes].sort((left, right) => (left.node_id < right.node_id ? -1 : 1));
}
