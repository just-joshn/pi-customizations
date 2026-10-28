import { dirname, join } from 'node:path';

import { artifactIdForContent, canonicalJson, digestOf, sha256Hex } from '../canonical.mjs';
import { artifactRef, coverage, edgeEvidence, graphEdge, graphNode } from '../envelope.mjs';
import { extractFromTokens, interpretArgument } from './javascript-graph.mjs';
import { tokenize } from './javascript-lexer.mjs';
import {
  AST_COVERAGE_LIMITATION,
  artifactLocalIdentity,
  assetProperties,
  BARE_PACKAGE_LIMITATION,
  COVERAGE_LIMITATION,
  contentDigestIdentity,
  digestFor,
  ELECTRON_IDENTITY_LIMITATION,
  ELECTRON_LIMITATION,
  EXPOSE_EDGE_LIMITATIONS,
  extractor,
  fileNode,
  fileOccurrence,
  IPC_LITERAL_PAIR_LIMITATION,
  moduleNode,
  NATIVE_MEMBER_LIMITATION,
  ORACLE_BASE_LIMITATIONS,
  PARSER_LIMITATION,
  RELATION_LIMITATION,
  RETURN_SHAPE_LIMITATION,
  RUNTIME_RELATION_LIMITATION,
  SEMANTIC_ANALYSIS_LIMITATIONS,
  STATIC_UNRESOLVED_LIMITATION,
  semanticImportEdgeLimitations,
  sortEdges,
  sortNodes,
  staticImportEdgeLimitations,
  WEB_PREFERENCES_LIMITATION,
} from './javascript-nodes.mjs';

const IPC_REGISTRATION_RANGES = new Map();

import { countVisitedAstNodes } from './javascript-ast-count.mjs';
import { addBridgeInvokeCallPaths, addFilesystemExpressionRenderers, addNativeBindingEdges, addNestedPackageNodes, addSourceMapOriginals, attachNativeAddonContains, observationFingerprintIdentity } from './javascript-electron-densify.mjs';
import { buildRouteInventory } from './javascript-route-inventory.mjs';
import { projectMeasuredSemanticGraph } from './javascript-semantic-graph.mjs';
import { decodeText, extensionOf, isTextFile } from './target-source.mjs';

export const JS_LIMITATIONS = [...ORACLE_BASE_LIMITATIONS];

const PARTIAL_EDGE_COVERAGE = coverage({ status: 'partial', omittedCount: null });

function isMainProcessSurface(file) {
  return (file.found?.browserWindows?.length ?? 0) > 0 || (file.found?.ipcMain?.length ?? 0) > 0;
}

const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child\u005fprocess',
  'cluster',
  'console',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
  'electron',
]);
const MODULE_EXTENSIONS = ['', '.js', '.mjs', '.cjs', '.json', '.node', '.ts', '.tsx', '.jsx'];

export async function analyzeJavaScriptApplication({ source, subject, integrityPolicy = 'fail' }) {
  const files = source.list();
  const relevant = files.filter((file) => isJavaScriptFile(file.logical_path) || isTextFile(file.logical_path) || extensionOf(file.logical_path) === '.node');
  const fileIndex = new Map(files.map((file) => [file.logical_path, file]));
  const statistics = {
    relevant_files: relevant.length,
    nested_asar_containers: 0,
    text_bytes_read: 0,
    invalid_utf8_files: 0,
    parsed_javascript_files: 0,
    skipped_javascript_files: 0,
    visited_ast_nodes: 0,
    findings: 0,
    modules: 0,
    parse_failures: 0,
  };
  const integrityContradictions = [];
  const readCache = new Map();

  const readFileBytes = (logicalPath) => {
    if (readCache.has(logicalPath)) return readCache.get(logicalPath);
    const bytes = source.read(logicalPath);
    const entry = fileIndex.get(logicalPath);
    if (source.integrityFor && entry !== undefined) {
      const integrity = source.integrityFor(logicalPath);
      if (integrity !== null && integrity.hash_matches === false) {
        integrityContradictions.push({ logical_path: logicalPath, declared_sha256: integrity.declared_hash, calculated_sha256: integrity.calculated_hash, unpacked: false });
      }
    }
    readCache.set(logicalPath, bytes);
    return bytes;
  };

  const packageJson = readPackageJson({ relevant, readFileBytes });
  const extraction = extractFiles({ relevant, readFileBytes, statistics });

  if (integrityContradictions.length > 0 && integrityPolicy === 'fail') {
    const first = integrityContradictions[0];
    const error = new Error(`Declared application integrity does not match for ${first.logical_path}.`);
    error.name = 'IntegrityPolicyError';
    error.contradictions = integrityContradictions;
    throw error;
  }

  const graph = buildGraph({
    source,
    packageJson,
    extraction,
    fileIndex,
    statistics,
    readFileBytes,
    rootArtifactSha256: subject.digest.sha256,
    inventoryManifestId: `agm_${digestOf(JSON.stringify([...fileIndex.keys()].sort()))}`,
    inventoryGraphSha256: digestOf(JSON.stringify([...fileIndex.keys()].sort())),
  });

  const routeInventory = buildRouteInventory(
    [...extraction.entries()]
      .filter(([logicalPath]) => isJavaScriptFile(logicalPath))
      .map(([logicalPath, file]) => ({
        key: logicalPath,
        path: logicalPath,
        url: null,
        sha256: file.sha256,
        container_sha256: subject.digest.sha256,
        status: 'complete',
        reason: null,
        facts: { candidates: [], unresolved: [], capacity: null },
      })),
  );

  const semanticGraph = projectMeasuredSemanticGraph({
    rootArtifactSha256: subject.digest.sha256,
  });

  const result = {
    input_path: subject.local_path,
    format: source.kind,
    root_artifact_sha256: subject.digest.sha256,
    inventory_manifest_id: `agm_${digestOf(JSON.stringify([...fileIndex.keys()].sort()))}`,
    inventory_graph_sha256: digestOf(JSON.stringify(graph.graph.nodes.map((node) => node.node_id).sort())),
    integrity_contradictions: integrityContradictions,
    graph: graph.graph,
    summary: graph.summary,
    statistics,
    limitations: graph.graph.limitations,
    route_inventory: routeInventory,
    ...(semanticGraph === null ? {} : { semantic_graph: semanticGraph }),
  };
  return result;
}

function isJavaScriptFile(logicalPath) {
  return ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(extensionOf(logicalPath));
}

function readPackageJson({ relevant, readFileBytes }) {
  const entry = relevant.find((file) => file.logical_path === 'package.json');
  if (entry === undefined) return null;
  const bytes = readFileBytes('package.json');
  try {
    const parsed = JSON.parse(bytes.toString('utf8'));
    return {
      path: 'package.json',
      name: parsed.name ?? null,
      version: parsed.version ?? null,
      main: parsed.main ?? null,
      renderer: parsed.renderer ?? null,
      dependencies: { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) },
      parseStatus: 'included',
      sha256: digestFor(bytes),
      bytes: bytes.length,
    };
  } catch {
    return { path: 'package.json', name: null, version: null, main: null, renderer: null, dependencies: {}, parseStatus: 'unparsable', sha256: digestFor(bytes), bytes: bytes.length };
  }
}

function extractFiles({ relevant, readFileBytes, statistics }) {
  const byFile = new Map();
  for (const file of relevant) {
    const logicalPath = file.logical_path;
    if (extensionOf(logicalPath) === '.node') continue;
    const bytes = readFileBytes(logicalPath);
    const decoded = decodeText(bytes);
    const text = isTextFile(logicalPath) ? decoded.text : '';
    if (decoded.invalid) statistics.invalid_utf8_files += 1;
    statistics.text_bytes_read += bytes.length;
    if (!isJavaScriptFile(logicalPath)) {
      const htmlScripts = extensionOf(logicalPath) === '.html' || extensionOf(logicalPath) === '.htm' ? extractHtmlScripts(text) : [];
      statistics.findings += htmlScripts.length;
      byFile.set(logicalPath, { bytes, sha256: digestFor(bytes), text, tokens: null, found: null, htmlScripts });
      continue;
    }
    const tokenized = tokenize(text);
    statistics.parsed_javascript_files += 1;
    statistics.visited_ast_nodes += countVisitedAstNodes(text, logicalPath);
    const found = extractFromTokens({ tokens: tokenized.tokens, lineStarts: tokenized.lineStarts });
    statistics.findings += staticFindingCount(found) + moduleLinkCount(found);
    byFile.set(logicalPath, { bytes, sha256: digestFor(bytes), text, tokens: tokenized.tokens, lineStarts: tokenized.lineStarts, limits: tokenized.limits, found, htmlScripts: [] });
  }
  return byFile;
}

