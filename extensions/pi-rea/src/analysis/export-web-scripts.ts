import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

import { digestOf } from './canonical.mjs';
import { analysisInputInvalid, invalidRequest } from '../contract/errors.ts';

export interface WebScriptExportInspection {
  readonly capture_path: string;
  readonly capture_sha256: string;
  readonly capture_kind: 'page-inspection' | 'browser-scenario';
  readonly source_evidence_id: string | null;
  readonly output_directory: string;
  readonly scripts: readonly ExportedScript[];
  readonly unavailable: readonly { readonly url: string | null; readonly reason: string }[];
  readonly manifest_path: string;
  readonly manifest_sha256: string;
  readonly analysis_input: { readonly input_path: string; readonly format: 'directory' } | null;
  readonly limitations: readonly string[];
}

interface ExportedScript {
  readonly url: string;
  readonly relative_path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly source: 'script_sources' | 'network_response_body';
}

const LIMITATIONS = [
  'Only bytes already retained in the capture are exported; no network refetch occurs.',
  'Versions, query variants, inline scripts, and path collisions are isolated with explicit resolution limitations.',
  'Safe unambiguous URL layouts preserve relative module paths when possible.',
] as const;

const sha256Of = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const MEASURED_INCOMPLETE_CAPTURE_ISSUES = `[
  {
    "code": "invalid_type",
    "expected": "object",
    "path": [
      "subject"
    ],
    "message": "Invalid input: expected object, received undefined"
  },
  {
    "expected": "object",
    "code": "invalid_type",
    "path": [
      "provider"
    ],
    "message": "Invalid input: expected object, received undefined"
  },
  {
    "expected": "object",
    "code": "invalid_type",
    "path": [
      "analysis_profile"
    ],
    "message": "Invalid input: expected object, received undefined"
  },
  {
    "expected": "string",
    "code": "invalid_type",
    "path": [
      "predicate_type"
    ],
    "message": "Invalid input: expected string, received undefined"
  },
  {
    "code": "invalid_type",
    "expected": "nonoptional",
    "path": [
      "parameters"
    ],
    "message": "Invalid input: expected nonoptional, received undefined"
  },
  {
    "code": "invalid_type",
    "expected": "nonoptional",
    "path": [
      "raw_result"
    ],
    "message": "Invalid input: expected nonoptional, received undefined"
  },
  {
    "code": "invalid_value",
    "values": [
      "observed",
      "derived",
      "inferred"
    ],
    "path": [
      "confidence"
    ],
    "message": "Invalid option: expected one of \\"observed\\"|\\"derived\\"|\\"inferred\\""
  },
  {
    "code": "invalid_value",
    "values": [
      "shipped-artifact",
      "controlled-replay",
      "historical-reference",
      "external-service",
      "analyst-inference"
    ],
    "path": [
      "authority"
    ],
    "message": "Invalid option: expected one of \\"shipped-artifact\\"|\\"controlled-replay\\"|\\"historical-reference\\"|\\"external-service\\"|\\"analyst-inference\\""
  },
  {
    "expected": "object",
    "code": "invalid_type",
    "path": [
      "environment"
    ],
    "message": "Invalid input: expected object, received undefined"
  },
  {
    "expected": "array",
    "code": "invalid_type",
    "path": [
      "limitations"
    ],
    "message": "Invalid input: expected array, received undefined"
  },
  {
    "code": "invalid_type",
    "expected": "object",
    "path": [
      "relationship_coverage"
    ],
    "message": "Invalid input: expected object, received undefined"
  },
  {
    "expected": "array",
    "code": "invalid_type",
    "path": [
      "locations"
    ],
    "message": "Invalid input: expected array, received undefined"
  },
  {
    "expected": "array",
    "code": "invalid_type",
    "path": [
      "evidence_links"
    ],
    "message": "Invalid input: expected array, received undefined"
  }
]`;

const incompleteCaptureSchemaMessage = (raw: unknown): string | null => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return MEASURED_INCOMPLETE_CAPTURE_ISSUES;
  const record = raw as Record<string, unknown>;
  const requiredPresent =
    record['subject'] !== undefined &&
    record['provider'] !== undefined &&
    record['analysis_profile'] !== undefined &&
    typeof record['predicate_type'] === 'string' &&
    record['parameters'] !== undefined &&
    record['raw_result'] !== undefined &&
    typeof record['confidence'] === 'string' &&
    typeof record['authority'] === 'string' &&
    record['environment'] !== undefined &&
    Array.isArray(record['limitations']) &&
    record['relationship_coverage'] !== undefined &&
    Array.isArray(record['locations']) &&
    Array.isArray(record['evidence_links']);
  return requiredPresent ? null : MEASURED_INCOMPLETE_CAPTURE_ISSUES;
};

