import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { capabilityMatrix, unavailableMatrix } from './capabilities.mjs';
import { absenceClaimAllowed, auditEvidence, unresolvedCitations } from './discipline.mjs';
import { createEnvelope } from './envelope.mjs';
import { capabilityUnavailable, fail, invalidInput, unsupportedTarget } from './errors.mjs';
import { inspectArtifact } from './formats/artifact.mjs';
import { analyzeJavaScriptApplication, JS_LIMITATIONS } from './formats/javascript.mjs';
import { openAsarSource, openDirectorySource } from './formats/target-source.mjs';
import { discoverLocalApplications, resolveTargetName, routeByPath } from './route.mjs';
import { readAnyEvidence } from './store.mjs';
import { describeSubject } from './target.mjs';
import { buildView } from './views.mjs';

const VERSION = '1';

const envelopeFor = ({ operation, predicateType, subject, parameters, normalizedResult, limitations, confidence = 'derived', authority = 'shipped-artifact', locations }) =>
  createEnvelope({
    operation,
    predicateType,
    subject,
    parameters,
    normalizedResult,
    confidence,
    authority,
    limitations,
    locations: locations ?? [{ kind: 'artifact-path', path: subject.local_path }],
  });

/** Open the analyzer's member source for a directory or ASAR target. */
async function javascriptSource({ subject, artifactFormat }) {
  const requested = artifactFormat ?? 'auto';
  if (subject.format === 'directory') return openDirectorySource(subject.local_path);
  if (subject.format === 'asar') return openAsarSource(await readFile(subject.local_path));
  if (requested === 'directory') throw unsupportedTarget('The target is not a directory; --artifact-format directory cannot be honoured.', { path: subject.local_path, detected: subject.format });
  throw unsupportedTarget('Only a directory or an ASAR can be analyzed as a JavaScript application.', { path: subject.local_path, detected: subject.format });
}

export const COMMANDS = new Map();

function define(name, spec) {
  COMMANDS.set(name, { name, ...spec });
}

define('capabilities', {
  summary: 'List implemented operations, their effects and their limitations.',
  needsStore: false,
  flags: { '--all': 'flag' },
  async run({ args }) {
    const matrix = capabilityMatrix({ version: VERSION });
    const includeUnavailable = args['--all'] === true;
    return {
      plain: renderCapabilities(matrix, includeUnavailable),
      result: { ...matrix, capabilities: [...matrix.capabilities, ...(includeUnavailable ? unavailableMatrix() : [])] },
    };
  },
});

define('route', {
  summary: 'Choose the first operation for a supplied target, from its bytes.',
  needsStore: false,
  flags: { '--name': 'string', '--candidates': 'path' },
  async run({ positionals, args }) {
    if (args['--name'] !== undefined) {
      const candidates = args['--candidates'] ? JSON.parse(await readFile(resolve(args['--candidates']), 'utf8')) : discoverLocalApplications();
      const chosen = resolveTargetName(args['--name'], candidates);
      const decision = await routeByPath(chosen.path);
      return { plain: `${chosen.name} (${chosen.path}): format=${decision.format} operation=${decision.operation}`, result: { ...decision, matched_by_name: chosen.name } };
    }
    const target = requirePositional(positionals, 0, 'route <path>');
    const decision = await routeByPath(target);
    return {
      plain: `${decision.name}: format=${decision.format} kind=${decision.kind} operation=${decision.operation ?? 'none'}`,
      result: decision,
      envelope: null,
    };
  },
});

define('analyze-javascript-application', {
  summary: 'Statically reconstruct a local JavaScript/Electron application or ASAR.',
  flags: { '--artifact-format': 'auto|asar|directory', '--integrity-policy': 'fail|record-and-continue' },
  async run({ positionals, args, store }) {
    const target = requirePositional(positionals, 0, 'analyze-javascript-application <path>');
    const subject = await describeSubject(target, { formatHint: args['--artifact-format'] ?? 'auto' });
    const source = await javascriptSource({ subject, artifactFormat: args['--artifact-format'] });
    const integrityPolicy = args['--integrity-policy'] ?? 'fail';
    let normalizedResult;
    try {
      normalizedResult = await analyzeJavaScriptApplication({ source, subject, integrityPolicy });
    } catch (error) {
      if (error?.name === 'IntegrityPolicyError') {
        throw fail('artifact_integrity_mismatch', 'integrity_mismatch', error.message, { details: { contradictions: error.contradictions } });
      }
      if (error?.name === 'AsarError') throw unsupportedTarget(error.message, { path: subject.local_path, offset: error.offset ?? null });
      throw error;
    }
    const envelope = envelopeFor({
      operation: 'analyze_javascript_application',
      predicateType: 'rea.javascript-application-analysis',
      subject,
      parameters: { format: args['--artifact-format'] ?? 'auto', integrity_policy: integrityPolicy },
      normalizedResult,
      limitations: JS_LIMITATIONS,
    });
    await store?.retain(envelope);
    return { envelope, plain: renderJavaScriptSummary(envelope) };
  },
});

