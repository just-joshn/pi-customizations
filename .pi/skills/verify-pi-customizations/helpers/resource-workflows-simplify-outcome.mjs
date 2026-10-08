const angles = ['reuse', 'simplification', 'efficiency', 'altitude'];
const succeeded = (result) => result?.code === 0 && result.signal === null && result.error === null;

export function evaluateSimplify(facts) {
  const reviewers = facts?.evidence?.reviewers ?? [];
  const validReviews =
    reviewers.length === 4 &&
    new Set(reviewers.map((item) => item.id)).size === 4 &&
    angles.every((angle) => reviewers.filter((item) => item.angle === angle).length === 1) &&
    reviewers.every(
      (item) =>
        item.owned === true &&
        item.readonly === true &&
        item.successful === true &&
        typeof item.transcript === 'string' &&
        item.transcript.length > 0 &&
        typeof item.findings === 'string' &&
        item.findings.trim().length > 0 &&
        Number.isFinite(item.startedAt) &&
        Number.isFinite(item.endedAt) &&
        item.startedAt < item.endedAt &&
        Number.isFinite(item.findingsAt) &&
        item.findingsAt >= item.endedAt,
    );
  const overlap = validReviews && Math.max(...reviewers.map((item) => item.startedAt)) < Math.min(...reviewers.map((item) => item.endedAt));
  const ordering =
    facts?.evidence?.orderingComplete === true && (facts.evidence.firstEditAt === null || (Number.isFinite(facts.evidence.firstEditAt) && validReviews && reviewers.every((item) => item.findingsAt < facts.evidence.firstEditAt)));
  const checks = [
    ['invocation', facts?.invocation?.error === null],
    ['test execution', succeeded(facts?.execution?.tests)],
    ['unchanged test expectations', facts?.results?.testsUnchanged === true],
    ['literal greeting results', succeeded(facts?.execution?.greeting) && facts.execution.greeting.stdout === '["Hello Ada","Hello "]\n' && facts.execution.greeting.stderr === ''],
    ['four owned successful readonly reviews', validReviews],
    ['actual review interval overlap', overlap],
    ['findings before edits', ordering],
  ];
  const missing = checks.filter(([, passed]) => !passed).map(([name]) => name);
  return { eligible: missing.length === 0, verdict: 'failed', missing, reason: missing.length ? `Unproven simplify requirements: ${missing.join(', ')}.` : 'Positive runtime controls and independent audit are still required.' };
}
