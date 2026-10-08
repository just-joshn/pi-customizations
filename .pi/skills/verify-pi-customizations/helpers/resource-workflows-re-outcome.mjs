export function evaluateRe(facts) {
  const eligible = facts?.invocation?.error === null && facts?.evidence?.present?.length === 7 && facts?.evidence?.replayCode === 0;
  return { eligible, verdict: 'inconclusive', manualReview: 'pending', missing: [] };
}
