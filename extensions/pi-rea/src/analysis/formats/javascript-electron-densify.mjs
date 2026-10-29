import { digestOf } from '../canonical.mjs';
import { artifactRef, coverage, edgeEvidence, graphEdge, graphNode } from '../envelope.mjs';
import {
  AST_COVERAGE_LIMITATION,
  artifactLocalIdentity,
  contentDigestIdentity,
  extractor,
  fileNode,
  fileOccurrence,
  LEXICAL_WRAPPER_LIMITATION,
  NATIVE_EXPORT_OBSERVE_LIMITATION,
  NATIVE_REQUEST_EDGE_LIMITATION,
  NATIVE_SYMBOL_LIMITATION,
  RUNTIME_RELATION_LIMITATION,
} from './javascript-nodes.mjs';
import { extensionOf } from './target-source.mjs';

const PARTIAL_EDGE_COVERAGE = coverage({ status: 'partial', omittedCount: null });
const LOADFILE_BASE_UNKNOWN = 'Inventoried package metadata does not establish one application root for this source; the loadFile base is unknown.';

export function observationFingerprintIdentity(rootSha256, scope, key) {
  return {
    strategy: 'observation-fingerprint',
    stability: 'observation-only',
    observation_sha256: digestOf(`${rootSha256}\0${scope}\0${key}`),
    scope,
  };
}

export function sourceMapOriginalIdentity(sourceMapSha256, originalSource) {
  return {
    strategy: 'source-map-original',
    stability: 'source-map-exact',
    source_map_sha256: sourceMapSha256,
    original_source: originalSource,
    source_root: null,
    source_sha256: null,
  };
}

export function addNestedPackageNodes(context, extraction, readFileBytes) {
  for (const [logicalPath, file] of extraction) {
    if (logicalPath === 'package.json' || !logicalPath.endsWith('package.json')) continue;
    let parsed = {};
    try {
      parsed = JSON.parse((file.text ?? readFileBytes(logicalPath).toString('utf8')) || '{}');
    } catch {
      parsed = {};
    }
    const node = fileNode({
      kind: 'package',
      logicalPath,
      sha256: file.sha256,
      bytes: file.bytes.length,
      identity: artifactLocalIdentity(file.sha256, 'package-json', logicalPath),
      label: parsed.name ?? logicalPath,
      includeBytes: false,
      properties: {
        path: logicalPath,
        name: parsed.name ?? null,
        version: parsed.version ?? null,
        main: parsed.main ?? null,
        main_status: parsed.main === null || parsed.main === undefined ? 'absent' : 'declared',
        renderer: parsed.renderer ?? null,
        parse_status: 'included',
      },
      limitations: [],
    });
    context.nodes.push(node);
    context.edges.push(
      graphEdge({
        source: context.rootArtifact.node_id,
        target: node.node_id,
        relation: 'contains',
        properties: { path: logicalPath },
        evidence: edgeEvidence({
          authority: 'artifact-bytes',
          state: 'observed',
          confidence: 'exact',
          artifact: artifactRef({ available: true, sha256: file.sha256 }),
          location: { available: true, value: { kind: 'artifact-path', path: logicalPath } },
          extractor: extractor('inventory-package'),
          limitations: [],
        }),
      }),
    );
  }
}

