import { digestOf } from '../canonical.mjs';
import { artifactRef, coverage, graphEdge, graphNode } from '../envelope.mjs';
import { isTextFile } from './target-source.mjs';

export const STATIC_LIMITATION = 'JavaScript and HTML were parsed as inert text by pi-rea; no file from the target was executed, required, or evaluated.';
export const RELATION_LIMITATION = 'Static imports, entrypoints, endpoints and storage relationships do not prove runtime execution.';
export const ELECTRON_LIMITATION = 'Electron relationships are derived from inert syntax; runtime registration, reachability, defaults and enforcement remain unproven.';
export const ELECTRON_IDENTITY_LIMITATION = 'Electron API identity follows proven lexical aliases. Reassigned bindings, dynamic selections and overwritten namespace members are unresolved; missing findings do not establish absence.';
export const COVERAGE_LIMITATION = 'Graph coverage is incomplete; unavailable facts remain explicit and must not be read as absence.';
export const PARSER_LIMITATION = 'This port scans tokens with its own lexer rather than the reference parser; counts describe this scan and a differently ordered expression may stay unresolved.';

const jsPrefix = 'jag';

export function extractor(operation) {
  return { name: 'pi-rea-javascript-application', version: '1', operation, executable_sha256: null };
}

export function fileArtifact(sha256, logicalPath, bytes, unpacked = false) {
  return artifactRef({ available: true, sha256, logicalPath, bytes, unpacked });
}

export function fileNode({ kind, logicalPath, sha256, bytes, properties = {}, limitations = [], authority = 'artifact-bytes', confidence = 'exact', state = 'observed' }) {
  return graphNode({
    prefix: jsPrefix,
    kind,
    identity: { strategy: 'content-digest', stability: 'global-exact', sha256, key: logicalPath, artifact_sha256: sha256 },
    observations: [
      {
        label: logicalPath,
        properties: { path: logicalPath, bytes, ...properties },
        authority,
        state,
        confidence,
        artifact: fileArtifact(sha256, logicalPath, bytes),
        location: { available: true, value: { kind: 'artifact-path', path: logicalPath } },
        extractor: extractor(`retain-${kind}`),
        coverage: coverage({ status: 'complete' }),
        limitations: [...limitations, COVERAGE_LIMITATION],
      },
    ],
  });
}

export function moduleNode({ namespace, key, artifactSha256, label, properties, authority = 'ast-static-analysis', state = 'inferred', confidence = 'high', location = null, limitations = [] }) {
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
        artifact: artifactRef({ available: true, sha256: artifactSha256, logicalPath: key }),
        location: location ?? { available: true, value: { kind: 'artifact-path', path: key } },
        extractor: extractor('resolve-semantic-module'),
        coverage: coverage({ status: 'complete' }),
        limitations: [...limitations, RELATION_LIMITATION, COVERAGE_LIMITATION],
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

export function assetProperties({ logicalPath, bytes, sha256, parseStatus, fileKind, jsonTopLevelKeys = null }) {
  return {
    path: logicalPath,
    bytes,
    inventory_artifact_id: `art_${sha256}`,
    unpacked: false,
    file_kind: fileKind,
    text_status: isTextFile(logicalPath) ? 'included' : 'not-applicable',
    parse_status: parseStatus,
    json_parse_status: null,
    json_top_level_keys: jsonTopLevelKeys ?? [],
    omitted_json_top_level_keys: 0,
    vendor_markers: [],
  };
}

export function digestFor(buffer) {
  return digestOf(buffer);
}

export function edgeId(edge) {
  return `${edge.source_node_id}->${edge.relation}->${edge.target_node_id}`;
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