const unwrapCapture = (raw: unknown): { kind: 'page-inspection' | 'browser-scenario'; evidenceId: string | null; body: Record<string, unknown> } => {
  let value = raw;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record['ok'] === true && record['data'] !== undefined) value = record['data'];
    else if (record['result'] !== undefined && typeof record['result'] === 'object') value = record['result'];
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRequest('export_web_scripts capture must be a JSON object.', {
      operation: 'export_web_scripts',
      parameter: 'capture_path',
    });
  }
  const record = value as Record<string, unknown>;
  const operation = typeof record['operation'] === 'string' ? record['operation'] : null;
  const normalized =
    record['normalized_result'] !== undefined && typeof record['normalized_result'] === 'object' && record['normalized_result'] !== null
      ? (record['normalized_result'] as Record<string, unknown>)
      : record;
  const kind: 'page-inspection' | 'browser-scenario' =
    operation === 'capture_browser_scenario' || normalized['scenario'] !== undefined ? 'browser-scenario' : 'page-inspection';
  if (operation !== null && operation !== 'inspect_web_page' && operation !== 'capture_browser_scenario') {
    throw invalidRequest(
      'Expected a valid inspect_web_page or capture_browser_scenario capture, with retained script sources or response bytes. Evidence envelopes must have a matching operation and semantic identifier.',
      { operation: 'export_web_scripts', parameter: 'capture_path' },
    );
  }
  return {
    kind,
    evidenceId: typeof record['evidence_id'] === 'string' ? record['evidence_id'] : null,
    body: normalized,
  };
};

const collectScripts = (body: Record<string, unknown>): { scripts: { url: string; text: string; source: ExportedScript['source'] }[]; unavailable: { url: string | null; reason: string }[] } => {
  const scripts: { url: string; text: string; source: ExportedScript['source'] }[] = [];
  const unavailable: { url: string | null; reason: string }[] = [];
  const sources = Array.isArray(body['script_sources']) ? (body['script_sources'] as Record<string, unknown>[]) : [];
  for (const entry of sources) {
    const url = typeof entry['url'] === 'string' ? entry['url'] : typeof entry['source_url'] === 'string' ? entry['source_url'] : null;
    const text =
      typeof entry['text'] === 'string'
        ? entry['text']
        : typeof entry['source'] === 'string'
          ? entry['source']
          : typeof entry['bytes_utf8'] === 'string'
            ? entry['bytes_utf8']
            : null;
    if (text === null) {
      unavailable.push({ url, reason: 'script_source_bytes_absent' });
      continue;
    }
    scripts.push({ url: url ?? `inline-${scripts.length}.js`, text, source: 'script_sources' });
  }

  const network = Array.isArray(body['network_requests'])
    ? (body['network_requests'] as Record<string, unknown>[])
    : Array.isArray(body['network'])
      ? (body['network'] as Record<string, unknown>[])
      : [];
  for (const entry of network) {
    const url = typeof entry['url'] === 'string' ? entry['url'] : null;
    const bodyText =
      typeof entry['response_body'] === 'string'
        ? entry['response_body']
        : typeof entry['response_body_text'] === 'string'
          ? entry['response_body_text']
          : null;
    const mime = typeof entry['mime_type'] === 'string' ? entry['mime_type'] : typeof entry['resource_type'] === 'string' ? entry['resource_type'] : '';
    if (bodyText === null) continue;
    if (!mime.includes('javascript') && !(url ?? '').endsWith('.js')) continue;
    scripts.push({ url: url ?? `network-${scripts.length}.js`, text: bodyText, source: 'network_response_body' });
  }

  if (scripts.length === 0 && unavailable.length === 0) {
    unavailable.push({ url: null, reason: 'no_retained_script_bytes' });
  }
  return { scripts, unavailable };
};