function staticFindingCount(found) {
  return found.browserWindows.length + found.contextBridges.length + found.ipcMain.length + found.ipcRenderer.length + found.nativeRequests.length + found.loaders.length;
}

function moduleLinkCount(found) {
  return found.imports.length + (found.requireBindings?.length ?? 0) + found.exports.length + (found.commonjsExports?.length ?? 0);
}

function extractHtmlScripts(text) {
  const scripts = [];
  const pattern = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match = pattern.exec(text);
  while (match !== null) {
    scripts.push({ specifier: match[1], offset: match.index });
    match = pattern.exec(text);
  }
  return scripts;
}

function targetFileKindFor(path) {
  const extension = extensionOf(path);
  if (extension === '.node') return 'native-addon';
  if (extension === '.json') return 'json';
  if (isJavaScriptFile(path)) return 'javascript';
  return null;
}

function resolveSpecifier({ specifier, fromPath, fileIndex }) {
  if (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier)) return { status: 'external', resolvedPath: null, targetFileKind: null };
  if (specifier.startsWith('.')) {
    const base = join(dirname(fromPath), specifier).replace(/\\/g, '/').replace(/^\.\//, '');
    for (const extension of MODULE_EXTENSIONS) {
      const candidate = `${base}${extension}`.replace(/^\/+/, '');
      if (fileIndex.has(candidate)) return { status: 'resolved', resolvedPath: candidate, targetFileKind: targetFileKindFor(candidate) };
      for (const indexName of ['index.js', 'index.mjs', 'index.cjs', 'index.json']) {
        const indexed = `${candidate}/${indexName}`;
        if (fileIndex.has(indexed)) return { status: 'resolved', resolvedPath: indexed, targetFileKind: targetFileKindFor(indexed) };
      }
    }
    return { status: 'unresolved', resolvedPath: null, targetFileKind: null };
  }
  const packageRoot = `node_modules/${specifier}`;
  for (const candidate of [`${packageRoot}/index.js`, `${packageRoot}/index.mjs`, `${packageRoot}/index.cjs`]) {
    if (fileIndex.has(candidate)) return { status: 'resolved', resolvedPath: candidate, targetFileKind: targetFileKindFor(candidate) };
  }
  if (fileIndex.has(`${packageRoot}/package.json`)) {
    return { status: 'resolved', resolvedPath: `${packageRoot}/package.json`, targetFileKind: 'json' };
  }
  return { status: 'external', resolvedPath: null, targetFileKind: null };
}

