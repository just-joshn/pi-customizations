
const ENTRY_CAP = 5000;
const REDACTED = '[redacted]';
const ABSOLUTE_URL = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\//;
const VERSION = /^1\.\d+$/;
const AUTHORITY_END = /[/?#]/;
const PATH_END = /[?#]/;
const PATH_SEGMENT_ID = /^(?:\d+|[0-9a-fA-F]{8,})$/;
const CREDENTIAL_NAME_PARTS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'token',
  'secret',
  'api-key',
  'apikey',
  'auth',
  'key',
  'credential',
  'signature',
  'access-key',
  'password',
  'passwd',
  'session-id',
];
const CREDENTIAL_QUERY_PARTS = ['token', 'secret', 'key', 'password', 'passwd', 'sig', 'signature', 'auth', 'credential', 'session'];
const HAR_ERROR_CODES = new Set(['unsupported_version', 'malformed']);

const DECODER = Object.freeze({
  id: 'har-schema/lossless-json',
  name: 'REA HAR capture adapter',
  version: 'har-schema@2.0.0;har-schema-corrections@1;jsonc-parser@3.3.1;lossless-json@4.3.1',
});

const CAPTURE_LIMITATIONS = Object.freeze([
  'This is retained producer evidence, without live browser transaction IDs, scenario provenance, execution attribution or deployment authenticity. Recorded URLs are never fetched.',
  'Every record is decoded before selection; no partial success is returned on malformed input or a resource limit.',
  'Known authentication headers/cookies and explicitly marked literal values are excluded. Unknown extension names do not establish sensitivity.',
  'Complete evidence is bounded by a 33554432-byte input budget, a 100663296-byte reply budget, and a 64-level nesting cap. Those have no runtime override. capture_timeout_ms is 30000 ms (omitted means 30000). HAR/SAZ/qlog use a 192 MiB Node old-generation heap (source default). The effective REA_CAPTURE_DECODER_OLD_GENERATION_MIB value is 192 MiB (source default; default 192 MiB, floor 8 MiB, maximum 16384 MiB). Set REA_CAPTURE_DECODER_OLD_GENERATION_MIB in the environment that starts REA to a decimal integer from 8 to 16384, then restart REA. In a running MCP server, use update_analysis_settings with setting capture.decoder_old_generation_mib and action set instead; the new value applies to new work without a REA restart. On Node.js the decoder passes --max-old-space-size=192 and removes inherited NODE_OPTIONS, so additional host memory and NODE_OPTIONS do not raise this heap. The 8 MiB semi-space stays fixed. On Bun the V8 flags are ignored. Windows limits the decoder\'s committed memory to this value plus a 512 MiB reserve. Other Bun hosts enforce no decoder heap limit. Mitmproxy decoding uses a 768 MiB Linux address-space limit.',
]);

const RECORD_LIMITATIONS = Object.freeze([
  'HAR text without an encoding declaration is producer-decoded Unicode. Unsupported declared body encodings remain opaque; original body bytes remain unknown unless content explicitly uses valid base64. Declared sizes are preserved independently of retained bytes. mitmproxy 12.2.3 SaveHar may report null optional postData.text; that null is retained and omitted only from the upstream validation copy.',
]);

export class HarError extends Error {
  constructor(code, message) {
    if (!HAR_ERROR_CODES.has(code)) throw new TypeError(`unknown HarError code: ${code}`);
    super(message);
    this.name = 'HarError';
    this.code = code;
  }
}

export function readHarCapture(document, options = {}) {
  const { log, version } = requireLog(document);
  const entries = log.entries;
  const truncated = entries.length > ENTRY_CAP;
  const retained = truncated ? entries.slice(0, ENTRY_CAP) : entries;
  const ordinalFilter = normalizeOrdinals(options.record_ordinals, retained.length);
  const selected = ordinalFilter === null ? retained.map((entry, ordinal) => ({ entry, ordinal })) : ordinalFilter.map((ordinal) => ({ entry: retained[ordinal], ordinal }));
  let sensitiveValueCount = 0;
  const records = [];
  for (const { entry, ordinal } of selected) {
    const projected = projectEntry(entry, ordinal);
    sensitiveValueCount += projected.sensitive_value_count;
    records.push(projected.record);
  }
  return {
    decoder: { ...DECODER },
    container: {
      reported: {
        log: {
          version,
          creator: readCreator(log.creator),
          entries: null,
        },
      },
      numeric_literals: [],
      redactions: [],
      records_pointer: '/log/entries',
    },
    total_records: records.length,
    records,
    runtime_attribution: 'unknown',
    limitations: [...CAPTURE_LIMITATIONS],
    format: 'har',
    selected_ordinals: selected.map((row) => row.ordinal),
    sensitive_value_count: sensitiveValueCount,
  };
}

export function apiSurface(records) {
  if (!Array.isArray(records)) throw new HarError('malformed', 'apiSurface expects the records array returned by readHarCapture.');
  const groups = new Map();
  for (const record of records) {
    if (!Number.isInteger(record?.ordinal)) throw new HarError('malformed', 'apiSurface expects every record to carry an integer ordinal.');
    const fields = surfaceFields(record);
    const method = fields.method;
    const origin = fields.origin;
    const template = pathTemplate(fields.path);
    const key = `${method}\u0000${origin}\u0000${template}`;
    const existing = groups.get(key);
    const group = existing === undefined ? { method, origin, path_template: template, ordinals: [], observations: 0 } : existing;
    groups.set(key, { ...group, ordinals: [...group.ordinals, record.ordinal], observations: group.observations + 1 });
  }
  return [...groups.values()].sort((left, right) => compareText(left.method, right.method) || compareText(left.origin, right.origin) || compareText(left.path_template, right.path_template));
}

export function surfaceFields(record) {
  const reported = record?.reported;
  if (reported !== null && typeof reported === 'object' && !Array.isArray(reported)) {
    const request = objectOrEmpty(reported.request);
    const link = readUrl(request.url);
    return {
      method: typeof request.method === 'string' ? request.method : '',
      origin: link.origin,
      path: link.path,
      url: link.url,
    };
  }
  return {
    method: typeof record?.method === 'string' ? record.method : '',
    origin: typeof record?.origin === 'string' ? record.origin : '',
    path: typeof record?.path === 'string' ? record.path : '',
    url: typeof record?.url === 'string' ? record.url : '',
  };
}

function requireLog(document) {
  const log = document !== null && typeof document === 'object' ? document.log : undefined;
  if (log === null || typeof log !== 'object' || Array.isArray(log)) throw new HarError('malformed', 'A HAR document must contain a log object.');
  if (!Array.isArray(log.entries)) throw new HarError('malformed', 'The HAR log has no entries array, so no records can be read.');
  const version = typeof log.version === 'string' ? log.version.trim() : '';
  if (!VERSION.test(version)) {
    if (version.length > 0) throw new HarError('unsupported_version', `Unsupported HAR version "${version}"; this reader accepts HAR 1.x captures.`);
    throw new HarError('malformed', 'The HAR log has no version, so the capture format cannot be established.');
  }
  return { log, version };
}

function readCreator(creator) {
  if (creator === null || typeof creator === 'undefined' || typeof creator !== 'object' || Array.isArray(creator)) {
    return { name: null, version: null };
  }
  return {
    name: typeof creator.name === 'string' ? creator.name : null,
    version: typeof creator.version === 'string' ? creator.version : null,
  };
}

function normalizeOrdinals(raw, length) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new HarError('malformed', 'record_ordinals must be an array of integers.');
  const out = [];
  for (const value of raw) {
    if (!Number.isInteger(value) || value < 0 || value >= length) {
      throw new HarError('malformed', `record_ordinals entry ${String(value)} is out of range for ${length} retained entries.`);
    }
    out.push(value);
  }
  return out;
}