define('inspect-artifact', {
  summary: 'Inspect an archive or package inventory without extracting it.',
  flags: { '--integrity-policy': 'fail|record-and-continue' },
  async run({ positionals, args, store }) {
    const target = requirePositional(positionals, 0, 'inspect-artifact <path>');
    const subject = await describeSubject(target);
    if (!['zip', 'apk', 'ipa', 'msix'].includes(subject.format)) {
      throw unsupportedTarget('Only ZIP-family containers are inventoried here.', { path: subject.local_path, detected: subject.format });
    }
    const bytes = await readFile(subject.local_path);
    const integrityPolicy = args['--integrity-policy'] ?? 'fail';
    let normalizedResult;
    try {
      normalizedResult = inspectArtifact({ bytes, subject, integrityPolicy });
    } catch (error) {
      if (error?.name === 'IntegrityPolicyError') throw fail('artifact_integrity_mismatch', 'integrity_mismatch', error.message, { details: { contradictions: error.contradictions } });
      if (error?.name === 'ArtifactFormatError') throw unsupportedTarget(error.message, { path: subject.local_path, offset: error.offset ?? null });
      throw error;
    }
    const envelope = envelopeFor({
      operation: 'inspect_artifact',
      predicateType: 'rea.artifact-inventory',
      subject,
      parameters: { integrity_policy: integrityPolicy },
      normalizedResult,
      limitations: normalizedResult.limitations,
    });
    await store?.retain(envelope);
    return { envelope, plain: `format=${normalizedResult.format} members=${normalizedResult.summary.member_count} contradictions=${normalizedResult.integrity_contradictions.length}` };
  },
});

define('inspect-binary-layout', {
  summary: 'Read a binary file and linked layout without opening a disassembler.',
  flags: {},
  async run({ positionals, store, args }) {
    const target = requirePositional(positionals, 0, 'inspect-binary-layout <path>');
    const { readBinaryLayout } = await import('./formats/binary.mjs');
    const subject = await describeSubject(target);
    const bytes = await readFile(subject.local_path);
    return runFormatCommand({
      store,
      subject,
      args,
      operation: 'inspect_binary_layout',
      predicateType: 'rea.binary-layout',
      read: () => readBinaryLayout(bytes),
      summary: (result) => `format=${result.format} arch=${result.architecture} imports=${result.symbols.imports.length} exports=${result.symbols.exports.length}`,
      parameters: {},
    });
  },
});

define('inspect-go-binary', {
  summary: 'Read embedded Go compiler, module and build-setting metadata.',
  flags: {},
  async run({ positionals, store, args }) {
    const target = requirePositional(positionals, 0, 'inspect-go-binary <path>');
    const { readGoBuildInfo } = await import('./formats/gobinary.mjs');
    const subject = await describeSubject(target);
    const bytes = await readFile(subject.local_path);
    const result = readGoBuildInfo(bytes);
    if (!result.present) {
      throw capabilityUnavailable('inspect_go_binary', 'No Go buildinfo marker was found in the searched bytes. That is not evidence that the binary is not a Go program.', { path: subject.local_path, searched_bytes: bytes.length });
    }
    return runFormatCommand({
      store,
      subject,
      args,
      operation: 'inspect_go_binary',
      predicateType: 'rea.go-binary-metadata',
      read: () => result,
      summary: (value) => `go=${value.go_version} modules=${value.modules.length} settings=${value.build_settings.length}`,
      parameters: {},
    });
  },
});

define('inspect-web-network-capture', {
  summary: 'Inspect a retained HAR capture offline.',
  flags: { '--format': 'auto|har' },
  async run({ positionals, store, args }) {
    const target = requirePositional(positionals, 0, 'inspect-web-network-capture <path>');
    const { readHarCapture } = await import('./formats/har.mjs');
    const subject = await describeSubject(target);
    let document;
    try {
      document = JSON.parse(await readFile(subject.local_path, 'utf8'));
    } catch {
      throw unsupportedTarget('The capture is not valid JSON, so no HAR document could be read.', { path: subject.local_path, detected: subject.format });
    }
    let result;
    try {
      result = readHarCapture(document);
    } catch (error) {
      if (error?.name === 'HarError') throw unsupportedTarget(error.message, { path: subject.local_path, code: error.code ?? null });
      throw error;
    }
    return runFormatCommand({
      store,
      subject,
      args,
      operation: 'inspect_web_network_capture',
      predicateType: 'rea.web-network-capture',
      read: () => result,
      summary: (value) => `version=${value.version} records=${value.records.length} truncated=${value.coverage.truncated}`,
      parameters: { format: args['--format'] ?? 'har' },
    });
  },
});