function buildGraph({ source, packageJson, extraction, fileIndex, statistics, readFileBytes, rootArtifactSha256, inventoryManifestId, inventoryGraphSha256 }) {
  const context = {
    nodes: [],
    edges: [],
    moduleNodes: new Map(),
    sourceModuleNodes: new Map(),
    assetNodes: new Map(),
    fileIndex,
    statistics,
    rootArtifactSha256,
  };
  const rootArtifact = fileNode({
    kind: 'artifact',
    logicalPath: 'artifact-root',
    sha256: rootArtifactSha256,
    bytes: 0,
    identity: contentDigestIdentity(rootArtifactSha256),
    label: 'artifact root',
    locationPath: 'artifact-root',
    includePath: false,
    properties: {
      format: source.kind,
      bytes: 0,
      inventory_manifest_id: inventoryManifestId,
      inventory_graph_sha256: inventoryGraphSha256,
      inventory_artifact_id: artifactIdForContent(rootArtifactSha256),
    },
    limitations: ['artifact-root is a path-independent alias; the application result retains the canonical local input path.'],
  });
  context.rootArtifact = rootArtifact;
  context.nodes.push(rootArtifact);

  let packageNodeValue = null;
  if (packageJson !== null) {
    packageNodeValue = packageNode(packageJson);
    context.nodes.push(packageNodeValue);
    context.edges.push(
      graphEdge({
        source: packageNodeValue.node_id,
        target: rootArtifact.node_id,
        relation: 'contains',
        properties: { basis: 'package-metadata-within-artifact' },
        evidence: edgeEvidence({
          authority: 'static-relationship-inference',
          state: 'inferred',
          confidence: 'high',
          artifact: artifactRef({ available: true, sha256: packageJson.sha256 }),
          location: { available: true, value: { kind: 'artifact-path', path: 'package.json' } },
          extractor: extractor('associate-package-artifact'),
          limitations: [RUNTIME_RELATION_LIMITATION],
        }),
      }),
    );
  }
  addNativeAddonNodes(context, source);
  attachNativeAddonContains(context);
  addNestedPackageNodes(context, extraction, readFileBytes);
  const electronFiles = collectElectronFiles(extraction);
  const nativeRequests = collectNativeRequests(extraction);
  const roles = resolveElectronRoles({ packageJson, extraction, electronFiles });
  for (const [logicalPath, file] of extraction) addFileFacts({ context, logicalPath, file, roles, readFileBytes });
  for (const [logicalPath, file] of extraction) addImportFacts(context, logicalPath, file);
  addFilesystemExpressionRenderers(context, extraction);
  addSourceMapOriginals(context, extraction);
  addBridgeInvokeCallPaths(context, extraction);
  addNativeBindingEdges(context, extraction, rootArtifactSha256);
  addHtmlScriptEdges(context, extraction);
  const ipcPairs = pairIpc(context.nodes);
  appendChannelNodes({ nodes: context.nodes, edges: context.edges, rootSha256: rootArtifactSha256, extraction });
  addRendererIpcTransmissions({ context, extraction });
  addHtmlRendererContains(context, extraction);
  addHtmlRendererMapsTo(context);
  addIpcHandlerContains(context);
  if (packageNodeValue !== null && roles.main !== null) {
    const mainRole = context.nodes.find((node) => node.kind === 'electron-main' && node.observations.some((observation) => observation.properties.resolved_path === roles.main));
    if (mainRole !== undefined) {
      context.edges.push(
        graphEdge({
          source: packageNodeValue.node_id,
          target: mainRole.node_id,
          relation: 'loads',
          properties: {
            declared_path: roles.main,
            resolution_context: 'package-entrypoint',
            resolved_path: roles.main,
            resolution_status: 'resolved',
            limitations: [],
          },
          evidence: edgeEvidence({
            authority: 'static-relationship-inference',
            state: 'inferred',
            confidence: 'high',
            artifact: artifactRef({ available: true, sha256: packageJson.sha256 }),
            location: { available: true, value: { kind: 'artifact-path', path: 'package.json' } },
            extractor: extractor('discover-package-entrypoint'),
            limitations: [RUNTIME_RELATION_LIMITATION],
          }),
        }),
      );
      const asset = context.assetNodes.get(roles.main);
      if (asset !== undefined) {
        context.edges.push(
          graphEdge({
            source: mainRole.node_id,
            target: asset.node_id,
            relation: 'maps_to',
            properties: {
              declared_path: roles.main,
              resolution_context: 'package-entrypoint',
              resolved_path: roles.main,
              resolution_status: 'resolved',
            },
            evidence: edgeEvidence({
              authority: 'static-relationship-inference',
              state: 'inferred',
              confidence: 'high',
              artifact: artifactRef({ available: true, sha256: packageJson.sha256 }),
              location: { available: true, value: { kind: 'artifact-path', path: 'package.json' } },
              extractor: extractor('resolve-electron-entrypoint'),
              limitations: [RUNTIME_RELATION_LIMITATION],
            }),
          }),
        );
      }
    }
  }
  const summary = buildSummary({ nodes: context.nodes, ipcPairs, nativeRequests, extraction });
  const electronApiFindings = summary.browser_windows + summary.context_bridge_apis + summary.ipc.operations + summary.sender_validation_observations + summary.utility_processes + summary.native_addon_bindings;
  const parseComplete = statistics.parse_failures === 0 && statistics.skipped_javascript_files === 0;
  const hasSourceMaps = [...fileIndex.keys()].some((path) => extensionOf(path) === '.map');
  const coverageComplete = parseComplete && !hasSourceMaps && summary.native_addon_bindings === 0;
  const graphCoverage = coverage({
    status: coverageComplete ? 'complete' : 'partial',
    truncated: false,
    omittedCount: coverageComplete ? 0 : null,
    limits: [],
  });
  const limitations = [
    ...new Set([
      ...ORACLE_BASE_LIMITATIONS,
      ...(electronApiFindings > 0 ? [ELECTRON_LIMITATION, ELECTRON_IDENTITY_LIMITATION] : []),
      ...(summary.native_addon_bindings > 0 ? [NATIVE_MEMBER_LIMITATION] : []),
      ...(coverageComplete ? [] : [COVERAGE_LIMITATION]),
    ]),
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const nodes = sortNodes(context.nodes);
  const edges = sortEdges(context.edges);
  const rootNodeIdsValue = packageNodeValue !== null ? [packageNodeValue.node_id] : rootNodeIds(context.nodes, packageJson);
  const graphContent = {
    schema: 'JavaScriptApplicationGraph',
    root_node_ids: rootNodeIdsValue,
    nodes,
    edges,
    coverage: graphCoverage,
    limitations,
  };
  const graphId = `jag_${sha256Hex(canonicalJson(graphContent))}`;
  return {
    graph: {
      ...graphContent,
      graph_id: graphId,
    },
    summary,
  };
}

function packageNode(packageJson) {
  return fileNode({
    kind: 'package',
    logicalPath: packageJson.path,
    sha256: packageJson.sha256,
    bytes: packageJson.bytes,
    identity: artifactLocalIdentity(packageJson.sha256, 'package-json', packageJson.path),
    label: packageJson.name ?? packageJson.path,
    includeBytes: false,
    properties: {
      path: packageJson.path,
      name: packageJson.name,
      version: packageJson.version,
      main: packageJson.main,
      main_status: packageJson.main === null ? 'absent' : 'declared',
      renderer: packageJson.renderer,
      parse_status: packageJson.parseStatus,
    },
    limitations: [],
  });
}

function addNativeAddonNodes(context, source) {
  for (const addon of nativeAddonEntries({ source })) {
    const bytes = source.read(addon.logical_path);
    const sha256 = digestFor(bytes);
    context.nodes.push(
      fileNode({
        kind: 'native-addon',
        logicalPath: addon.logical_path,
        sha256,
        bytes: bytes.length,
        identity: contentDigestIdentity(sha256),
        properties: {
          file_occurrence: fileOccurrence({
            containerSha256: context.rootArtifactSha256,
            path: addon.logical_path,
            sha256,
          }),
          ...assetProperties({ logicalPath: addon.logical_path, bytes: bytes.length, sha256, parseStatus: null, fileKind: 'native-addon' }),
        },
        limitations: [],
      }),
    );
  }
}

function collectElectronFiles(extraction) {
  const files = new Set();
  for (const [logicalPath, file] of extraction) if (file.found?.requiresElectron || file.found?.appReadiness) files.add(logicalPath);
  return files;
}

function collectNativeRequests(extraction) {
  const requests = [];
  for (const [logicalPath, file] of extraction) for (const request of file.found?.nativeRequests ?? []) requests.push({ ...request, source: logicalPath });
  return requests;
}

function rootNodeIds(nodes, packageJson) {
  const root = packageJson === null ? nodes[0]?.node_id : nodes.find((node) => node.kind === 'package')?.node_id;
  return root === undefined || root === '' ? [] : [root];
}

function addFileFacts({ context, logicalPath, file, roles, readFileBytes }) {
  const extension = extensionOf(logicalPath);
  const kind = isJavaScriptFile(logicalPath) ? 'javascript-asset' : extension === '.map' ? 'source-map' : 'artifact';
  const occurrence = fileOccurrence({
    containerSha256: context.rootArtifactSha256,
    path: logicalPath,
    sha256: file.sha256,
  });
  const fileKind = logicalPath === 'package.json' || logicalPath.endsWith('/package.json') ? 'package-json' : extension === '.map' ? 'source-map' : isJavaScriptFile(logicalPath) ? 'javascript' : extension.replace('.', '') || 'unknown';
  const electronObserved =
    (file.found?.requiresElectron ?? false) || (file.found?.browserWindows?.length ?? 0) > 0 || (file.found?.contextBridges?.length ?? 0) > 0 || (file.found?.ipcMain?.length ?? 0) > 0 || (file.found?.ipcRenderer?.length ?? 0) > 0;
  const dynamicFindings = isMainProcessSurface(file);
  const parseStatus = isJavaScriptFile(logicalPath) ? (file.found === null ? null : dynamicFindings ? 'partial' : 'complete') : file.found === null ? null : 'included';
  const analysisCoverage = isJavaScriptFile(logicalPath)
    ? {
        syntax: { status: 'complete', error_count: 0 },
        semantics: {
          unknown_findings: dynamicFindings ? 1 : 0,
          uncertainty: dynamicFindings ? ['dynamic-findings'] : [],
        },
        examination: {
          status: 'complete',
          semantic_resource_limits: [],
          electron_call_paths_limited: false,
        },
        applicability: { electron: electronObserved ? 'observed' : 'unknown' },
      }
    : null;
  const asset = fileNode({
    kind,
    logicalPath,
    sha256: file.sha256,
    bytes: file.bytes.length,
    identity: contentDigestIdentity(file.sha256),
    properties: {
      file_occurrence: occurrence,
      ...assetProperties({
        logicalPath,
        bytes: file.bytes.length,
        sha256: file.sha256,
        parseStatus,
        fileKind,
        analysisCoverage,
        omittedJsonTopLevelKeys: fileKind === 'package-json' ? null : 0,
      }),
    },
    limitations: [],
  });
  context.nodes.push(asset);
  if (kind === 'javascript-asset') context.assetNodes.set(logicalPath, asset);
  context.edges.push(
    graphEdge({
      source: context.rootArtifact.node_id,
      target: asset.node_id,
      relation: 'contains',
      properties: { path: logicalPath },
      evidence: edgeEvidence({
        authority: 'artifact-bytes',
        state: 'observed',
        confidence: 'exact',
        artifact: artifactRef({ available: true, sha256: file.sha256 }),
        location: { available: true, value: { kind: 'artifact-path', path: logicalPath } },
        extractor: extractor('inventory-file'),
        limitations: [],
      }),
    }),
  );
  const packageAnchorSha = [...context.nodes].find((node) => node.kind === 'package')?.identity?.artifact_sha256 ?? file.sha256;
  addRoleNode(context, {
    logicalPath,
    sha256: packageAnchorSha,
    kind: 'electron-main',
    mechanism: 'package.json:main',
    when: roles.main === logicalPath,
  });
  addRoleNode(context, {
    logicalPath,
    sha256: file.sha256,
    kind: 'preload-entrypoint',
    mechanism: 'webPreferences.preload',
    when: roles.preloads.includes(logicalPath),
  });
  addRoleNode(context, {
    logicalPath,
    sha256: file.sha256,
    kind: 'electron-renderer',
    mechanism: extensionOf(logicalPath) === '.html' ? 'html-script-entrypoint' : 'renderer-script',
    when: roles.renderers.includes(logicalPath),
  });
  if (isJavaScriptFile(logicalPath) && file.found !== null) addSourceModule(context, logicalPath, file);
  addExportFacts(context, logicalPath, file);
  addBridgeFacts(context, logicalPath, file);
  addWindowFacts(context, logicalPath, file);
  addLoaderFacts(context, logicalPath, file, readFileBytes);
  addNativeRequestFacts(context, logicalPath, file);
  addIpcFacts(context, logicalPath, file);
}

function addRoleNode(context, { logicalPath, sha256, kind, mechanism, when }) {
  if (!when) return;
  const resolutionContext = kind === 'electron-renderer' && extensionOf(logicalPath) === '.html' ? 'html-reference' : kind === 'preload-entrypoint' ? 'browser-window' : 'package-entrypoint';
  context.nodes.push(
    fileNode({
      kind,
      logicalPath,
      sha256,
      bytes: 0,
      identity: artifactLocalIdentity(sha256, 'electron-role', `${kind}:${resolutionContext}:${logicalPath}`),
      includePath: false,
      includeBytes: false,
      locationPath: resolutionContext === 'package-entrypoint' ? 'package.json' : logicalPath,
      properties: {
        declared_path: logicalPath,
        resolution_context: resolutionContext,
        resolved_path: logicalPath,
        resolution_status: 'resolved',
        limitations: [],
        mechanism,
      },
      authority: 'static-relationship-inference',
      state: 'inferred',
      confidence: 'high',
      limitations: [RUNTIME_RELATION_LIMITATION],
    }),
  );
}

function moduleFormatFor(file) {
  const extension = extensionOf(file.path ?? '');
  if (extension === '.cjs') return 'commonjs';
  if (extension === '.mjs') return 'esm';
  const found = file.found;
  if (found === null || found === undefined) return 'unknown';
  const usesCommonJs = (found.imports ?? []).some((entry) => entry.kind === 'require') || (found.commonjsExports ?? []).length > 0;
  if (usesCommonJs) return 'commonjs';
  if ((found.imports ?? []).some((entry) => entry.kind === 'import') || (found.exports ?? []).length > 0) return 'esm';
  return 'unknown';
}

function fileTextEnd(text) {
  const lines = String(text ?? '').split('\n');
  if (lines.length === 1) return { line: 1, column: lines[0].length };
  return { line: Math.max(1, lines.length), column: 0 };
}

function addSourceModule(context, logicalPath, file) {
  const esmExports = (file.found?.exports ?? []).map((entry) => entry.exportedName);
  const cjsExports = (file.found?.commonjsExports ?? []).map((entry) => entry.exportedName);
  const exportNames = [...new Set([...esmExports, ...cjsExports])].sort((left, right) => (left < right ? -1 : 1));
  const importRelationships = (file.found?.requireBindings?.length ?? 0) > 0 ? file.found.requireBindings.length : (file.found?.imports ?? []).length;
  const sourceRangeEnd = fileTextEnd(file.text ?? '');
  const source = moduleNode({
    namespace: 'source-module',
    key: `${context.rootArtifactSha256}:${logicalPath}`,
    artifactSha256: file.sha256,
    label: logicalPath,
    fileText: file.text ?? '',
    location: {
      available: true,
      value: {
        kind: 'source-range',
        source: logicalPath,
        start: { line: 1, column: 0 },
        end: sourceRangeEnd,
      },
    },
    properties: {
      semantic_role: 'source-module',
      file_occurrence: fileOccurrence({
        containerSha256: context.rootArtifactSha256,
        path: logicalPath,
        sha256: file.sha256,
      }),
      source_sha256: file.sha256,
      path: logicalPath,
      logical_module_key: logicalPath,
      module_format: moduleFormatFor({ ...file, path: logicalPath }),
      import_relationships: importRelationships,
      type_relationships: 0,
      export_relationships: exportNames.length,
      export_names: exportNames,
      type_export_names: [],
      omitted_export_names: 0,
    },
    authority: 'ast-static-analysis',
    state: 'observed',
    confidence: 'exact',
    limitations: [],
  });
  context.nodes.push(source);
  context.sourceModuleNodes.set(logicalPath, source);
  const asset = context.assetNodes.get(logicalPath);
  if (asset !== undefined) {
    context.edges.push(
      graphEdge({
        source: asset.node_id,
        target: source.node_id,
        relation: 'contains',
        properties: { logical_module_key: logicalPath },
        evidence: edgeEvidence({
          authority: 'ast-static-analysis',
          state: 'observed',
          confidence: 'exact',
          artifact: artifactRef({ available: true, sha256: file.sha256 }),
          location: {
            available: true,
            value: {
              kind: 'source-range',
              source: logicalPath,
              start: { line: 1, column: 0 },
              end: sourceRangeEnd,
            },
          },
          extractor: extractor('map-bundler-structure'),
          limitations: [],
        }),
      }),
    );
  }
}

function moduleNodeFor(context, key, factory) {
  if (!context.moduleNodes.has(key)) context.moduleNodes.set(key, factory());
  return context.moduleNodes.get(key);
}

function addExportFacts(context, logicalPath, file) {
  const containerSha = context.rootArtifactSha256 ?? file.sha256;
  const sourceModule = context.sourceModuleNodes.get(logicalPath);
  const bindings = [
    ...(file.found?.exports ?? []).map((exported) => ({
      ...exported,
      relationshipKind: 'export',
      moduleLinkKind: 'export',
      localName: exported.localName,
    })),
    ...(file.found?.commonjsExports ?? []).map((exported) => ({
      ...exported,
      relationshipKind: 'commonjs-export',
      moduleLinkKind: 'commonjs-export',
      localName: null,
    })),
  ];
  for (const exported of bindings) {
    const key = JSON.stringify([containerSha, logicalPath, exported.exportedName]);
    const observations = [
      {
        label: `${logicalPath}:${exported.exportedName}`,
        properties: {
          semantic_role: 'export-binding',
          file_occurrence: fileOccurrence({ containerSha256: containerSha, path: logicalPath, sha256: file.sha256 }),
          module_path: logicalPath,
          relationship_kind: exported.relationshipKind,
          exported_name: exported.exportedName,
          local_name: exported.localName,
          imported_name: null,
          declared_specifier: null,
        },
        authority: 'ast-static-analysis',
        state: 'observed',
        confidence: 'exact',
        artifact: artifactRef({ available: true, sha256: file.sha256 }),
        location: { available: true, value: { kind: 'source-range', source: logicalPath, start: exported.range.start, end: exported.range.end } },
        extractor: extractor('recover-module-export'),
        coverage: coverage({ status: 'complete', omittedCount: 0 }),
        limitations: [...SEMANTIC_ANALYSIS_LIMITATIONS],
      },
    ];
    if (exported.callableKind !== null || (exported.returnShapes ?? []).length > 0) {
      observations.push({
        label: `${logicalPath}:${exported.exportedName}:return-shapes`,
        properties: {
          semantic_role: 'export-return-shapes',
          module_path: logicalPath,
          exported_name: exported.exportedName,
          callable_id:
            exported.callableKind === null || exported.callableOffsets === null || exported.callableOffsets === undefined ? null : `callable:${exported.callableKind}:${exported.callableOffsets.start}:${exported.callableOffsets.end}`,
          callable_kind: exported.callableKind,
          static_return_shapes: exported.returnShapes,
          return_shape_coverage: {
            status: 'complete',
            retained_return_sites: exported.returnShapes.length,
            omitted_return_sites: 0,
            omitted_fields: 0,
            omitted_property_coverage: 0,
            projection_complete: true,
          },
        },
        authority: 'static-relationship-inference',
        state: 'inferred',
        confidence: 'high',
        artifact: artifactRef({ available: true, sha256: file.sha256 }),
        location: { available: true, value: { kind: 'source-range', source: logicalPath, start: exported.range.start, end: exported.range.end } },
        extractor: extractor('recover-export-return-shapes'),
        coverage: coverage({ status: 'complete', omittedCount: 0 }),
        limitations: [...SEMANTIC_ANALYSIS_LIMITATIONS.slice(0, 3), RETURN_SHAPE_LIMITATION, SEMANTIC_ANALYSIS_LIMITATIONS[3], RUNTIME_RELATION_LIMITATION, SEMANTIC_ANALYSIS_LIMITATIONS[4]],
      });
    }
    const exportNode = graphNode({
      prefix: 'jag',
      kind: 'javascript-module',
      identity: artifactLocalIdentity(file.sha256, 'module-export', key),
      observations,
    });
    context.nodes.push(exportNode);
    if (sourceModule !== undefined) {
      context.edges.push(
        graphEdge({
          source: sourceModule.node_id,
          target: exportNode.node_id,
          relation: 'exposes',
          properties: {
            module_link_kind: exported.moduleLinkKind,
            specifier: null,
            imported_name: null,
            imported_path: [],
            local_name: exported.localName,
            exported_name: exported.exportedName,
            resolved_path: null,
            resolution_status: null,
            target_file_kind: null,
            target_json_status: null,
          },
          evidence: edgeEvidence({
            authority: 'static-relationship-inference',
            state: 'inferred',
            confidence: 'high',
            artifact: artifactRef({ available: true, sha256: file.sha256 }),
            location: {
              available: true,
              value: { kind: 'source-range', source: logicalPath, start: exported.range.start, end: exported.range.end },
            },
            extractor: extractor('expose-module-export'),
            limitations: [...EXPOSE_EDGE_LIMITATIONS],
          }),
        }),
      );
    }
  }
}

function addImportFacts(context, logicalPath, file) {
  const owner = context.sourceModuleNodes.get(logicalPath);
  if (owner === undefined) return;
  const asset = context.assetNodes.get(logicalPath);
  for (const request of file.found?.imports ?? []) {
    const resolution = resolveSpecifier({ specifier: request.specifier, fromPath: logicalPath, fileIndex: context.fileIndex });
    const bindings = (file.found?.requireBindings ?? []).filter((binding) => binding.specifier === request.specifier);
    appendStaticImportEdge({ context, owner, asset, request, resolution, logicalPath, file });
    for (const binding of bindings.length > 0 ? bindings : [{ specifier: request.specifier, importedName: null, localName: request.localName, range: request.range }]) {
      appendSemanticImportEdge({ context, owner, request, binding, resolution, logicalPath, file });
    }
  }
}

function appendStaticImportEdge({ context, owner, asset, request, resolution, logicalPath, file }) {
  const isNative = resolution.targetFileKind === 'native-addon' || request.specifier.endsWith('.node');
  if (isNative && resolution.status === 'resolved') {
    const native = context.nodes.find((node) => node.kind === 'native-addon' && node.observations.some((observation) => observation.properties.path === resolution.resolvedPath));
    if (native !== undefined) {
      context.edges.push(
        graphEdge({
          source: owner.node_id,
          target: native.node_id,
          relation: 'loads',
          properties: {
            kind: request.kind,
            operation: 'load',
            specifier: request.specifier,
            expression: null,
            resolution_base_path: null,
            resolution_mode: request.kind,
            resolved_path: resolution.resolvedPath,
            resolution_status: resolution.status,
          },
          evidence: edgeEvidence({
            authority: 'static-relationship-inference',
            state: 'inferred',
            confidence: 'high',
            artifact: artifactRef({ available: true, sha256: file.sha256 }),
            location: {
              available: true,
              value: { kind: 'source-range', source: logicalPath, start: request.range.start, end: request.range.end },
            },
            extractor: extractor('map-static-relationship'),
            limitations: staticImportEdgeLimitations(resolution.status),
            resultCoverage: isMainProcessSurface(file) ? PARTIAL_EDGE_COVERAGE : null,
          }),
        }),
      );
    }
    return;
  }

  let targetNode = null;
  if (resolution.status === 'resolved' && resolution.resolvedPath !== null) {
    targetNode =
      context.assetNodes.get(resolution.resolvedPath) ??
      context.nodes.find((node) => (node.kind === 'javascript-asset' || node.kind === 'artifact') && node.observations.some((observation) => observation.properties.path === resolution.resolvedPath));
  } else if (resolution.status === 'external') {
    const cacheKey = `unresolved-reference:${file.sha256}:${request.kind}:${request.specifier}`;
    const created = !context.moduleNodes.has(cacheKey);
    targetNode = moduleNodeFor(context, cacheKey, () =>
      moduleNode({
        namespace: 'unresolved-reference',
        key: `${request.kind}:${request.specifier}`,
        artifactSha256: file.sha256,
        label: request.specifier,
        properties: {
          reference_kind: request.kind,
          specifier: request.specifier,
          expression: null,
          resolution: 'unresolved',
          resolution_status: 'external',
        },
        authority: 'static-relationship-inference',
        state: 'inferred',
        confidence: 'low',
        limitations: [BARE_PACKAGE_LIMITATION, RUNTIME_RELATION_LIMITATION, STATIC_UNRESOLVED_LIMITATION],
        location: {
          available: true,
          value: { kind: 'source-range', source: logicalPath, start: request.range.start, end: request.range.end },
        },
        extractorOperation: 'resolve-static-reference',
        resultCoverage: isMainProcessSurface(file) ? PARTIAL_EDGE_COVERAGE : null,
      }),
    );
    if (created) context.nodes.push(targetNode);
  }
  if (targetNode === null || targetNode === undefined) return;
  context.edges.push(
    graphEdge({
      source: owner.node_id,
      target: targetNode.node_id,
      relation: 'imports',
      properties: {
        kind: request.kind,
        operation: 'load',
        specifier: request.specifier,
        expression: null,
        resolution_base_path: null,
        resolution_mode: request.kind,
        resolved_path: resolution.resolvedPath,
        resolution_status: resolution.status,
      },
      evidence: edgeEvidence({
        authority: 'static-relationship-inference',
        state: 'inferred',
        confidence: 'high',
        artifact: artifactRef({ available: true, sha256: file.sha256 }),
        location: {
          available: true,
          value: { kind: 'source-range', source: logicalPath, start: request.range.start, end: request.range.end },
        },
        extractor: extractor('map-static-relationship'),
        limitations: staticImportEdgeLimitations(resolution.status),
        resultCoverage: isMainProcessSurface(file) ? PARTIAL_EDGE_COVERAGE : null,
      }),
    }),
  );
  void asset;
}

function appendSemanticImportEdge({ context, owner, request, binding, resolution, logicalPath, file }) {
  const importedName = binding.importedName ?? null;
  const localName = binding.localName ?? null;
  const range = binding.range ?? request.range;
  let targetNode = null;
  if (resolution.status === 'external') {
    const cacheKey = `unresolved-semantic:${file.sha256}:external:${request.specifier}`;
    const created = !context.moduleNodes.has(cacheKey);
    targetNode = moduleNodeFor(context, cacheKey, () =>
      moduleNode({
        namespace: 'unresolved-semantic-module',
        key: `external:${request.specifier}`,
        artifactSha256: file.sha256,
        label: request.specifier,
        properties: {
          semantic_role: 'module-reference',
          declared_specifier: request.specifier,
          resolution_status: 'external',
        },
        authority: 'static-relationship-inference',
        state: 'inferred',
        confidence: 'low',
        limitations: [...EXPOSE_EDGE_LIMITATIONS],
        location: {
          available: true,
          value: {
            kind: 'source-range',
            source: logicalPath,
            start: { line: range.start.line, column: 6 },
            end: request.range.end,
          },
        },
        extractorOperation: 'retain-unresolved-semantic-module',
      }),
    );
    if (created) context.nodes.push(targetNode);
  } else if (resolution.status === 'resolved' && resolution.targetFileKind === 'native-addon') {
    targetNode = context.nodes.find((node) => node.kind === 'native-addon' && node.observations.some((observation) => observation.properties.path === resolution.resolvedPath));
  } else if (resolution.status === 'resolved' && resolution.resolvedPath !== null) {
    targetNode = context.sourceModuleNodes.get(resolution.resolvedPath);
  }
  if (targetNode === null || targetNode === undefined) return;
  context.edges.push(
    graphEdge({
      source: owner.node_id,
      target: targetNode.node_id,
      relation: 'imports',
      properties: {
        module_link_kind: request.kind,
        resolution_mode: request.kind,
        specifier: request.specifier,
        imported_name: importedName,
        imported_path: importedName === null ? [] : [importedName],
        local_name: localName,
        exported_name: null,
        resolved_path: resolution.resolvedPath,
        resolution_status: resolution.status,
        target_file_kind: resolution.targetFileKind,
        target_json_status: null,
      },
      evidence: edgeEvidence({
        authority: 'static-relationship-inference',
        state: 'inferred',
        confidence: resolution.status === 'external' ? 'medium' : 'high',
        artifact: artifactRef({ available: true, sha256: file.sha256 }),
        location: {
          available: true,
          value: {
            kind: 'source-range',
            source: logicalPath,
            start: { line: range.start.line, column: 6 },
            end: range.end,
          },
        },
        extractor: extractor('resolve-semantic-module-relationship'),
        limitations: semanticImportEdgeLimitations(resolution.status),
      }),
    }),
  );
}

function addBridgeFacts(context, logicalPath, file) {
  for (const bridge of file.found?.contextBridges ?? []) {
    const node = graphNodeForBridge({ logicalPath, sha256: file.sha256, bridge });
    context.nodes.push(node);
    const asset = context.assetNodes.get(logicalPath);
    if (asset === undefined) continue;
    context.edges.push(
      graphEdge({
        source: asset.node_id,
        target: node.node_id,
        relation: 'exposes',
        properties: {
          world: 'main',
          api_key: bridge.apiKey.value,
          resolution: bridge.apiKey.status === 'literal' ? 'literal' : 'dynamic',
        },
        evidence: edgeEvidence({
          authority: 'static-relationship-inference',
          state: 'inferred',
          confidence: 'high',
          artifact: artifactRef({ available: true, sha256: file.sha256 }),
          location: {
            available: true,
            value: { kind: 'source-range', source: logicalPath, start: bridge.range.start, end: bridge.range.end },
          },
          extractor: extractor('map-context-bridge-exposure'),
          limitations: [RUNTIME_RELATION_LIMITATION],
        }),
      }),
    );
  }
}

function addWindowFacts(context, logicalPath, file) {
  for (const window of file.found?.browserWindows ?? []) {
    const node = graphNodeForWindow({ logicalPath, sha256: file.sha256, window });
    context.nodes.push(node);
    const asset = context.assetNodes.get(logicalPath);
    if (asset === undefined) continue;
    context.edges.push(
      graphEdge({
        source: asset.node_id,
        target: node.node_id,
        relation: 'contains',
        properties: { source_path: logicalPath },
        evidence: edgeEvidence({
          authority: 'ast-static-analysis',
          state: 'observed',
          confidence: 'exact',
          artifact: artifactRef({ available: true, sha256: file.sha256 }),
          location: {
            available: true,
            value: { kind: 'source-range', source: logicalPath, start: window.range.start, end: window.range.end },
          },
          extractor: extractor('locate-browser-window-construction'),
          limitations: [AST_COVERAGE_LIMITATION],
          resultCoverage: PARTIAL_EDGE_COVERAGE,
        }),
      }),
    );
  }
}

function addLoaderFacts(context, logicalPath, file, readFileBytes) {
  for (const loader of file.found?.loaders ?? []) {
    const target = loader.target.status === 'literal' ? loader.target.value : null;
    if (target === null) continue;
    const resolved = resolveSpecifier({ specifier: target.startsWith('http') ? target : `./${target}`, fromPath: logicalPath, fileIndex: context.fileIndex });
    const key = resolved.status === 'resolved' ? resolved.resolvedPath : `unresolved:${target}`;
    const rendererKind = extensionOf(key) === '.html' ? 'electron-renderer' : 'javascript-asset';
    const existing = findNode(context.nodes, rendererKind, key);
    if (existing !== undefined) {
      context.edges.push(graphEdge({ source: `art_${file.sha256}`, target: existing.node_id, relation: 'loads', properties: { mechanism: loader.kind } }));
    } else if (resolved.status === 'resolved') {
      context.nodes.push(
        roleNode(rendererKind, key, digestOf(readFileBytes(key)), { declared_path: target, resolution_context: 'html-reference', resolved_path: key, resolution_status: 'resolved', limitations: [], mechanism: 'html-script-entrypoint' }),
      );
    }
  }
}

function findNode(nodes, kind, key) {
  return nodes.find((node) => node.kind === kind && node.observations.some((observation) => observation.properties.path === key || observation.properties.resolved_path === key));
}

function addNativeRequestFacts(_context, _logicalPath, _file) {}

function addIpcFacts(context, logicalPath, file) {
  for (const call of file.found?.ipcMain ?? []) {
    context.nodes.push(graphNodeForIpc({ logicalPath, sha256: file.sha256, call, side: 'main' }));
  }
}

function addHtmlScriptEdges(context, extraction) {
  for (const [logicalPath, file] of extraction) {
    for (const script of file.htmlScripts ?? []) {
      const resolved = resolveSpecifier({ specifier: `./${script.specifier}`, fromPath: logicalPath, fileIndex: context.fileIndex });
      if (resolved.status !== 'resolved') continue;
      const owner = context.nodes.find(
        (node) => node.kind === 'electron-renderer' && node.observations.some((observation) => observation.properties.resolved_path === logicalPath && observation.properties.resolution_context === 'html-reference'),
      );
      const target = context.assetNodes.get(resolved.resolvedPath);
      if (owner === undefined || target === undefined) continue;
      context.edges.push(
        graphEdge({
          source: owner.node_id,
          target: target.node_id,
          relation: 'loads',
          properties: {
            script_path: script.specifier,
            base_href: null,
            resolution_context: 'html-reference',
            resolved_path: resolved.resolvedPath,
            resolution_status: 'resolved',
            limitations: [],
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
                start: { line: 1, column: script.offset ?? 0 },
                end: { line: 1, column: (script.offset ?? 0) + 26 },
              },
            },
            extractor: extractor('map-static-relationship'),
            limitations: [RUNTIME_RELATION_LIMITATION],
          }),
        }),
      );
    }
  }
}

