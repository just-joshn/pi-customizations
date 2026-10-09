const RULES = [
  (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  (a, b) => b.ageMs - a.ageMs,
  (a, b) => String(a.id).localeCompare(String(b.id)),
];

export function pickNext(jobs) {
  const open = (jobs ?? []).filter((j) => !j.done);
  open.sort((a, b) => RULES.reduce((r, rule) => r || rule(a, b), 0));
  return open[0]?.id ?? null;
}
