/**
 * Offline reader for HAR 1.x network captures.
 *
 * The reader is a pure function of an already-parsed document. It opens no
 * socket, never re-reads the capture file, and never re-emits credential header
 * values: those become a marker and are reported by name only. A record's
 * `ordinal` is its position in `log.entries`, so a caller that later slices or
 * pages the returned records still cites the original capture.
 */

const ENTRY_CAP = 5000;
const REDACTED = '[redacted]';
const ABSOLUTE_URL = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\//;
const VERSION = /^1\.\d+$/;
const AUTHORITY_END = /[/?#]/;
const PATH_END = /[?#]/;
const PATH_SEGMENT_ID = /^(?:\d+|[0-9a-fA-F]{8,})$/;
const CREDENTIAL_NAME_PARTS = ['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'token', 'secret', 'api-key', 'apikey', 'auth', 'key', 'credential', 'signature', 'access-key', 'password', 'passwd', 'session-id'];
/** Query parameter names whose value is a credential rather than evidence about the request line. */
const CREDENTIAL_QUERY_PARTS = ['token', 'secret', 'key', 'password', 'passwd', 'sig', 'signature', 'auth', 'credential', 'session'];
const HAR_ERROR_CODES = new Set(['unsupported_version', 'malformed']);

const LIMITATIONS = Object.freeze([
  'This inspection is offline: the capture was read as an already-parsed document and no recorded URL was requested, resolved, or contacted.',
  'Recorded payloads are historical capture artifacts, not live traffic observed during this inspection.',
  'Credential header values are deliberately absent from this result; only the affected header names are reported.',
]);

/** A refused capture. `code` is `unsupported_version` or `malformed`. */
export class HarError extends Error {
  constructor(code, message) {
    if (!HAR_ERROR_CODES.has(code)) throw new TypeError(`unknown HarError code: ${code}`);
    super(message);
    this.name = 'HarError';
    this.code = code;
  }
}

/**
 * Read a parsed HAR 1.x document. Response text is never copied: a recorded
 * body is reported as `recorded` with its size, so no result implies that this
 * reader observed live traffic.
 */
export function readHarCapture(document) {
  const { log, version } = requireLog(document);
  const entries = log.entries;
  const truncated = entries.length > ENTRY_CAP;
  const retained = truncated ? entries.slice(0, ENTRY_CAP) : entries;
  return {
    version,
    creator: readCreator(log.creator),
    records: retained.map((record, ordinal) => readEntry(record, ordinal)),
    coverage: readCoverage(entries.length, truncated),
    limitations: [...LIMITATIONS],
  };
}

/**
 * Group records into the observed interface surface: one entry per method,
 * origin and path template, citing the original ordinals. Format matches are
 * inferences about shape, not handler identity.
 */
export function apiSurface(records) {
  if (!Array.isArray(records)) throw new HarError('malformed', 'apiSurface expects the records array returned by readHarCapture.');
  const groups = new Map();
  for (const record of records) {
    if (!Number.isInteger(record?.ordinal)) throw new HarError('malformed', 'apiSurface expects every record to carry an integer ordinal.');
    const method = typeof record.method === 'string' ? record.method : '';
    const origin = typeof record.origin === 'string' ? record.origin : '';
    const template = pathTemplate(typeof record.path === 'string' ? record.path : '');
    const key = `${method}\u0000${origin}\u0000${template}`;
    const existing = groups.get(key);
    const group = existing === undefined ? { method, origin, path_template: template, ordinals: [], observations: 0 } : existing;
    groups.set(key, { ...group, ordinals: [...group.ordinals, record.ordinal], observations: group.observations + 1 });
  }
  return [...groups.values()].sort((left, right) => compareText(left.method, right.method) || compareText(left.origin, right.origin) || compareText(left.path_template, right.path_template));
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
  if (creator === null || typeof creator !== 'object' || Array.isArray(creator)) return null;
  return {
    name: typeof creator.name === 'string' ? creator.name : null,
    version: typeof creator.version === 'string' ? creator.version : null,
  };
}

function readEntry(entry, ordinal) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new HarError('malformed', `log.entries[${ordinal}] is not an object.`);
  const request = objectOrEmpty(entry.request);
  const response = objectOrEmpty(entry.response);
  const content = objectOrEmpty(response.content);
  const requestHeaders = readHeaders(request.headers);
  const responseHeaders = readHeaders(response.headers);
  const link = readUrl(request.url);
  const recorded = typeof content.text === 'string';
  return {
    ordinal,
    method: typeof request.method === 'string' ? request.method : '',
    url: link.url,
    origin: link.origin,
    path: link.path,
    status: statusOf(response.status),
    mime_type: typeof content.mimeType === 'string' ? content.mimeType : null,
    request_headers: requestHeaders.headers,
    response_headers: responseHeaders.headers,
    credential_headers_present: mergeCredentialNames(requestHeaders.names, responseHeaders.names),
    request_bytes: requestBytes(request),
    response_bytes: responseBytes(response, content),
    response_body: recorded ? 'recorded' : 'absent',
    response_body_size: recorded ? content.text.length : null,
    started_date_time: typeof entry.startedDateTime === 'string' ? entry.startedDateTime : null,
    duration_ms: durationOf(entry.time),
  };
}

function readHeaders(rawHeaders) {
  const headers = [];
  const names = [];
  if (!Array.isArray(rawHeaders)) return { headers, names };
  for (const raw of rawHeaders) {
    if (raw === null || typeof raw !== 'object') continue;
    const name = typeof raw.name === 'string' ? raw.name : '';
    if (isCredentialHeaderName(name)) {
      headers.push({ name, value: REDACTED });
      names.push(name.toLowerCase().trim());
    } else {
      headers.push({ name, value: typeof raw.value === 'string' ? raw.value : '' });
    }
  }
  return { headers, names };
}

function isCredentialHeaderName(name) {
  const lower = name.toLowerCase().trim();
  const compact = lower.replace(/[-_]/g, '');
  return CREDENTIAL_NAME_PARTS.some((part) => lower.includes(part) || compact.includes(part.replace(/[-_]/g, '')));
}

function mergeCredentialNames(...nameLists) {
  return [...new Set(nameLists.flat())].sort(compareText);
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
  return { url: `${prefix}${hostPort}${redactQuery(remainder)}`, origin: `${match[1]}//${hostPort}`, path: pathPart(remainder) };
}

/**
 * Query values stay in the record because they are part of the observed request
 * line, except where the parameter name says the value is a credential rather
 * than evidence about the request.
 */
function redactQuery(remainder) {
  const queryStart = remainder.indexOf('?');
  if (queryStart === -1) return remainder;
  const hashStart = remainder.indexOf('#');
  const query = remainder.slice(queryStart + 1, hashStart === -1 ? remainder.length : hashStart);
  const fragment = hashStart === -1 ? '' : remainder.slice(hashStart);
  const redacted = query
    .split('&')
    .map((pair) => {
      const equals = pair.indexOf('=');
      if (equals === -1) return pair;
      const name = pair.slice(0, equals);
      const lower = name.toLowerCase();
      return CREDENTIAL_QUERY_PARTS.some((part) => lower.includes(part)) ? `${name}=[redacted]` : pair;
    })
    .join('&');
  return `${remainder.slice(0, queryStart)}?${redacted}${fragment}`;
}

function stripUserinfo(authority) {
  const at = authority.lastIndexOf('@');
  return at === -1 ? authority : authority.slice(at + 1);
}

function pathPart(value) {
  const end = value.search(PATH_END);
  return end === -1 ? value : value.slice(0, end);
}

function requestBytes(request) {
  const recorded = nonNegativeInteger(request.bodySize);
  if (recorded !== null) return recorded;
  const text = objectOrEmpty(request.postData).text;
  return typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : 0;
}

function responseBytes(response, content) {
  const recorded = nonNegativeInteger(response.bodySize) ?? nonNegativeInteger(content.size);
  if (recorded !== null) return recorded;
  return typeof content.text === 'string' ? Buffer.byteLength(content.text, 'utf8') : 0;
}

function readCoverage(total, truncated) {
  if (!truncated) return { status: 'complete', truncated: false, omitted_count: null, limits: [] };
  const omitted = total - ENTRY_CAP;
  return {
    status: 'partial',
    truncated: true,
    omitted_count: omitted,
    limits: [`The reader retains at most ${ENTRY_CAP} log entries; ${omitted} of ${total} recorded entries were omitted.`],
  };
}

function pathTemplate(path) {
  return path
    .split('/')
    .map((segment) => (PATH_SEGMENT_ID.test(segment) ? '{id}' : segment))
    .join('/');
}

function objectOrEmpty(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** HAR uses 0 for a status that was not recorded, which is not an observed status. */
function statusOf(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** HAR uses -1 for an unknown duration, which is not an observed duration. */
function durationOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