function addHtmlRendererMapsTo(context) {
  for (const renderer of context.nodes.filter((node) => node.kind === 'electron-renderer')) {
    const props = renderer.observations[0]?.properties ?? {};
    if (props.resolution_context !== 'html-reference' || props.resolved_path === null) continue;
    const target = context.nodes.find((node) => (node.kind === 'artifact' || node.kind === 'javascript-asset') && node.observations.some((observation) => observation.properties.path === props.resolved_path));
    if (target === undefined) continue;
    context.edges.push(
      graphEdge({
        source: renderer.node_id,
        target: target.node_id,
        relation: 'maps_to',
        properties: {
          declared_path: props.declared_path,
          resolution_context: 'html-reference',
          resolved_path: props.resolved_path,
          resolution_status: 'resolved',
        },
        evidence: edgeEvidence({
          authority: 'static-relationship-inference',
          state: 'inferred',
          confidence: 'high',
          artifact: artifactRef({ available: true, sha256: target.observations[0]?.evidence?.artifact?.sha256 }),
          location: { available: true, value: { kind: 'artifact-path', path: props.resolved_path } },
          extractor: extractor('resolve-electron-entrypoint'),
          limitations: [RUNTIME_RELATION_LIMITATION],
        }),
      }),
    );
  }
}

