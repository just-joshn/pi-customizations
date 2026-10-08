export function evaluateDoctor(facts) {
  const reportReady = ['health', 'trust', 'cleanup', 'offline'].every((word) => facts?.report?.text?.toLowerCase().includes(word)) && facts?.trustUnchanged === true;
  return { reportReady, eligible: reportReady, verdict: 'failed', missing: reportReady ? [] : ['report'] };
}