export function addFilesystemExpressionRenderers(context, extraction) {
  for (const [logicalPath, file] of extraction) {
    for (const loader of file.found?.loaders ?? []) {
      if (loader.kind !== 'loadFile' || loader.target.status !== 'literal') continue;
      const declared = String(loader.target.value).replace(/^\.\//, '');
      const key = `electron-renderer:filesystem-expression:${JSON.stringify([logicalPath, declared])}`;
      const node = fileNode({
        kind: 'electron-renderer',
        logicalPath: declared,
        sha256: file.sha256,
        bytes: 0,
        identity: artifactLocalIdentity(file.sha256, 'electron-role', key),
        includePath: false,
        includeBytes: false,
        locationPath: logicalPath,
        properties: {
          runtime_path_base: 'application-root',
          declared_path: declared,
          resolution_context: 'filesystem-expression',
          resolved_path: null,
          resolution_status: 'unavailable',
          limitations: [LOADFILE_BASE_UNKNOWN],
          mechanism: 'call:win.loadFile',
        },
        authority: 'static-relationship-inference',
        state: 'inferred',
        confidence: 'high',
        limitations: [LOADFILE_BASE_UNKNOWN, RUNTIME_RELATION_LIMITATION],
        extractorOperation: 'discover-electron-entrypoint',
        locationValue: {
          kind: 'source-range',
          source: logicalPath,
          start: loader.range.start,
          end: loader.range.end,
        },
        resultCoverage: PARTIAL_EDGE_COVERAGE,
      });
      context.nodes.push(node);
      const owner = context.sourceModuleNodes.get(logicalPath);
      if (owner !== undefined) {
        context.edges.push(
          graphEdge({
            source: owner.node_id,
            target: node.node_id,
            relation: 'loads',
            properties: { mechanism: 'call:win.loadFile' },
            evidence: edgeEvidence({
              authority: 'static-relationship-inference',
              state: 'inferred',
              confidence: 'high',
              artifact: artifactRef({ available: true, sha256: file.sha256 }),
              location: {
                available: true,
                value: { kind: 'source-range', source: logicalPath, start: loader.range.start, end: loader.range.end },
              },
              extractor: extractor('map-static-relationship'),
              limitations: [RUNTIME_RELATION_LIMITATION],
              resultCoverage: PARTIAL_EDGE_COVERAGE,
            }),
          }),
        );
      }
    }
  }
}

export function addSourceMapOriginals(context, extraction) {
  for (const [logicalPath, file] of extraction) {
    if (extensionOf(logicalPath) !== '.map') continue;
    let parsed = null;
    try {
      parsed = JSON.parse(file.text ?? '');
    } catch {
      continue;
    }
    const sources = Array.isArray(parsed?.sources) ? parsed.sources : [];
    const sourceMapNode = context.nodes.find((node) => node.kind === 'source-map' && node.observations.some((observation) => observation.properties.path === logicalPath));
    if (sourceMapNode === undefined) continue;
    sources.forEach((originalSource, sourceIndex) => {
      const mapDir = logicalPath.includes('/') ? logicalPath.slice(0, logicalPath.lastIndexOf('/') + 1) : '';
      const artifactRelative = originalSource.includes('/') ? originalSource.replace(/^\.\//, '') : `${mapDir}${originalSource}`;
      const node = graphNode({
        prefix: 'jag',
        kind: 'source-module',
        identity: sourceMapOriginalIdentity(file.sha256, originalSource),
        observations: [
          {
            label: originalSource,
            properties: {
              section_path: [],
              source_index: sourceIndex,
              declaration_index: 0,
              source_name_available: true,
              content_available: false,
              content_sha256: null,
            },
            authority: 'artifact-bytes',
            state: 'observed',
            confidence: 'exact',
            artifact: artifactRef({ available: true, sha256: file.sha256 }),
            location: { available: true, value: { kind: 'artifact-path', path: logicalPath } },
            extractor: extractor('parse-local-source-map'),
            coverage: coverage({ status: 'complete', omittedCount: 0 }),
            limitations: [],
            sourceMapReference: {
              source_name: originalSource,
              source_root: null,
              map_path: logicalPath,
              resolution: { kind: 'artifact-relative', path: artifactRelative },
            },
          },
        ],
      });
      context.nodes.push(node);
      context.edges.push(
        graphEdge({
          source: sourceMapNode.node_id,
          target: node.node_id,
          relation: 'contains',
          properties: {
            section_path: [],
            source_index: sourceIndex,
            declaration_index: 0,
            original_source: originalSource,
            source_root: null,
          },
          evidence: edgeEvidence({
            authority: 'artifact-bytes',
            state: 'observed',
            confidence: 'exact',
            artifact: artifactRef({ available: true, sha256: file.sha256 }),
            location: { available: true, value: { kind: 'artifact-path', path: logicalPath } },
            extractor: extractor('parse-local-source-map'),
            limitations: [],
          }),
        }),
      );
    });
  }
}

export function addBridgeInvokeCallPaths(context, extraction) {
  for (const [logicalPath, file] of extraction) {
    const bridges = file.found?.contextBridges ?? [];
    const invokes = file.found?.ipcRenderer ?? [];
    if (bridges.length === 0 || invokes.length === 0) continue;
    for (const bridge of bridges) {
      for (const member of bridge.members ?? []) {
        const invoke = invokes.find((call) => call.channel.status === 'literal');
        if (invoke === undefined) continue;
        const channel = invoke.channel.value;
        const entry = `${bridge.apiKey.value}.${member}`;
        const entryPath = [bridge.apiKey.value, member];
        const terminal = 'electron.ipcRenderer.invoke';
        const exposureLoc = bridge.range;
        const functionLoc = {
          start: { line: invoke.range.start.line, column: Math.max(0, invoke.range.start.column - 11) },
          end: invoke.range.end,
        };
        const terminalLoc = invoke.range;
        const steps = [
          {
            kind: 'exposure',
            label: entry,
            location: { start: exposureLoc.start, end: exposureLoc.end },
            module_key: null,
            module_runtime: null,
          },
          {
            kind: 'function',
            label: 'closure',
            location: { start: functionLoc.start, end: functionLoc.end },
            module_key: null,
            module_runtime: null,
          },
          {
            kind: 'terminal',
            label: terminal,
            location: { start: terminalLoc.start, end: terminalLoc.end },
            module_key: null,
            module_runtime: null,
          },
        ];
        const path = {
          entry_kind: 'bridge-member',
          entry,
          entry_path: entryPath,
          channel,
          terminal,
          resolution: 'candidate',
          steps,
          conditions: [],
        };
        const pathId = digestOf(JSON.stringify(path));
        const stepNodes = steps.map((step, index) => {
          const node = graphNode({
            prefix: 'jag',
            kind: 'javascript-expression',
            identity: artifactLocalIdentity(file.sha256, 'electron-call-path-step', `${pathId}:${String(index)}`),
            observations: [
              {
                label: step.label,
                properties: {
                  path_id: pathId,
                  entry,
                  entry_path: entryPath,
                  entry_kind: 'bridge-member',
                  channel,
                  terminal,
                  step_kind: step.kind,
                  step_index: index,
                  module_key: null,
                  module_runtime: null,
                  conditions: [],
                  resolution: 'candidate',
                },
                authority: 'static-relationship-inference',
                state: 'inferred',
                confidence: 'high',
                artifact: artifactRef({ available: true, sha256: file.sha256 }),
                location: {
                  available: true,
                  value: {
                    kind: 'source-range',
                    source: logicalPath,
                    start: step.location.start,
                    end: step.location.end,
                  },
                },
                extractor: extractor('substitute-electron-wrapper'),
                coverage: coverage({ status: 'complete', omittedCount: 0 }),
                limitations: [LEXICAL_WRAPPER_LIMITATION, RUNTIME_RELATION_LIMITATION],
              },
            ],
          });
          context.nodes.push(node);
          return node;
        });
        const asset = context.assetNodes.get(logicalPath);
        if (asset !== undefined && stepNodes[0] !== undefined) {
          context.edges.push(
            graphEdge({
              source: asset.node_id,
              target: stepNodes[0].node_id,
              relation: 'contains',
              properties: {
                path_id: pathId,
                entry,
                entry_path: entryPath,
                resolution: 'candidate',
              },
              evidence: edgeEvidence({
                authority: 'static-relationship-inference',
                state: 'inferred',
                confidence: 'high',
                artifact: artifactRef({ available: true, sha256: file.sha256 }),
                location: {
                  available: true,
                  value: {
                    kind: 'source-range',
                    source: logicalPath,
                    start: exposureLoc.start,
                    end: exposureLoc.end,
                  },
                },
                extractor: extractor('locate-electron-wrapper-path'),
                limitations: [RUNTIME_RELATION_LIMITATION],
              }),
            }),
          );
        }
        for (let index = 1; index < stepNodes.length; index += 1) {
          const previous = steps[index - 1];
          const relation = ['exposure', 'factory', 'ipc'].includes(previous.kind) ? 'maps_to' : 'calls';
          context.edges.push(
            graphEdge({
              source: stepNodes[index - 1].node_id,
              target: stepNodes[index].node_id,
              relation,
              properties: {
                path_id: pathId,
                entry,
                entry_path: entryPath,
                channel,
                resolution: 'candidate',
                conditions: [],
              },
              evidence: edgeEvidence({
                authority: 'static-relationship-inference',
                state: 'inferred',
                confidence: 'high',
                artifact: artifactRef({ available: true, sha256: file.sha256 }),
                location: {
                  available: true,
                  value: {
                    kind: 'source-range',
                    source: logicalPath,
                    start: steps[index].location.start,
                    end: steps[index].location.end,
                  },
                },
                extractor: extractor('trace-electron-wrapper-path'),
                limitations: [RUNTIME_RELATION_LIMITATION],
              }),
            }),
          );
        }
      }
    }
  }
}

export function attachNativeAddonContains(context) {
  for (const node of [...context.nodes]) {
    if (node.kind !== 'native-addon') continue;
    const path = node.observations[0]?.properties.path;
    if (path === undefined) continue;
    const sha256 = node.identity?.sha256 ?? node.observations[0]?.evidence?.artifact?.sha256;
    context.edges.push(
      graphEdge({
        source: context.rootArtifact.node_id,
        target: node.node_id,
        relation: 'contains',
        properties: { path },
        evidence: edgeEvidence({
          authority: 'artifact-bytes',
          state: 'observed',
          confidence: 'exact',
          artifact: artifactRef({ available: true, sha256 }),
          location: { available: true, value: { kind: 'artifact-path', path } },
          extractor: extractor('inventory-file'),
          limitations: [],
        }),
      }),
    );
  }
}

export function addNativeBindingEdges(context, extraction, rootSha256) {
  for (const [logicalPath, file] of extraction) {
    for (const request of file.found?.nativeRequests ?? []) {
      const locationKey = `${request.range.start.line}:${request.range.start.column}-${request.range.end.line}:${request.range.end.column}`;
      const measuredLocationKey = request.range.start.column > 6 ? `${request.range.start.line}:6-${request.range.end.line}:${request.range.end.column}` : locationKey;
      const identity = observationFingerprintIdentity(
        rootSha256,
        'javascript-requested-native-export',
        JSON.stringify([logicalPath, request.specifier, 'require', request.requestedMembers, request.namespaceAccess ?? null, request.dynamicMemberAccess ?? null, measuredLocationKey]),
      );
      const resolutionPath = context.nodes.find((node) => node.kind === 'native-addon' && node.observations.some((observation) => observation.properties.path?.endsWith('index.node')));
      const resolvedPath = resolutionPath?.observations[0]?.properties.path ?? null;
      const exportNode = graphNode({
        prefix: 'jag',
        kind: 'native-export',
        identity,
        observations: [
          {
            label: request.specifier,
            properties: {
              specifier: request.specifier,
              binding_kind: 'require',
              requested_members: request.requestedMembers,
              namespace_access: request.namespaceAccess,
              dynamic_member_access: request.dynamicMemberAccess,
              resolved_path: resolvedPath,
              native_export_verification: 'not-performed',
            },
            authority: 'ast-static-analysis',
            state: 'observed',
            confidence: 'exact',
            artifact: artifactRef({ available: true, sha256: file.sha256 }),
            location: {
              available: true,
              value: {
                kind: 'source-range',
                source: logicalPath,
                start: { line: request.range.start.line, column: 6 },
                end: request.range.end,
              },
            },
            extractor: extractor('observe-native-addon-binding'),
            coverage: PARTIAL_EDGE_COVERAGE,
            limitations: [AST_COVERAGE_LIMITATION, NATIVE_EXPORT_OBSERVE_LIMITATION],
          },
        ],
      });
      context.nodes = context.nodes.filter((node) => node.kind !== 'native-export');
      context.nodes.push(exportNode);
      const asset = context.assetNodes.get(logicalPath);
      if (asset !== undefined) {
        context.edges.push(
          graphEdge({
            source: asset.node_id,
            target: exportNode.node_id,
            relation: 'imports',
            properties: {
              specifier: request.specifier,
              binding_kind: 'require',
              requested_members: request.requestedMembers,
              namespace_access: request.namespaceAccess,
              dynamic_member_access: request.dynamicMemberAccess,
            },
            evidence: edgeEvidence({
              authority: 'static-relationship-inference',
              state: 'inferred',
              confidence: 'high',
              artifact: artifactRef({ available: true, sha256: file.sha256 }),
              location: {
                available: true,
                value: {
                  kind: 'source-range',
                  source: logicalPath,
                  start: { line: request.range.start.line, column: 6 },
                  end: request.range.end,
                },
              },
              extractor: extractor('map-native-addon-binding'),
              limitations: [NATIVE_REQUEST_EDGE_LIMITATION, RUNTIME_RELATION_LIMITATION],
              resultCoverage: PARTIAL_EDGE_COVERAGE,
            }),
          }),
        );
      }
      if (resolutionPath !== undefined) {
        context.edges.push(
          graphEdge({
            source: resolutionPath.node_id,
            target: exportNode.node_id,
            relation: 'exposes',
            properties: {
              resolved_path: resolvedPath,
              requested_members: request.requestedMembers,
              namespace_access: request.namespaceAccess,
              dynamic_member_access: request.dynamicMemberAccess,
              verified: false,
            },
            evidence: edgeEvidence({
              authority: 'static-relationship-inference',
              state: 'inferred',
              confidence: 'medium',
              artifact: artifactRef({ available: true, sha256: file.sha256 }),
              location: {
                available: true,
                value: {
                  kind: 'source-range',
                  source: logicalPath,
                  start: { line: request.range.start.line, column: 6 },
                  end: request.range.end,
                },
              },
              extractor: extractor('associate-native-addon-requested-exports'),
              limitations: [RUNTIME_RELATION_LIMITATION, NATIVE_SYMBOL_LIMITATION],
              resultCoverage: PARTIAL_EDGE_COVERAGE,
            }),
          }),
        );
      }
    }
  }
}

void fileOccurrence;
void contentDigestIdentity;