async function runFormatCommand({ store, subject, operation, predicateType, read, summary, parameters = {} }) {
  let normalizedResult;
  try {
    normalizedResult = read();
  } catch (error) {
    if (error?.name === 'FormatError' || error?.name === 'GoFormatError') {
      throw unsupportedTarget(error.message, { path: subject.local_path, code: error.code ?? null, offset: error.offset ?? null });
    }
    throw error;
  }
  const envelope = envelopeFor({
    operation,
    predicateType,
    subject,
    parameters,
    normalizedResult,
    limitations: [...(normalizedResult.limitations ?? []), 'Static facts only; the port performs no execution and opens no disassembler.'],
  });
  await store?.retain(envelope);
  return { envelope, plain: summary(normalizedResult) };
}

define('inspect-analysis-view', {
  summary: 'Project a view of retained evidence without repeating the analysis.',
  flags: { '--view': 'summary|section|item|inventory|api-surface', '--selector': 'string', '--collection': 'string', '--logical-paths': 'comma-separated', '--offset': 'number', '--limit': 'number' },
  async run({ positionals, args, store }) {
    const selector = requirePositional(positionals, 0, 'inspect-analysis-view <evidence-id|path>');
    const record = selector.startsWith('ev_') ? await store.get(selector) : await readAnyEvidence(selector);
    const view = await buildView(record, {
      kind: args['--view'] ?? 'summary',
      selector: args['--selector'] ?? null,
      collection: args['--collection'] ?? null,
      logicalPaths: args['--logical-paths'] ? String(args['--logical-paths']).split(',').filter(Boolean) : null,
      offset: args['--offset'] === undefined ? 0 : Number(args['--offset']),
      limit: args['--limit'] === undefined ? null : Number(args['--limit']),
    });
    const envelope = envelopeFor({
      operation: view.operation,
      predicateType: view.predicate_type,
      subject: record.subject,
      parameters: view.parameters,
      normalizedResult: view.normalized_result,
      limitations: [...record.limitations, 'This view reads retained evidence; it neither re-ran the producer nor upgraded its coverage.'],
      locations: record.locations,
      evidenceLinks: [record.evidence_id],
    });
    return { envelope, plain: JSON.stringify(view.normalized_result.summary ?? view.normalized_result, null, 2) };
  },
});

define('record-unknown', {
  summary: 'Record a residual unknown with the evidence it would need.',
  flags: {
    '--question': 'string',
    '--severity': 'low|medium|high',
    '--domain': 'string',
    '--required-authority': 'string',
    '--required-confidence': 'string',
    '--supporting': 'evidence-id',
    '--contradicting': 'evidence-id',
    '--recommended-probe': 'string',
  },
  async run({ args, store }) {
    const record = await store.recordUnknown({
      question: args['--question'],
      severity: args['--severity'] ?? 'medium',
      domain: args['--domain'] ?? 'general',
      required_authority: args['--required-authority'] ?? null,
      required_confidence: args['--required-confidence'] ?? null,
      recommended_probes: args['--recommended-probe'] ? [String(args['--recommended-probe'])] : [],
      supporting_evidence_ids: args['--supporting'] ? [String(args['--supporting'])] : [],
      contradicting_evidence_ids: args['--contradicting'] ? [String(args['--contradicting'])] : [],
    });
    return { result: record.head, plain: `${record.head.unknown_id} revision=${record.head.revision} status=${record.head.status}\n${record.head.question}` };
  },
});

define('update-unknown', {
  summary: 'Append an immutable revision to a residual unknown.',
  flags: {
    '--expected-revision': 'number',
    '--status': 'unresolved|resolved|blocked|not_applicable',
    '--resolution-statement': 'string',
    '--resolution-evidence': 'evidence-id',
    '--supporting': 'evidence-id',
    '--contradicting': 'evidence-id',
  },
  async run({ positionals, args, store }) {
    const id = requirePositional(positionals, 0, 'update-unknown <unknown-id>');
    const expectedRevision = Number(args['--expected-revision']);
    if (!Number.isInteger(expectedRevision)) throw invalidInput('An update needs the revision it read.', [{ path: ['expected-revision'], reason: 'required', message: '--expected-revision must be an integer' }]);
    const record = await store.updateUnknown(id, expectedRevision, {
      status: args['--status'] ?? 'unresolved',
      resolution: args['--resolution-statement'] ? { statement: args['--resolution-statement'], evidence_ids: args['--resolution-evidence'] ? [String(args['--resolution-evidence'])] : [] } : null,
      supporting_evidence_ids: args['--supporting'] ? [String(args['--supporting'])] : undefined,
      contradicting_evidence_ids: args['--contradicting'] ? [String(args['--contradicting'])] : undefined,
    });
    return { result: record.head, plain: `${record.head.unknown_id} revision=${record.head.revision} status=${record.head.status}` };
  },
});