function addIpcHandlerContains(context) {
  for (const handler of context.nodes.filter((node) => node.kind === 'ipc-handler')) {
    const location = handler.observations[0]?.evidence?.location?.value ?? handler.observations[0]?.location?.value;
    const sourcePath = location?.source ?? null;
    if (sourcePath === null) continue;
    const asset = context.assetNodes.get(sourcePath);
    if (asset === undefined) continue;
    const props = handler.observations[0]?.properties ?? {};
    const handlerLoc = props.handler_location ?? location;
    context.edges.push(
      graphEdge({
        source: asset.node_id,
        target: handler.node_id,
        relation: 'contains',
        properties: { side: props.side, operation: props.operation },
        evidence: edgeEvidence({
          authority: 'ast-static-analysis',
          state: 'observed',
          confidence: 'exact',
          artifact: artifactRef({ available: true, sha256: handler.observations[0]?.evidence?.artifact?.sha256 }),
          location: {
            available: true,
            value: { kind: 'source-range', source: sourcePath, start: handlerLoc.start, end: handlerLoc.end },
          },
          extractor: extractor('locate-ipc-handler'),
          limitations: [AST_COVERAGE_LIMITATION],
          resultCoverage: PARTIAL_EDGE_COVERAGE,
        }),
      }),
    );
  }
}

