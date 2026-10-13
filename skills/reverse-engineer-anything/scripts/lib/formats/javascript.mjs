import { dirname, join } from 'node:path';

import { digestOf } from '../canonical.mjs';
import { coverage, graphEdge } from '../envelope.mjs';
import { extractFromTokens, interpretArgument } from './javascript-graph.mjs';
import { tokenize } from './javascript-lexer.mjs';
import {
  assetProperties,
  COVERAGE_LIMITATION,
  digestFor,
  ELECTRON_IDENTITY_LIMITATION,
  ELECTRON_LIMITATION,
  extractor,
  fileNode,
  importsEdge,
  moduleNode,
  PARSER_LIMITATION,
  RELATION_LIMITATION,
  STATIC_LIMITATION,
  sortEdges,
  sortNodes,
} from './javascript-nodes.mjs';
import { decodeText, extensionOf, isTextFile } from './target-source.mjs';

export const UNCOMPUTED_SUMMARY_LIMITATION =
  'Utility-process forks, IPC sender validation and ambiguous renderer transmissions are not detected by this port; those summary fields are reported as 0 because no observation supports them here, not because the target lacks them.';

export const JS_LIMITATIONS = [
  STATIC_LIMITATION,
  RELATION_LIMITATION,
  ELECTRON_LIMITATION,
  ELECTRON_IDENTITY_LIMITATION,
  COVERAGE_LIMITATION,
  PARSER_LIMITATION,
  UNCOMPUTED_SUMMARY_LIMITATION,
  'Native member names are requested by JavaScript syntax and are not verified binary exports in this workflow.',
];

const NODE_BUILTINS = new Set([
  'assert',
  'buffer',
  'child_process',
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

/** Analyze an extracted JavaScript/Electron tree or ASAR without executing any of it. */
export async function analyzeJavaScriptApplication({ source, subject, integrityPolicy = 'fail' }) {
  const files = source.list();
  const relevant = files.filter((file) => isJavaScriptFile(file.logical_path) || isTextFile(file.logical_path) || extensionOf(file.logical_path) === '.node');
  const fileIndex = new Map(files.map((file) => [file.logical_path, file]));
  const statistics = { relevant_files: relevant.length, nested_asar_containers: 0, text_bytes_read: 0, invalid_utf8_files: 0, parsed_javascript_files: 0, visited_ast_nodes: 0, findings: 0, modules: 0, parse_failures: 0 };
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

  const graph = buildGraph({ source, packageJson, extraction, fileIndex, statistics, readFileBytes });

  const result = {
    input_path: subject.local_path,
    format: source.kind,
    root_artifact_sha256: subject.digest.sha256,
    inventory_manifest_id: `agm_${digestOf(JSON.stringify([...fileIndex.keys()].sort()))}`,
    inventory_graph_sha256: digestOf(JSON.stringify(graph.nodes.map((node) => node.node_id).sort())),
    integrity_contradictions: integrityContradictions,
    graph,
    summary: graph.summary,
    statistics,
    limitations: JS_LIMITATIONS,
  };
  return result;
}

function isJavaScriptFile(logicalPath) {
  return ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(extensionOf(logicalPath));
}

/** package.json is read once, by extractFiles; this only interprets the text. */
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
      byFile.set(logicalPath, { bytes, sha256: digestFor(bytes), text, tokens: null, found: null, htmlScripts: extensionOf(logicalPath) === '.html' || extensionOf(logicalPath) === '.htm' ? extractHtmlScripts(text) : [] });
      continue;
    }
    const tokenized = tokenize(text);
    statistics.parsed_javascript_files += 1;
    statistics.visited_ast_nodes += tokenized.tokens.length;
    const found = extractFromTokens({ tokens: tokenized.tokens, lineStarts: tokenized.lineStarts });
    byFile.set(logicalPath, { bytes, sha256: digestFor(bytes), text, tokens: tokenized.tokens, lineStarts: tokenized.lineStarts, limits: tokenized.limits, found, htmlScripts: [] });
  }
  return byFile;
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

