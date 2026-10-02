const kinds = new Set(['behavior', 'fact', 'defect', 'index']);
const verdicts = new Set(['verified', 'gap', 'external', 'unaudited']);
const unresolved = new Set(['gap', 'external', 'unaudited']);
const minimumQuote = 15;

export const isUnresolved = (clause) => unresolved.has(clause.verdict);

export function contentLines(text) {
  let fence;
  return text.split('\n').flatMap((line, index) => {
    const trimmed = line.trim();
    const marker = /^(```+|~~~+)/.exec(trimmed)?.[1][0];
    if (marker) {
      fence = fence === marker ? undefined : (fence ?? marker);
      return [];
    }
    if (!trimmed || /^\|?[\s:|-]+\|?$/.test(trimmed) || (!fence && /^#{1,6}\s/.test(trimmed))) return [];
    return [index + 1];
  });
}

function checkShape(check) {
  if (!check || typeof check !== 'object') return 'is not an object';
  if (check.type === 'quote' || check.type === 'source') {
    if (typeof check.path !== 'string' || !check.path.trim()) return 'has no path';
    if (typeof check.quote !== 'string' || check.quote.replace(/\s/g, '').length < minimumQuote) return `quotes fewer than ${minimumQuote} characters`;
    return undefined;
  }
  if (check.type === 'file' || check.type === 'source-file') return typeof check.path === 'string' && check.path.trim() ? undefined : 'has no path';
  if (check.type === 'test')
    return typeof check.path === 'string' && typeof check.name === 'string' && check.name.trim() && [undefined, 'bun', 'journey'].includes(check.runner) ? undefined : 'needs a test path, full name, and known runner';
  if (check.type === 'commit') return typeof check.rev === 'string' && /^[0-9a-f]{7,40}$/.test(check.rev) ? undefined : 'needs a commit rev';
  return `has unknown type ${String(check.type)}`;
}

const native = (types) => types.has('quote') || types.has('test') || types.has('file');
const provenance = (types) => types.has('source') || types.has('commit') || types.has('source-file');
const kindRules = {
  behavior: (types, clause) => [!native(types) && 'needs a native quote or test check', clause.runtime && !types.has('test') && 'is runtime behavior without a test check'],
  fact: (types) => [!provenance(types) && 'needs a source or commit check'],
  defect: (types, clause) => [!provenance(types) && 'needs a source or commit check', !native(types) && 'needs a native check showing how Pi handles it', !clause.note?.trim() && 'needs a note'],
  index: (_types, clause) => [!clause.note?.trim() && 'needs a note'],
};

export function auditClause(clause, range) {
  const id = typeof clause?.id === 'string' ? clause.id : '<unnamed>';
  const findings = [];
  const add = (message) => message && findings.push(`${id} ${message}.`);
  if (!/^L\d+\.\d+$/.test(id)) add('has an invalid identity');
  const [first, last] = Array.isArray(clause?.lines) ? clause.lines : [];
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last || first < range.from || last > range.to) add('has a span outside its slice');
  if (typeof clause?.requirement !== 'string' || !clause.requirement.trim()) add('has no requirement');
  if (!kinds.has(clause?.kind)) add('has no valid kind');
  if (!verdicts.has(clause?.verdict)) add('has no valid verdict');
  const checks = Array.isArray(clause?.checks) ? clause.checks : [];
  for (const check of checks) add(checkShape(check) && `check ${checkShape(check)}`);
  if (unresolved.has(clause?.verdict) && clause.verdict !== 'unaudited' && !clause.note?.trim()) add(`is ${clause.verdict} without a note`);
  if (clause?.verdict === 'verified' && kinds.has(clause.kind)) for (const message of kindRules[clause.kind](new Set(checks.map((check) => check?.type)), clause)) add(message);
  return findings;
}

export function auditSlice(slice, clauses, covered) {
  const findings = [];
  const ids = new Set();
  const lines = new Set();
  for (const clause of clauses) {
    if (ids.has(clause.id)) findings.push(`Duplicate clause ${clause.id}.`);
    ids.add(clause.id);
    findings.push(...auditClause(clause, slice));
    const [first, last] = clause.lines ?? [];
    for (let line = first; Number.isInteger(first) && line <= last; line += 1) lines.add(line);
  }
  const missing = covered.filter((line) => line >= slice.from && line <= slice.to && !lines.has(line));
  if (missing.length) findings.push(`${slice.id} leaves ${missing.length} reference lines without a clause: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ', ...' : ''}.`);
  return findings;
}

export function reusedQuotes(clauses, limit) {
  const uses = new Map();
  for (const clause of clauses) {
    for (const check of clause.checks ?? []) {
      if (check?.type !== 'quote') continue;
      const key = `${check.path}\u0000${normalize(check.quote)}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  return [...uses].filter(([, count]) => count > limit).map(([key, count]) => `${key.split('\u0000')[0]} quote "${key.split('\u0000')[1].slice(0, 60)}" backs ${count} clauses; cite clause-specific evidence.`);
}

export const normalize = (text) => text.replace(/\s+/g, ' ').trim();