function projectEntry(entry, ordinal) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new HarError('malformed', `log.entries[${ordinal}] is not an object.`);
  }
  const redaction = redactEntry(entry);
  const reported = redaction.reported;
  return {
    sensitive_value_count: redaction.sensitive_value_count,
    record: {
      ordinal,
      location: { kind: 'json-pointer', pointer: `/log/entries/${ordinal}` },
      reported,
      binary_fields: [],
      numeric_literals: collectNumericLiterals(reported),
      redactions: redaction.redactions,
      limitations: [...RECORD_LIMITATIONS],
    },
  };
}

function redactEntry(entry) {
  const redactions = [];
  const next = structuredCloneJson(entry);
  let sensitiveValueCount = 0;
  sensitiveValueCount += redactHeaderArray(next?.request?.headers, redactions, '/request/headers');
  sensitiveValueCount += redactHeaderArray(next?.response?.headers, redactions, '/response/headers');
  sensitiveValueCount += redactCookieArray(next?.request?.cookies, redactions, '/request/cookies');
  sensitiveValueCount += redactCookieArray(next?.response?.cookies, redactions, '/response/cookies');
  if (typeof next?.request?.url === 'string') {
    const redactedUrl = redactQuery(next.request.url);
    if (redactedUrl !== next.request.url) {
      sensitiveValueCount += 1;
      redactions.push({ pointer: '/request/url', reason: 'credential-query' });
      next.request.url = redactedUrl;
    }
  }
  return { reported: next, sensitive_value_count: sensitiveValueCount, redactions };
}