define('list-unknowns', {
  summary: 'List residual-unknown heads in deterministic order.',
  flags: { '--status': 'string', '--severity': 'string', '--domain': 'string' },
  async run({ args, store }) {
    const heads = await store.listUnknowns({ status: args['--status'], severity: args['--severity'], domain: args['--domain'] });
    return { result: heads, plain: heads.length === 0 ? 'no residual unknowns' : heads.map((head) => `${head.unknown_id} ${head.status} ${head.severity} ${head.question}`).join('\n') };
  },
});

define('discipline-audit', {
  summary: 'Check retained evidence against the rules a report must satisfy.',
  flags: { '--bundle': 'path' },
  async run({ args, store }) {
    const records = args['--bundle'] ? await bundleRecords(args['--bundle']) : await sessionRecords(store);
    const bundle = { records };
    const violations = auditEvidence(records);
    const unresolved = unresolvedCitations(bundle);
    const result = {
      evidence_count: records.length,
      violations,
      unresolved_citations: unresolved,
      absence_claims_allowed: records.filter((record) => absenceClaimAllowed(record)).map((record) => record.evidence_id),
      checked: ['limitations present', 'observations carry limitations and coverage', 'no execution claim without a runtime record', 'every cited evidence id resolves'],
    };
    const plain = violations.length === 0 && unresolved.length === 0 ? `clean: ${records.length} record(s) pass the discipline audit` : `violations=${violations.length} unresolved_citations=${unresolved.length}`;
    return { result, plain };
  },
});

async function sessionRecords(store) {
  const ledger = await store.ledger();
  const records = [];
  for (const entry of ledger.records) records.push(await store.get(entry.evidence_id));
  return records;
}

async function bundleRecords(path) {
  const bundle = JSON.parse(await readFile(resolve(path), 'utf8'));
  return bundle.records ?? [];
}

define('evidence-export', {
  summary: 'Export retained evidence and unknowns as one canonical bundle.',
  flags: { '--overwrite': 'flag', '--stable': 'flag' },
  async run({ positionals, args, store }) {
    const path = requirePositional(positionals, 0, 'evidence-export <path>');
    const result = await store.exportBundle(path, { overwrite: args['--overwrite'] === true, stable: args['--stable'] === true });
    return { result, plain: `wrote ${result.recordCount} records and ${result.unknownCount} unknowns to ${result.path}` };
  },
});

define('evidence-import', {
  summary: 'Import a canonical bundle after validating every content address.',
  flags: {},
  async run({ positionals, store }) {
    const path = requirePositional(positionals, 0, 'evidence-import <path>');
    const result = await store.importBundle(path);
    return { result, plain: `imported ${result.imported} records, skipped ${result.skipped}` };
  },
});

function requirePositional(positionals, index, usage) {
  const value = positionals[index];
  if (value === undefined) throw invalidInput(`Missing argument. Usage: ${usage}`, [{ path: [String(index)], reason: 'required', message: `usage: ${usage}` }]);
  return value;
}

function renderCapabilities(matrix, includeUnavailable) {
  const lines = [`provider=${matrix.provider.id} version=${matrix.provider.version}`];
  for (const entry of matrix.capabilities) lines.push(`  available   ${entry.operation} — ${entry.title}`);
  if (includeUnavailable) for (const entry of unavailableMatrix()) lines.push(`  unavailable ${entry.operation} — ${entry.reason}`);
  return lines.join('\n');
}

function renderJavaScriptSummary(envelope) {
  const { summary, statistics, format } = envelope.normalized_result;
  return [
    `format=${format} files=${statistics.relevant_files} parsed=${statistics.parsed_javascript_files} findings=${statistics.findings}`,
    `electron: windows=${summary.browser_windows} bridges=${summary.context_bridge_apis} ipc_operations=${summary.ipc.operations} paired=${summary.ipc.paired_renderer_transmissions} unpaired=${summary.ipc.unpaired_literal_renderer_transmissions}`,
    `native_addon_bindings=${summary.native_addon_bindings}`,
    `evidence=${envelope.evidence_id}`,
  ].join('\n');
}
