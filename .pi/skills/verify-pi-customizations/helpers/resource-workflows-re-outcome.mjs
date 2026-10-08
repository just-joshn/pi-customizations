export const reContracts = Object.freeze([
  Object.freeze({ args: Object.freeze(['--help']), stdout: 'Usage: greet hello NAME\n', stderr: '', code: 0 }),
  Object.freeze({ args: Object.freeze(['--version']), stdout: 'greet 1.0.0\n', stderr: '', code: 0 }),
  Object.freeze({ args: Object.freeze(['hello', 'Ada']), stdout: 'Hello Ada\n', stderr: '', code: 0 }),
  Object.freeze({ args: Object.freeze([]), stdout: '', stderr: 'Usage: greet hello NAME\n', code: 2 }),
]);

function literalObservations(observations) {
  return (
    Array.isArray(observations) &&
    observations.length === 4 &&
    reContracts.every((contract) => {
      const matches = observations.filter((item) => JSON.stringify(item?.args) === JSON.stringify(contract.args));
      return matches.length === 1 && matches.every((item) => item.stdout === contract.stdout && item.stderr === contract.stderr && item.code === contract.code && item.signal === null && item.error === null);
    })
  );
}

export function evaluateRe(facts) {
  const evidence = facts?.evidence;
  const checks = [
    ['owned attempt', typeof evidence?.attemptId === 'string' && evidence.attemptId.length > 0],
    ['invocation', facts?.invocation?.error === null],
    ['explicit provenance', ['genuine', 'scripted-control'].includes(facts?.origin)],
    ['frozen executable identity', evidence?.identityMatches === true],
    ['literal independent streams and statuses', literalObservations(evidence?.observations)],
    ['reviewed four-behavior corpus with exact expectations', evidence?.corpusComplete === true],
    ['actual replay', evidence?.replayCode === 0 && literalObservations(evidence?.replayObservations)],
    ['source entrypoint and command tree', evidence?.sourceMatches === true],
    ['report claim links to actual observations', evidence?.reportsLinked === true],
    ['collection gaps', Array.isArray(evidence?.issues) && evidence.issues.length === 0],
  ];
  const missing = checks.filter(([, passed]) => !passed).map(([name]) => name);
  return {
    eligible: missing.length === 0,
    verdict: 'failed',
    missing,
    manualReview: 'pending',
    genuineCompliance: false,
    reason: missing.length ? `Unproven RE requirements: ${missing.join(', ')}.` : 'Bounded evidence is eligible for independent root semantic review. Source approval and genuine compliance remain withheld.',
  };
}