function redactHeaderArray(headers, redactions, basePointer) {
  if (!Array.isArray(headers)) return 0;
  let count = 0;
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index];
    if (header === null || typeof header !== 'object') continue;
    const name = typeof header.name === 'string' ? header.name : '';
    if (!isCredentialHeaderName(name)) continue;
    header.value = REDACTED;
    redactions.push({ pointer: `${basePointer}/${index}/value`, reason: 'credential-header' });
    count += 1;
  }
  return count;
}

function redactCookieArray(cookies, redactions, basePointer) {
  if (!Array.isArray(cookies)) return 0;
  let count = 0;
  for (let index = 0; index < cookies.length; index += 1) {
    const cookie = cookies[index];
    if (cookie === null || typeof cookie !== 'object') continue;
    if (typeof cookie.value !== 'string') continue;
    cookie.value = REDACTED;
    redactions.push({ pointer: `${basePointer}/${index}/value`, reason: 'credential-cookie' });
    count += 1;
  }
  return count;
}

function collectNumericLiterals(value, pointer = '') {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [{ pointer: pointer === '' ? '/' : pointer, producer_type: 'json-number', literal: String(value) }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectNumericLiterals(entry, `${pointer}/${index}`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => collectNumericLiterals(nested, `${pointer}/${key}`));
  }
  return [];
}

function structuredCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isCredentialHeaderName(name) {
  const lower = name.toLowerCase().trim();
  const compact = lower.replace(/[-_]/g, '');
  return CREDENTIAL_NAME_PARTS.some((part) => lower.includes(part) || compact.includes(part.replace(/[-_]/g, '')));
}

function readUrl(raw) {
  const recorded = typeof raw === 'string' ? raw : '';
  const match = ABSOLUTE_URL.exec(recorded);
  if (match === null) return { url: recorded, origin: '', path: pathPart(recorded) };
  const prefix = match[0];
  const rest = recorded.slice(prefix.length);
  const end = rest.search(AUTHORITY_END);
  const hostPort = stripUserinfo(rest.slice(0, end === -1 ? rest.length : end));
  const remainder = rest.slice(end === -1 ? rest.length : end);
  return { url: `${prefix}${hostPort}${remainder}`, origin: `${match[1]}//${hostPort}`, path: pathPart(remainder) };
}

function redactQuery(remainder) {
  const queryStart = remainder.indexOf('?');
  if (queryStart === -1) return remainder;
  const hashStart = remainder.indexOf('#');
  const query = remainder.slice(queryStart + 1, hashStart === -1 ? remainder.length : hashStart);
  const fragment = hashStart === -1 ? '' : remainder.slice(hashStart);
  let changed = false;
  const redacted = query
    .split('&')
    .map((pair) => {
      const equals = pair.indexOf('=');
      if (equals === -1) return pair;
      const name = pair.slice(0, equals);
      const lower = name.toLowerCase();
      if (CREDENTIAL_QUERY_PARTS.some((part) => lower.includes(part))) {
        changed = true;
        return `${name}=[redacted]`;
      }
      return pair;
    })
    .join('&');
  return changed ? `${remainder.slice(0, queryStart)}?${redacted}${fragment}` : remainder;
}

function stripUserinfo(authority) {
  const at = authority.lastIndexOf('@');
  return at === -1 ? authority : authority.slice(at + 1);
}

function pathPart(value) {
  const end = value.search(PATH_END);
  return end === -1 ? value : value.slice(0, end);
}

function objectOrEmpty(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pathTemplate(path) {
  return path
    .split('/')
    .map((segment) => (PATH_SEGMENT_ID.test(segment) ? '{id}' : segment))
    .join('/');
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
