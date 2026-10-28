
export const EVIDENCE_ID_PATTERN = /^ev_[a-f0-9]{64}$/;
export const CONFIDENCES = new Set(['observed', 'derived', 'inferred']);
export const AUTHORITIES = new Set(['shipped-artifact', 'controlled-replay', 'historical-reference', 'external-service', 'analyst-inference']);
export const PREDICATE_TYPES = new Set([
  'rea.analysis',
  'rea.javascript-application-analysis',
  'rea.residual-unknown-mutation',
  'rea.artifact-comparison',
  'rea.bundle-comparison',
  'rea.managed-member-comparison',
  'rea.javascript-export-shape-comparison',
  'rea.javascript-application-version-comparison',
  'rea.application-version-comparison',
  'rea.source-to-bundle-comparison',
  'rea.web-script-export',
  'rea.apple-application-graph',
  'rea.reverse-engineering.command-observation',
]);

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const isSubject = (value) => {
  if (!isObject(value)) return false;
  if (typeof value.name !== 'string' || typeof value.format !== 'string') return false;
  if (value.architecture !== null && typeof value.architecture !== 'string') return false;
  if (value.local_path !== null && typeof value.local_path !== 'string') return false;
  if (!isObject(value.digest) || typeof value.digest.sha256 !== 'string') return false;
  return true;
};

const isProvider = (value) => {
  if (!isObject(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  return value.version === null || typeof value.version === 'string';
};

const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

export const evidenceContractFailure = (value, side = 'pi-rea') => {
  if (!isObject(value)) return 'not an object';
  if (typeof value.evidence_id !== 'string' || !EVIDENCE_ID_PATTERN.test(value.evidence_id)) return 'evidence_id';
  if (side === 'pi-rea') {
    if (!PREDICATE_TYPES.has(value.predicate_type)) return 'predicate_type';
  } else if (typeof value.predicate_type !== 'string' || !value.predicate_type.startsWith('rea.')) {
    return 'predicate_type';
  }
  if (typeof value.operation !== 'string' || value.operation.length === 0) return 'operation';
  if (!isObject(value.parameters)) return 'parameters';
  if (!CONFIDENCES.has(value.confidence)) return 'confidence';
  if (!AUTHORITIES.has(value.authority)) return 'authority';
  if (value.subject !== null && !isSubject(value.subject)) return 'subject';
  if (!isProvider(value.provider)) return 'provider';
  if (!isStringArray(value.limitations)) return 'limitations';
  if (!Array.isArray(value.locations) || !value.locations.every(isObject)) return 'locations';
  if (!isStringArray(value.evidence_links)) return 'evidence_links';
  if (!('raw_result' in value)) return 'raw_result';
  if (!('normalized_result' in value)) return 'normalized_result';
  return null;
};

export const isErrorEnvelope = (value) =>
  isObject(value) && typeof value.code === 'string' && typeof value.category === 'string' && typeof value.message === 'string';