function resolveSpecifier({ specifier, fromPath, fileIndex }) {
  if (specifier.startsWith('node:') || NODE_BUILTINS.has(specifier)) return { status: 'external', resolvedPath: null, targetFileKind: null };
  if (specifier.startsWith('.')) {
    const base = join(dirname(fromPath), specifier).replace(/\\/g, '/').replace(/^\.\//, '');
    for (const extension of MODULE_EXTENSIONS) {
      const candidate = `${base}${extension}`.replace(/^\/+/, '');
      if (fileIndex.has(candidate)) return { status: 'resolved', resolvedPath: candidate, targetFileKind: extensionOf(candidate) === '.node' ? 'native-addon' : 'module' };
      for (const indexName of ['index.js', 'index.mjs', 'index.cjs', 'index.json']) {
        const indexed = `${candidate}/${indexName}`;
        if (fileIndex.has(indexed)) return { status: 'resolved', resolvedPath: indexed, targetFileKind: 'module' };
      }
    }
    return { status: 'unresolved', resolvedPath: null, targetFileKind: null };
  }
  const packageRoot = `node_modules/${specifier}`;
  for (const candidate of [`${packageRoot}/package.json`, `${packageRoot}/index.js`, `${packageRoot}/index.mjs`]) {
    if (fileIndex.has(candidate)) return { status: 'resolved', resolvedPath: candidate, targetFileKind: extensionOf(candidate) === '.json' ? 'json' : 'module' };
  }
  return { status: 'external', resolvedPath: null, targetFileKind: null };
}

function buildGraph({ source, packageJson, extraction, fileIndex, statistics, readFileBytes }) {
  const context = { nodes: [], edges: [], moduleNodes: new Map(), fileIndex, statistics };
  if (packageJson !== null) context.nodes.push(packageNode(packageJson));
  addNativeAddonNodes(context, source);
  const electronFiles = collectElectronFiles(extraction);
  const nativeRequests = collectNativeRequests(extraction);
  const roles = resolveElectronRoles({ packageJson, extraction, electronFiles });
  for (const [logicalPath, file] of extraction) addFileFacts({ context, logicalPath, file, roles, readFileBytes });
  addHtmlScriptEdges(context, extraction);
  const ipcPairs = pairIpc(context.nodes);
  appendChannelNodes({ nodes: context.nodes, edges: context.edges });
  statistics.findings = context.nodes.reduce((total, node) => total + node.observations.length, 0);
  const summary = buildSummary({ nodes: context.nodes, edges: context.edges, packageJson, roles, ipcPairs, electronFiles, nativeRequests });
  return {
    schema: 'JavaScriptApplicationGraph',
    root_node_ids: rootNodeIds(context.nodes, packageJson),
    nodes: sortNodes(context.nodes),
    edges: sortEdges(context.edges),
    coverage: coverage({ status: 'partial', truncated: false, omittedCount: null, limits: [] }),
    limitations: [COVERAGE_LIMITATION],
    summary,
    graph_id: `jag_${digestOf(JSON.stringify(context.nodes.map((node) => node.node_id).sort()))}`,
  };
}

function packageNode(packageJson) {
  return fileNode({
    kind: 'package',
    logicalPath: packageJson.path,
    sha256: packageJson.sha256,
    bytes: packageJson.bytes,
    properties: { name: packageJson.name, version: packageJson.version, main: packageJson.main, renderer: packageJson.renderer, parse_status: packageJson.parseStatus },
    limitations: [PARSER_LIMITATION],
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
        properties: assetProperties({ logicalPath: addon.logical_path, bytes: bytes.length, sha256, parseStatus: null, fileKind: 'native-addon' }),
        limitations: ['The add-on was inventoried from its bytes; its exported symbols were not resolved here.'],
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
  context.nodes.push(
    fileNode({
      kind: isJavaScriptFile(logicalPath) ? 'javascript-asset' : extension === '.map' ? 'source-map' : 'artifact',
      logicalPath,
      sha256: file.sha256,
      bytes: file.bytes.length,
      properties: assetProperties({ logicalPath, bytes: file.bytes.length, sha256: file.sha256, parseStatus: file.found === null ? null : 'included', fileKind: extension.replace('.', '') || 'unknown' }),
      limitations: [PARSER_LIMITATION],
    }),
  );
  addRoleNode(context, { roles, logicalPath, sha256: file.sha256, kind: 'electron-main', context: 'package-entrypoint', mechanism: 'package.json:main', when: roles.main === logicalPath });
  addRoleNode(context, { roles, logicalPath, sha256: file.sha256, kind: 'preload-entrypoint', context: 'browser-window', mechanism: 'webPreferences.preload', when: roles.preloads.includes(logicalPath) });
  addRoleNode(context, {
    roles,
    logicalPath,
    sha256: file.sha256,
    kind: 'electron-renderer',
    context: context.fileIndex.has(logicalPath) ? 'html-reference' : 'declared',
    mechanism: extensionOf(logicalPath) === '.html' ? 'html-script-entrypoint' : 'renderer-script',
    when: roles.renderers.includes(logicalPath),
  });
  addImportFacts(context, logicalPath, file);
  addBridgeFacts(context, logicalPath, file);
  addWindowFacts(context, logicalPath, file);
  addLoaderFacts(context, logicalPath, file, readFileBytes);
  addNativeRequestFacts(context, logicalPath, file);
  addIpcFacts(context, logicalPath, file);
}

function addRoleNode(context, { logicalPath, sha256, kind, mechanism, when }) {
  if (!when) return;
  context.nodes.push(
    roleNode(kind, logicalPath, sha256, {
      declared_path: logicalPath,
      resolution_context: kind === 'electron-renderer' && extensionOf(logicalPath) === '.html' ? 'html-reference' : kind === 'preload-entrypoint' ? 'browser-window' : 'package-entrypoint',
      resolved_path: logicalPath,
      resolution_status: 'resolved',
      limitations: [],
      mechanism,
    }),
  );
}

function moduleNodeFor(context, key, factory) {
  if (!context.moduleNodes.has(key)) context.moduleNodes.set(key, factory());
  return context.moduleNodes.get(key);
}

function addImportFacts(context, logicalPath, file) {
  for (const request of file.found?.imports ?? []) {
    const resolution = resolveSpecifier({ specifier: request.specifier, fromPath: logicalPath, fileIndex: context.fileIndex });
    const prefix = resolution.status === 'resolved' ? 'module' : resolution.status === 'external' ? 'external' : 'unresolved';
    const key = `${prefix}:${resolution.status === 'resolved' ? resolution.resolvedPath : request.specifier}`;
    const target = moduleNodeFor(context, key, () =>
      moduleNode({
        namespace: resolution.status === 'resolved' ? 'resolved-semantic-module' : resolution.status === 'external' ? 'external-semantic-module' : 'unresolved-semantic-module',
        key: key.replace(/^[a-z]+:/, ''),
        artifactSha256: file.sha256,
        label: request.specifier,
        properties: { semantic_role: 'module-reference', declared_specifier: request.specifier, resolution_status: resolution.status },
        authority: resolution.status === 'resolved' ? 'ast-static-analysis' : 'static-relationship-inference',
        state: resolution.status === 'resolved' ? 'observed' : 'inferred',
        confidence: resolution.status === 'resolved' ? 'exact' : 'low',
        limitations: resolution.status === 'resolved' ? [] : ['The specifier was not resolved inside the inventoried artifact container.'],
      }),
    );
    const owner = moduleNodeFor(context, `file:${logicalPath}`, () =>
      moduleNode({
        namespace: 'source-file-module',
        key: logicalPath,
        artifactSha256: file.sha256,
        label: logicalPath,
        properties: { semantic_role: 'source-module', resolution_status: 'resolved' },
      }),
    );
    context.nodes.push(target, owner);
    context.edges.push(importsEdge(owner.node_id, target.node_id, { ...request, source: logicalPath }, resolution, file.sha256));
    context.edges.push(graphEdge({ source: `art_${file.sha256}`, target: owner.node_id, relation: 'contains', properties: { logical_module_key: logicalPath } }));
    if (resolution.status === 'resolved') context.statistics.modules += 1;
  }
}

function addBridgeFacts(context, logicalPath, file) {
  for (const bridge of file.found?.contextBridges ?? []) {
    const node = graphNodeForBridge({ logicalPath, sha256: file.sha256, bridge });
    context.nodes.push(node);
    context.edges.push(
      graphEdge({
        source: `art_${file.sha256}`,
        target: node.node_id,
        relation: 'exposes',
        properties: { resolved_path: null, requested_members: bridge.members, namespace_access: false, dynamic_member_access: bridge.apiStatus !== 'object-literal', verified: false },
      }),
    );
  }
}

function addWindowFacts(context, logicalPath, file) {
  for (const window of file.found?.browserWindows ?? []) {
    const node = graphNodeForWindow({ logicalPath, sha256: file.sha256, window });
    context.nodes.push(node);
    context.edges.push(graphEdge({ source: `art_${file.sha256}`, target: node.node_id, relation: 'loads', properties: { mechanism: 'browser-window' } }));
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

function addNativeRequestFacts(context, logicalPath, file) {
  for (const request of file.found?.nativeRequests ?? []) {
    const resolution = resolveSpecifier({ specifier: request.specifier, fromPath: logicalPath, fileIndex: context.fileIndex });
    context.nodes.push(graphNodeForNativeRequest({ logicalPath, sha256: file.sha256, request, resolution }));
  }
}

function addIpcFacts(context, logicalPath, file) {
  const sides = [
    ['main', file.found?.ipcMain ?? []],
    ['renderer', file.found?.ipcRenderer ?? []],
  ];
  for (const [side, calls] of sides) for (const call of calls) context.nodes.push(graphNodeForIpc({ logicalPath, sha256: file.sha256, call, side }));
}

function addHtmlScriptEdges(context, extraction) {
  for (const [logicalPath, file] of extraction) {
    for (const script of file.htmlScripts ?? []) {
      const resolved = resolveSpecifier({ specifier: `./${script.specifier}`, fromPath: logicalPath, fileIndex: context.fileIndex });
      if (resolved.status !== 'resolved') continue;
      const owner = findNode(context.nodes, 'electron-renderer', logicalPath);
      const target = findNode(context.nodes, 'javascript-asset', resolved.resolvedPath);
      if (owner !== undefined && target !== undefined) context.edges.push(graphEdge({ source: owner.node_id, target: target.node_id, relation: 'loads', properties: { mechanism: 'html-script-src' } }));
    }
  }
}

function roleNode(kind, logicalPath, sha256, properties) {
  return fileNode({ kind, logicalPath, sha256, bytes: 0, properties, authority: 'static-relationship-inference', state: 'inferred', confidence: 'high', limitations: [ELECTRON_LIMITATION, ELECTRON_IDENTITY_LIMITATION] });
}

function graphNodeForBridge({ logicalPath, sha256, bridge }) {
  return fileNode({
    kind: 'context-bridge-api',
    logicalPath,
    sha256,
    bytes: 0,
    properties: { world: 'main', world_id: null, api_key: bridge.apiKey.value, api_key_expression: bridge.apiKey.expression, api_status: bridge.apiStatus, members: bridge.members, unknown_members: bridge.unknownMembers },
    authority: 'ast-static-analysis',
    state: 'observed',
    confidence: 'exact',
    limitations: [ELECTRON_LIMITATION],
  });
}

function graphNodeForWindow({ logicalPath, sha256, window }) {
  return fileNode({
    kind: 'browser-window',
    logicalPath,
    sha256,
    bytes: 0,
    properties: {
      source_path: logicalPath,
      options_status: window.optionsStatus,
      web_preferences_status: window.webPreferencesStatus,
      web_preferences: window.webPreferences.map((entry) => ({ name: entry.name, value: entry })),
      preload_path: null,
      preload_resolution_context: null,
      absence_means_default: true,
    },
    authority: 'ast-static-analysis',
    state: 'observed',
    confidence: 'exact',
    limitations: [ELECTRON_LIMITATION, 'Absent BrowserWindow options mean Windows defaults; the port does not evaluate defaults.'],
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
  return fileNode({
    kind: 'ipc-handler',
    logicalPath,
    sha256,
    bytes: 0,
    properties: { side, operation: call.operation, mode: call.operation, channel: call.channel.value, channel_expression: call.channel.expression, handler_kind: call.handlerKind, handler_location: call.range },
    authority: 'ast-static-analysis',
    state: 'observed',
    confidence: 'exact',
    limitations: [ELECTRON_LIMITATION, 'An IPC registration is a static candidate; the port does not prove the handler runs.'],
  });
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

function buildSummary({ nodes, edges, packageJson, roles, ipcPairs, electronFiles, nativeRequests }) {
  const handlers = nodes.filter((node) => node.kind === 'ipc-handler');
  const bySide = (side) => handlers.filter((node) => node.observations[0]?.properties.side === side);
  const literal = handlers.filter((node) => node.observations[0]?.properties.channel !== null && node.observations[0]?.properties.channel !== undefined);
  const paired = ipcPairs.filter((group) => group.main.length > 0 && group.renderer.length > 0);
  const unpairedLiteral = ipcPairs.filter((group) => group.main.length === 0 || group.renderer.length === 0);
  return {
    browser_windows: nodes.filter((node) => node.kind === 'browser-window').length,
    explicit_web_preferences: nodes.filter((node) => node.kind === 'browser-window').flatMap((node) => node.observations[0]?.properties.web_preferences ?? []).length,
    preload_entrypoints: nodes.filter((node) => node.kind === 'preload-entrypoint').length,
    context_bridge_apis: nodes.filter((node) => node.kind === 'context-bridge-api').length,
    exposed_api_members: nodes.filter((node) => node.kind === 'context-bridge-api').reduce((total, node) => total + (node.observations[0]?.properties.members ?? []).length, 0),
    ipc: {
      operations: handlers.length,
      literal_channels: new Set(literal.map((node) => node.observations[0].properties.channel)).size,
      dynamic_channel_operations: handlers.length - literal.length,
      renderer_transmissions: bySide('renderer').filter((node) => ['invoke', 'send', 'sendSync', 'postMessage'].includes(node.observations[0].properties.operation)).length,
      renderer_listeners: bySide('renderer').filter((node) => ['on', 'once', 'addListener'].includes(node.observations[0].properties.operation)).length,
      main_handlers: bySide('main').length,
      paired_renderer_transmissions: paired.length,
      ambiguous_renderer_transmissions: 0,
      unpaired_literal_renderer_transmissions: unpairedLiteral.length,
    },
    sender_validation_observations: 0,
    utility_processes: 0,
    resolved_utility_entrypoints: 0,
    native_addon_bindings: nativeRequests.length,
    resolved_native_addon_bindings: nativeRequests.filter((request) => request.range !== null).length,
    package_entrypoint: packageJson?.main ?? null,
    electron_role_files: { main: roles.main, preloads: roles.preloads, renderers: roles.renderers },
    electron_files: [...electronFiles].sort(),
    edges: edges.length,
  };
}

/**
 * One node per literal channel, aggregating observations from both sides of the
 * exchange, with handles/invokes edges back to each handler. The pairing is a
 * static candidate: sharing a channel name does not prove the pair is used.
 */
export function appendChannelNodes({ nodes, edges }) {
  const handlers = nodes.filter((node) => node.kind === 'ipc-handler');
  const groups = new Map();
  for (const handler of handlers) {
    const properties = handler.observations[0]?.properties ?? {};
    if (properties.channel === null || properties.channel === undefined) continue;
    const group = groups.get(properties.channel) ?? [];
    group.push({ handler, properties });
    groups.set(properties.channel, group);
  }
  for (const [channel, group] of groups) {
    const channelNode = fileNode({
      kind: 'ipc-channel',
      logicalPath: channel,
      sha256: group[0].handler.observations[0].evidence.artifact.sha256,
      bytes: 0,
      properties: { channel, resolution: 'literal', sides: [...new Set(group.map((entry) => entry.properties.side))].sort() },
      authority: 'ast-static-analysis',
      state: 'observed',
      confidence: 'exact',
      limitations: [ELECTRON_LIMITATION, 'A shared channel name is a static candidate for a pair, not proof that the two sides exchange messages.'],
    });
    nodes.push(channelNode);
    for (const entry of group) {
      edges.push(
        graphEdge({
          source: entry.handler.node_id,
          target: channelNode.node_id,
          relation: entry.properties.side === 'main' ? 'handles' : 'invokes',
          properties: { side: entry.properties.side, operation: entry.properties.operation, channel, channel_expression: null, resolution: 'literal' },
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
