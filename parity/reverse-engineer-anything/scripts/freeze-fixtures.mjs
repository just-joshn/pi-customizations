#!/usr/bin/env node
// Reduces raw reference captures into the committed fixtures the port is
// measured against. Raw captures stay in a scratch directory; this script
// keeps only what the parity claims cite, and records the provenance of each
// fixture beside it. Run: node freeze-fixtures.mjs <captures-dir> <fixtures-dir>
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [capturesDir, fixturesDir] = process.argv.slice(2);
if (!capturesDir || !fixturesDir) {
  process.stderr.write('usage: freeze-fixtures.mjs <captures-dir> <fixtures-dir>\n');
  process.exit(2);
}

const readJson = async (name) => JSON.parse(await readFile(join(capturesDir, name), 'utf8'));
const writeJson = async (name, value) => {
  const path = join(fixturesDir, 'reference', name);
  await mkdir(join(fixturesDir, 'reference'), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};
const writeText = async (name, value) => {
  const path = join(fixturesDir, 'reference', name);
  await mkdir(join(fixturesDir, 'reference'), { recursive: true });
  await writeFile(path, value);
  return path;
};

/** Keep the parts of the Evidence envelope the port reconstructs, and drop payload bulk no claim depends on. */
const envelope = (evidence, { keep = [] } = {}) => {
  const copied = {};
  for (const key of ['evidence_id', 'subject', 'provider', 'analysis_profile', 'predicate_type', 'operation', 'parameters', 'raw_result', 'confidence', 'authority', 'environment', 'locations', 'evidence_links', 'limitations']) {
    copied[key] = evidence[key];
  }
  copied.normalized_result = {};
  for (const key of keep) copied.normalized_result[key] = evidence.normalized_result[key];
  return copied;
};

const tools = await readJson('mcp/tools-list.json');
const prompts = await readJson('mcp/prompts-list.json');
const capabilities = await readJson('caps.out');
const js = await readJson('js-extracted.json');
const view = await readJson('view-summary.json');
const binaryLayoutError = await readJson('bl.out');
const invalidTargetError = await readJson('missing.out');

const nodeKinds = [...new Set(js.normalized_result.graph.nodes.map((node) => node.kind))].sort();
const edgeRelations = [...new Set(js.normalized_result.graph.edges.map((edge) => edge.relation))].sort();
const observationProperties = {};
for (const node of js.normalized_result.graph.nodes) {
  const key = node.kind;
  observationProperties[key] ??= new Set();
  for (const observation of node.observations) {
    for (const property of Object.keys(observation.properties ?? {})) observationProperties[key].add(property);
  }
}
const properties = Object.fromEntries(Object.entries(observationProperties).map(([kind, keys]) => [kind, [...keys].sort()]));

const searchSpaceBytes = JSON.stringify(js.normalized_result.semantic_graph).length;
const written = [];

written.push(
  await writeJson('rea-6.4.0-tools.json', {
    source: 'REA MCP tools/list on rea-agents@6.4.0',
    toolCount: tools.result.tools.length,
    tools: tools.result.tools.map((tool) => ({
      name: tool.name,
      title: tool.title ?? null,
      description: (tool.description ?? '').split('\n')[0],
      inputProperties: Object.keys(tool.inputSchema?.properties ?? {}),
      required: tool.inputSchema?.required ?? [],
    })),
  }),
);

written.push(
  await writeJson('rea-6.4.0-prompts.json', {
    source: 'REA MCP prompts/list on rea-agents@6.4.0',
    prompts: prompts.result.prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: (prompt.arguments ?? []).map((argument) => ({ name: argument.name, required: argument.required ?? false })),
    })),
  }),
);

written.push(
  await writeJson('rea-6.4.0-capabilities.json', {
    source: 'rea capabilities --json on rea-agents@6.4.0',
    open: capabilities.open,
    operationCount: capabilities.capabilities.length,
    capabilities: capabilities.capabilities,
    serverIdentity: capabilities.server_identity ?? null,
  }),
);

written.push(
  await writeJson('rea-6.4.0-analyze-javascript-application.json', {
    ...envelope(js, { keep: ['input_path', 'format', 'root_artifact_sha256', 'inventory_manifest_id', 'inventory_graph_sha256', 'integrity_contradictions', 'graph', 'summary', 'statistics', 'limitations'] }),
    _fixture_annotations: { note: 'Added when this fixture was frozen; not part of the reference envelope.', nodeKinds, edgeRelations, observationProperties: properties },
  }),
);

written.push(await writeJson('rea-6.4.0-analysis-view-summary.json', envelope(view, { keep: ['kind', 'view', 'summary', 'coverage', 'evidence_id'] })));

written.push(
  await writeJson('rea-6.4.0-errors.json', {
    source: 'rea CLI failures on rea-agents@6.4.0 (macOS 15, Node 24.21.0)',
    cases: [
      { command: 'rea inspect-binary-layout /bin/ls --json', exitCode: 1, envelope: binaryLayoutError },
      { command: 'rea analyze-javascript-application /tmp/rea-probe/does-not-exist --json', exitCode: 1, envelope: invalidTargetError },
    ],
  }),
);

written.push(await writeText('rea-6.4.0-cli-help.txt', await readFile(join(capturesDir, 'help.txt'), 'utf8')));

const targetSource = join(capturesDir, 'targets/notepad-app');
const targetDestination = join(fixturesDir, 'targets/notepad-app');
await mkdir(targetDestination, { recursive: true });
await cp(targetSource, targetDestination, { recursive: true });
const targetFiles = (await readdir(targetDestination, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
const targetBytes = await stat(join(targetDestination, 'package.json'))
  .then(() => 0)
  .catch(() => null);

await writeFile(
  join(fixturesDir, 'reference', 'PROVENANCE.md'),
  [
    '# Reference capture provenance',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Reference | \`rea-agents@6.4.0\` via \`npx -y rea-agents@latest\` |`,
    `| Host | darwin (macOS 15), Node ${process.version} |`,
    `| Captured | ${new Date().toISOString()} |`,
    `| MCP tools | ${tools.result.tools.length} |`,
    `| MCP prompts | ${prompts.result.prompts.length} |`,
    `| Session capabilities | ${capabilities.capabilities.length} |`,
    `| Semantic-graph bytes dropped | ${searchSpaceBytes} |`,
    `| Fixture target files | ${targetFiles.length} |`,
    targetBytes === null ? '' : '',
    'Raw captures are not committed. Regenerate with `scripts/probe-mcp.mjs` for the MCP catalog and `scripts/freeze-fixtures.mjs` for these files.',
    '',
  ].join('\n'),
);

process.stdout.write(`${JSON.stringify({ written, nodeKinds, edgeRelations: edgeRelations.length, droppedSemanticGraphBytes: searchSpaceBytes })}\n`);