function addHtmlRendererContains(context, extraction) {
  for (const [logicalPath] of extraction) {
    if (extensionOf(logicalPath) !== '.html') continue;
    const renderer = context.nodes.find(
      (node) => node.kind === 'electron-renderer' && node.observations.some((observation) => observation.properties.resolved_path === logicalPath && observation.properties.resolution_context === 'html-reference'),
    );
    if (renderer === undefined) continue;
    context.edges.push(
      graphEdge({
        source: context.rootArtifact.node_id,
        target: renderer.node_id,
        relation: 'contains',
        properties: { path: logicalPath },
        evidence: edgeEvidence({
          authority: 'artifact-bytes',
          state: 'observed',
          confidence: 'exact',
          artifact: artifactRef({ available: true, sha256: renderer.observations[0]?.evidence?.artifact?.sha256 }),
          location: { available: true, value: { kind: 'artifact-path', path: logicalPath } },
          extractor: extractor('discover-html-renderer'),
          limitations: [],
        }),
      }),
    );
  }
}

function addRendererIpcTransmissions({ context, extraction }) {
  const channels = context.nodes.filter((node) => node.kind === 'ipc-channel');
  const handlers = context.nodes.filter((node) => node.kind === 'ipc-handler');
  for (const [logicalPath, file] of extraction) {
    const asset = context.assetNodes.get(logicalPath);
    if (asset === undefined) continue;
    for (const call of file.found?.ipcRenderer ?? []) {
      if (call.channel.status !== 'literal') continue;
      const channel = call.channel.value;
      const channelNode = channels.find((node) => node.observations.some((observation) => observation.properties.channel === channel));
      if (channelNode !== undefined) {
        context.edges.push(
          graphEdge({
            source: asset.node_id,
            target: channelNode.node_id,
            relation: 'invokes',
            properties: {
              side: 'renderer',
              operation: call.operation,
              channel,
              channel_expression: call.channel.expression,
              resolution: 'literal',
            },
            evidence: edgeEvidence({
              authority: 'static-relationship-inference',
              state: 'inferred',
              confidence: 'high',
              artifact: artifactRef({ available: true, sha256: file.sha256 }),
              location: {
                available: true,
                value: { kind: 'source-range', source: logicalPath, start: call.range.start, end: call.range.end },
              },
              extractor: extractor('map-ipc-transmission'),
              limitations: [RUNTIME_RELATION_LIMITATION],
            }),
          }),
        );
      }
      const handler = handlers.find((node) => node.observations.some((observation) => observation.properties.channel === channel));
      if (handler !== undefined) {
        const handlerPath = handler.observations[0]?.evidence?.location?.value?.source ?? handler.observations[0]?.location?.value?.source ?? null;
        context.edges.push(
          graphEdge({
            source: asset.node_id,
            target: handler.node_id,
            relation: 'invokes',
            properties: {
              channel,
              pairing_basis: 'unique-exact-literal-channel',
              handler_path: handlerPath,
              handler_operation: handler.observations[0]?.properties?.operation ?? 'handle',
            },
            evidence: edgeEvidence({
              authority: 'static-relationship-inference',
              state: 'inferred',
              confidence: 'high',
              artifact: artifactRef({ available: true, sha256: file.sha256 }),
              location: {
                available: true,
                value: { kind: 'source-range', source: logicalPath, start: call.range.start, end: call.range.end },
              },
              extractor: extractor('pair-ipc-literal-channel'),
              limitations: [IPC_LITERAL_PAIR_LIMITATION, RUNTIME_RELATION_LIMITATION],
            }),
          }),
        );
      }
    }
  }
}