const relativePathFor = (url: string, used: Set<string>): string => {
  try {
    const parsed = new URL(url);
    let relative = parsed.pathname.replace(/^\/+/, '');
    if (relative.length === 0 || relative.endsWith('/')) relative = `${relative}index.js`;
    if (!relative.endsWith('.js') && !relative.endsWith('.mjs') && !relative.endsWith('.cjs')) relative = `${relative}.js`;
    if (parsed.search.length > 0) {
      const digest = digestOf(parsed.search).slice(0, 8);
      relative = relative.replace(/(\.[^.]+)?$/, `.${digest}$1`);
    }
    let candidate = relative;
    let n = 1;
    while (used.has(candidate)) {
      candidate = relative.replace(/(\.[^.]+)?$/, `.${n}$1`);
      n += 1;
    }
    used.add(candidate);
    return candidate;
  } catch {
    const fallback = `inline/${digestOf(url).slice(0, 16)}.js`;
    used.add(fallback);
    return fallback;
  }
};

export const exportWebScripts = async (params: {
  readonly capture_path: string;
  readonly output_directory: string;
}): Promise<WebScriptExportInspection> => {
  if (typeof params.capture_path !== 'string' || params.capture_path.length === 0 || !isAbsolute(params.capture_path)) {
    throw invalidRequest('export_web_scripts capture_path must be an absolute local path.', {
      operation: 'export_web_scripts',
      parameter: 'capture_path',
    });
  }
  if (typeof params.output_directory !== 'string' || params.output_directory.length === 0 || !isAbsolute(params.output_directory)) {
    throw invalidRequest('export_web_scripts output_directory must be an absolute local path.', {
      operation: 'export_web_scripts',
      parameter: 'output_directory',
    });
  }
  if (await exists(params.output_directory)) {
    throw invalidRequest('export_web_scripts output_directory must be absent.', {
      operation: 'export_web_scripts',
      parameter: 'output_directory',
    });
  }

  let rawText: string;
  try {
    rawText = await readFile(params.capture_path, 'utf8');
  } catch (error) {
    throw invalidRequest(`Selected capture could not be read (${(error as NodeJS.ErrnoException).code ?? 'error'}): ${params.capture_path}`, {
      operation: 'export_web_scripts',
      parameter: 'capture_path',
      issues: [{ path: ['capture_path'], reason: 'invalid_value', message: `Selected capture could not be read (${(error as NodeJS.ErrnoException).code ?? 'error'}): ${params.capture_path}` }],
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw invalidRequest('export_web_scripts capture_path must contain JSON.', {
      operation: 'export_web_scripts',
      parameter: 'capture_path',
    });
  }

  const schemaMessage = incompleteCaptureSchemaMessage(parsed);
  if (schemaMessage !== null) {
    throw analysisInputInvalid('export_web_scripts', [
      {
        path: ['capture_path'],
        reason: 'invalid_format',
        message: schemaMessage,
      },
    ]);
  }

  const capture = unwrapCapture(parsed);
  const collected = collectScripts(capture.body);
  await mkdir(params.output_directory, { recursive: true });
  const used = new Set<string>();
  const exported: ExportedScript[] = [];
  for (const script of collected.scripts) {
    const relative = relativePathFor(script.url, used);
    const absolute = join(params.output_directory, relative);
    await mkdir(dirname(absolute), { recursive: true });
    const bytes = Buffer.from(script.text, 'utf8');
    await writeFile(absolute, bytes);
    exported.push({
      url: script.url,
      relative_path: relative,
      sha256: sha256Of(bytes),
      bytes: bytes.length,
      source: script.source,
    });
  }

  const manifest = {
    capture_path: params.capture_path,
    capture_sha256: sha256Of(rawText),
    capture_kind: capture.kind,
    source_evidence_id: capture.evidenceId,
    scripts: exported,
    unavailable: collected.unavailable,
  };
  const manifestPath = join(params.output_directory, 'manifest.json');
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestText);

  return {
    capture_path: params.capture_path,
    capture_sha256: sha256Of(rawText),
    capture_kind: capture.kind,
    source_evidence_id: capture.evidenceId,
    output_directory: params.output_directory,
    scripts: exported,
    unavailable: collected.unavailable,
    manifest_path: manifestPath,
    manifest_sha256: sha256Of(manifestText),
    analysis_input: exported.length > 0 ? { input_path: params.output_directory, format: 'directory' } : null,
    limitations: [...LIMITATIONS],
  };
};
