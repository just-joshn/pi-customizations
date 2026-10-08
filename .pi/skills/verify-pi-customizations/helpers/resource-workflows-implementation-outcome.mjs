const ids = ['help', 'version', 'greeting', 'empty-name', 'unicode', 'invalid'];
const exactIds = (values) => Array.isArray(values) && values.length === ids.length && new Set(values).size === ids.length && ids.every((id) => values.includes(id));

export function differentialInvocation(command) {
  if (typeof command !== 'string' || /[\n\r;|&`$<>]/.test(command)) return null;
  const tokens = command.match(/"[^"\\]*"|'[^']*'|[^\s"']+/g)?.map((token) => token.replace(/^(?:"(.*)"|'(.*)')$/, '$1$2')) ?? [];
  if (tokens.length !== 10 || !/^(?:.*\/)?python3?$/.test(tokens[0]) || !tokens[1].endsWith('/differential.py') || tokens[2] !== 'run') return null;
  const options = Object.fromEntries([
    [tokens[4], tokens[5]],
    [tokens[6], tokens[7]],
    [tokens[8], tokens[9]],
  ]);
  return options['--reference'] && options['--candidate'] && options['--out'] ? { driver: tokens[1], cases: tokens[3], reference: options['--reference'], candidate: options['--candidate'], out: options['--out'] } : null;
}

export function evaluateImplementation(facts) {
  const execution = facts?.execution?.differential;
  const results = facts?.results;
  const report = facts?.evidence?.report;
  const map = facts?.evidence?.map;
  const links = facts?.evidence?.mapLinks;
  const checks = [
    ['invocation', facts?.invocation?.error === null],
    ['reference captured before candidate', facts?.evidence?.capturedBeforeInvocation === true && facts.evidence.candidateAbsentAtCapture === true],
    [
      'independent six-case packaged comparison',
      results?.comparison?.allMatched === true && Array.isArray(results.comparison.cases) && exactIds(results.comparison.cases.map((item) => item?.id)) && results.comparison.cases.every((item) => item.matched === true),
    ],
    [
      'successful identified differential execution',
      execution?.code === 0 &&
        execution.signal === null &&
        execution.error === null &&
        execution.reference === results?.reference &&
        execution.candidate === results?.candidate &&
        execution.cases === results?.cases &&
        exactIds(execution.ids) &&
        execution.matched === true,
    ],
    [
      'agent compatibility report',
      facts?.evidence?.reportAbsentBeforeInvocation === true &&
        typeof results?.referenceSha256 === 'string' &&
        typeof results?.artifactSha256 === 'string' &&
        report?.reference?.sha256 === results.referenceSha256 &&
        report?.candidate?.artifact_sha256 === results.artifactSha256 &&
        report?.cases?.total === 6 &&
        report.cases.passed === 6 &&
        report.cases.failed === 0 &&
        Array.isArray(report.intentional_differences) &&
        report.intentional_differences.length === 0,
    ],
    [
      'agent six-case evidence map',
      facts?.evidence?.mapAbsentBeforeInvocation === true &&
        Array.isArray(map) &&
        exactIds(map.map((item) => item?.case)) &&
        map.every((item) => ['behavior', 'implementation', 'test', 'probe'].every((key) => typeof item[key] === 'string' && item[key].trim().length > 0)),
    ],
  ];
  const linked =
    Array.isArray(links) &&
    exactIds(links.map((item) => item?.case)) &&
    links.every((item) => item.implementationPresent === true && item.testId === item.case && item.probeId === item.case && item.referenceSha256 === results?.referenceSha256);
  const missing = [...checks, ['resolved evidence-map links', linked]].filter(([, passed]) => !passed).map(([name]) => name);
  return { eligible: missing.length === 0, verdict: 'failed', missing, reason: missing.length ? `Unproven implementation requirements: ${missing.join(', ')}.` : 'Positive runtime controls and independent audit are still required.' };
}