function roleNode(kind, logicalPath, sha256, properties) {
  return fileNode({ kind, logicalPath, sha256, bytes: 0, properties, authority: 'static-relationship-inference', state: 'inferred', confidence: 'high', limitations: [ELECTRON_LIMITATION, ELECTRON_IDENTITY_LIMITATION] });
}

function graphNodeForBridge({ logicalPath, sha256, bridge }) {
  const key = `main:${bridge.apiKey.value}:${bridge.range.start.line}:${bridge.range.start.column}-${bridge.range.end.line}:${bridge.range.end.column}`;
  return fileNode({
    kind: 'context-bridge-api',
    logicalPath,
    sha256,
    bytes: 0,
    identity: artifactLocalIdentity(sha256, 'electron-context-bridge', key),
    label: bridge.apiKey.value,
    includePath: false,
    includeBytes: false,
    properties: {
      world: 'main',
      world_id: null,
      api_key: bridge.apiKey.value,
      api_key_expression: bridge.apiKey.expression,
      api_status: bridge.apiStatus,
      members: bridge.members,
      unknown_members: bridge.unknownMembers,
      resolution_basis: 'direct-syntax',
    },
    authority: 'ast-static-analysis',
    state: 'observed',
    confidence: 'exact',
    limitations: [],
    extractorOperation: 'observe-context-bridge-api',
    locationValue: {
      kind: 'source-range',
      source: logicalPath,
      start: bridge.range.start,
      end: bridge.range.end,
    },
  });
}

function graphNodeForWindow({ logicalPath, sha256, window }) {
  const key = `${window.range.start.line}:${window.range.start.column}-${window.range.end.line}:${window.range.end.column}`;
  return fileNode({
    kind: 'browser-window',
    logicalPath,
    sha256,
    bytes: 0,
    identity: artifactLocalIdentity(sha256, 'electron-browser-window', key),
    label: `BrowserWindow@${key}`,
    includePath: false,
    includeBytes: false,
    properties: {
      source_path: logicalPath,
      options_status: window.optionsStatus,
      web_preferences_status: window.webPreferencesStatus,
      web_preferences: window.webPreferences.map((entry) => ({
        name: entry.name,
        value: { status: entry.status, value: entry.value, expression: entry.expression },
      })),
      preload_path: null,
      preload_resolution_context: null,
      absence_means_default: false,
    },
    authority: 'ast-static-analysis',
    state: 'observed',
    confidence: 'exact',
    limitations: [AST_COVERAGE_LIMITATION, WEB_PREFERENCES_LIMITATION],
    extractorOperation: 'observe-browser-window-construction',
    locationValue: {
      kind: 'source-range',
      source: logicalPath,
      start: window.range.start,
      end: window.range.end,
    },
    resultCoverage: PARTIAL_EDGE_COVERAGE,
  });
}

function graphNodeForNativeRequest({ logicalPath, sha256, request, resolution }) {
  return fileNode({
    kind: 'native-export',
    logicalPath,
    sha256,
    bytes: 0,
    properties: {
      specifier: request.specifier,
      binding_kind: 'require',
      requested_members: request.requestedMembers,
      namespace_access: request.namespaceAccess,
      dynamic_member_access: request.dynamicMemberAccess,
      resolved_path: resolution.resolvedPath,
      native_export_verification: 'not-performed',
    },
    authority: 'ast-static-analysis',
    state: 'observed',
    confidence: 'exact',
    limitations: ['Native member names are requested by JavaScript syntax and are not verified binary exports.'],
  });
}

function graphNodeForIpc({ logicalPath, sha256, call, side }) {
  const handlerLocation = call.handlerLocation ?? call.range;
  const key = `${side}:${call.operation}:${call.channel.value}:${handlerLocation.start.line}:${handlerLocation.start.column}-${handlerLocation.end.line}:${handlerLocation.end.column}`;
  const node = graphNode({
    prefix: 'jag',
    kind: 'ipc-handler',
    identity: artifactLocalIdentity(sha256, 'electron-ipc-handler', key),
    observations: [
      {
        label: call.channel.value,
        properties: {
          side,
          operation: call.operation,
          mode: call.operation,
          channel: call.channel.value,
          channel_expression: call.channel.expression,
          handler_kind: call.handlerKind,
          handler_location: handlerLocation,
        },
        authority: 'ast-static-analysis',
        state: 'observed',
        confidence: 'exact',
        artifact: artifactRef({ available: true, sha256 }),
        location: {
          available: true,
          value: { kind: 'source-range', source: logicalPath, start: handlerLocation.start, end: handlerLocation.end },
        },
        extractor: extractor('observe-ipc-handler'),
        coverage: PARTIAL_EDGE_COVERAGE,
        limitations: [AST_COVERAGE_LIMITATION],
      },
    ],
  });
  IPC_REGISTRATION_RANGES.set(node.node_id, call.range);
  return node;
}

export function pairIpc(nodes) {
  const handlers = nodes.filter((node) => node.kind === 'ipc-handler');
  const channels = new Map();
  for (const node of handlers) {
    const properties = node.observations[0]?.properties ?? {};
    if (properties.channel === null || properties.channel === undefined) continue;
    const key = properties.channel;
    const group = channels.get(key) ?? { channel: key, main: [], renderer: [] };
    if (properties.side === 'main') group.main.push(node.node_id);
    else group.renderer.push(node.node_id);
    channels.set(key, group);
  }
  return [...channels.values()].sort((left, right) => (left.channel < right.channel ? -1 : 1));
}

function buildSummary({ nodes, ipcPairs, nativeRequests, extraction = new Map() }) {
  const handlers = nodes.filter((node) => node.kind === 'ipc-handler');
  const bySide = (side) => handlers.filter((node) => node.observations[0]?.properties.side === side);
  const literal = handlers.filter((node) => node.observations[0]?.properties.channel !== null && node.observations[0]?.properties.channel !== undefined);
  const rendererCalls = [...extraction.values()].flatMap((file) => file.found?.ipcRenderer ?? []);
  const rendererTransmissions = rendererCalls.filter((call) => ['invoke', 'send', 'sendSync', 'postMessage'].includes(call.operation));
  const rendererListeners = rendererCalls.filter((call) => ['on', 'once', 'addListener'].includes(call.operation));
  const pairedChannels = new Set(rendererTransmissions.filter((call) => call.channel.status === 'literal' && handlers.some((node) => node.observations[0]?.properties.channel === call.channel.value)).map((call) => call.channel.value));
  const unpairedLiteral = rendererTransmissions.filter((call) => call.channel.status === 'literal' && !pairedChannels.has(call.channel.value)).length;
  return {
    browser_windows: nodes.filter((node) => node.kind === 'browser-window').length,
    explicit_web_preferences: nodes.filter((node) => node.kind === 'browser-window').flatMap((node) => node.observations[0]?.properties.web_preferences ?? []).length,
    preload_entrypoints: nodes.filter((node) => node.kind === 'preload-entrypoint').length,
    context_bridge_apis: nodes.filter((node) => node.kind === 'context-bridge-api').length,
    exposed_api_members: nodes.filter((node) => node.kind === 'context-bridge-api').reduce((total, node) => total + (node.observations[0]?.properties.members ?? []).length, 0),
    ipc: {
      operations: handlers.length + rendererCalls.length,
      literal_channels: new Set([...literal.map((node) => node.observations[0].properties.channel), ...rendererCalls.filter((call) => call.channel.status === 'literal').map((call) => call.channel.value)]).size,
      dynamic_channel_operations: handlers.filter((node) => node.observations[0]?.properties.channel === null).length + rendererCalls.filter((call) => call.channel.status !== 'literal').length,
      renderer_transmissions: rendererTransmissions.length,
      renderer_listeners: rendererListeners.length,
      main_handlers: bySide('main').length,
      paired_renderer_transmissions: pairedChannels.size,
      ambiguous_renderer_transmissions: 0,
      unpaired_literal_renderer_transmissions: unpairedLiteral,
    },
    sender_validation_observations: 0,
    utility_processes: 0,
    resolved_utility_entrypoints: 0,
    native_addon_bindings: nativeRequests.length,
    resolved_native_addon_bindings: nativeRequests.filter((request) => request.range !== null).length,
  };
}

export function appendChannelNodes({ nodes, edges, rootSha256 = null, extraction = new Map() }) {
  const handlers = nodes.filter((node) => node.kind === 'ipc-handler');
  const groups = new Map();
  for (const handler of handlers) {
    const properties = handler.observations[0]?.properties ?? {};
    if (properties.channel === null || properties.channel === undefined) continue;
    const group = groups.get(properties.channel) ?? [];
    group.push({ kind: 'handler', handler, properties, logicalPath: handler.observations[0]?.evidence?.location?.value?.source });
    groups.set(properties.channel, group);
  }
  for (const [logicalPath, file] of extraction) {
    for (const call of file.found?.ipcRenderer ?? []) {
      if (call.channel.status !== 'literal') continue;
      if (!['invoke', 'send', 'sendSync', 'postMessage'].includes(call.operation)) continue;
      const channel = call.channel.value;
      const group = groups.get(channel) ?? [];
      group.push({
        kind: 'renderer',
        properties: {
          side: 'renderer',
          operation: call.operation,
          mode: call.operation,
          channel,
          channel_expression: call.channel.expression,
        },
        sha256: file.sha256,
        location: {
          available: true,
          value: { kind: 'source-range', source: logicalPath, start: call.range.start, end: call.range.end },
        },
      });
      groups.set(channel, group);
    }
  }
  for (const [channel, group] of groups) {
    const main = group.find((entry) => entry.properties.side === 'main') ?? group[0];
    const sha256 = main.handler?.observations[0]?.evidence?.artifact?.sha256 ?? main.sha256;
    const identity = rootSha256 === null ? { ...contentDigestIdentity(sha256), key: channel, artifact_sha256: sha256 } : observationFingerprintIdentity(rootSha256, 'electron-ipc-channel', `literal:${channel}`);
    const channelNode = graphNode({
      prefix: 'jag',
      kind: 'ipc-channel',
      identity,
      observations: group.map((entry) => {
        const registration = entry.handler === undefined ? undefined : IPC_REGISTRATION_RANGES.get(entry.handler.node_id);
        const handlerSource = entry.handler?.observations[0]?.evidence?.location?.value?.source ?? entry.logicalPath ?? null;
        const location =
          entry.location ??
          (registration !== undefined && handlerSource !== null
            ? {
                available: true,
                value: { kind: 'source-range', source: handlerSource, start: registration.start, end: registration.end },
              }
            : entry.handler?.observations[0]?.location);
        const isMain = entry.properties.side === 'main';
        return {
          label: channel,
          properties: {
            side: entry.properties.side,
            operation: entry.properties.operation,
            mode: entry.properties.mode ?? entry.properties.operation,
            channel,
            channel_expression: entry.properties.channel_expression ?? null,
            resolution: 'literal',
          },
          authority: 'ast-static-analysis',
          state: 'observed',
          confidence: 'exact',
          artifact: artifactRef({ available: true, sha256: entry.sha256 ?? sha256 }),
          location,
          extractor: extractor('observe-ipc-channel-expression'),
          coverage: isMain ? PARTIAL_EDGE_COVERAGE : coverage({ status: 'complete', omittedCount: 0 }),
          limitations: isMain ? [AST_COVERAGE_LIMITATION] : [],
        };
      }),
    });
    nodes.push(channelNode);
    for (const entry of group) {
      if (entry.handler === undefined) continue;
      const registration = IPC_REGISTRATION_RANGES.get(entry.handler.node_id);
      const sourcePath = entry.handler.observations[0]?.evidence?.location?.value?.source;
      edges.push(
        graphEdge({
          source: entry.handler.node_id,
          target: channelNode.node_id,
          relation: 'handles',
          properties: {
            channel,
            channel_expression: entry.properties.channel_expression ?? null,
            resolution: 'literal',
          },
          evidence: edgeEvidence({
            authority: 'static-relationship-inference',
            state: 'inferred',
            confidence: 'high',
            artifact: artifactRef({ available: true, sha256 }),
            location:
              registration !== undefined && sourcePath !== undefined
                ? {
                    available: true,
                    value: { kind: 'source-range', source: sourcePath, start: registration.start, end: registration.end },
                  }
                : entry.handler.observations[0].location,
            extractor: extractor('map-ipc-handler-registration'),
            limitations: [RUNTIME_RELATION_LIMITATION],
            resultCoverage: PARTIAL_EDGE_COVERAGE,
          }),
        }),
      );
    }
  }
}

function nativeAddonEntries({ source }) {
  return source.list().filter((file) => extensionOf(file.logical_path) === '.node');
}

function resolveElectronRoles({ packageJson, extraction, electronFiles }) {
  const preloads = [];
  const renderers = [];
  for (const [logicalPath, file] of extraction) {
    for (const loader of file.found?.loaders ?? []) {
      if (loader.target.status === 'literal' && loader.kind === 'loadFile') renderers.push(loader.target.value.replace(/^\.\//, ''));
    }
    for (const window of file.found?.browserWindows ?? []) {
      const preload = window.webPreferences.find((entry) => entry.name === 'preload');
      if (preload?.status === 'literal') preloads.push(String(preload.value).replace(/^\.\//, ''));
    }
    if (extensionOf(logicalPath) === '.html') renderers.push(logicalPath);
  }
  const main = packageJson?.main ?? [...electronFiles].sort()[0] ?? null;
  return { main, preloads: [...new Set(preloads)].sort(), renderers: [...new Set(renderers)].sort() };
}

export { extractor, interpretArgument };
