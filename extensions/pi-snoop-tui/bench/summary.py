#!/usr/bin/env python3
"""Print the stock comparison summary: medians, paired differences, and both verdicts for each headline metric."""
import argparse
import json
import statistics

from report import percentile

STREAM = [
    ("Workload CPU ms", lambda r: r["workload"]["cpuUserMs"] + r["workload"]["cpuSystemMs"]),
    ("Echo p50 ms", lambda r: percentile(r["echo"]["latenciesMs"], 50)),
    ("Workload PTY bytes", lambda r: r["pty"]["workloadBytes"]),
    ("Clean idle CPU ms", lambda r: r["cleanIdle"]["cpuUserMs"] + r["cleanIdle"]["cpuSystemMs"]),
]
RESTORED = [
    ("Whole-run CPU ms", lambda r: r["cpuMs"]["user"] + r["cpuMs"]["sys"]),
    ("Restore (startup settle) ms", lambda r: r["steps"]["startup"]["ms"]),
    ("Collapsed echo p50 ms", lambda r: percentile(r["collapsedEcho"]["latenciesMs"], 50)),
    ("Collapsed echo p95 ms", lambda r: percentile(r["collapsedEcho"]["latenciesMs"], 95)),
    ("Burst of 50 keys ms", lambda r: r["burst"]["ms"]),
    ("Resize narrow ms", lambda r: r["steps"]["narrow"]["ms"]),
    ("Resize wide ms", lambda r: r["steps"]["wide"]["ms"]),
    ("Resize storm ms", lambda r: r["steps"]["storm"]["ms"]),
    ("Expand ms", lambda r: r["steps"]["expand"]["ms"]),
    ("Expanded echo p50 ms", lambda r: percentile(r["echo"]["latenciesMs"], 50)),
    ("Collapse ms", lambda r: r["steps"]["collapse"]["ms"]),
]
METRICS = {
    "startup": [("Process CPU ms, spawn to exit", lambda r: r["cpuMs"]["user"] + r["cpuMs"]["sys"]), ("First settled frame ms", lambda r: r["startup"]["ms"])],
    "stream": STREAM,
    "medium": STREAM,
    "long": RESTORED,
    "mixed": RESTORED,
}
# Rounds out of n that one side must win for a one-sided sign test at p < 0.07.
SIGN_THRESHOLD = {15: 13, 9: 7, 7: 6, 5: 5}


def num(value: float) -> str:
    if float(value).is_integer() and abs(value) >= 100:
        return f"{value:.0f}"
    digits = 0 if abs(value) >= 100 else 1 if abs(value) >= 10 else 2
    return f"{value:.{digits}f}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", help="label=results.jsonl; the label names the scenario, the workload comes from the records")
    parser.add_argument("--config", default="full")
    parser.add_argument("--baseline", default="stock")
    args = parser.parse_args()
    print(f"| Scenario | Metric | {args.baseline} median | {args.config} median | {args.config}-{args.baseline} paired median (min..max) | rounds {args.config} lower | change of medians | verdict (a) strict | verdict (b) sign test |")
    print("|---|---|---|---|---|---|---|---|---|")
    for spec in args.files:
        label, path = spec.split("=", 1)
        records = [json.loads(line) for line in open(path)]
        workload = records[0].get("workloadName", "stream")
        side = {name: {r["round"]: r for r in records if r["config"] == name} for name in (args.baseline, args.config)}
        rounds = sorted(set(side[args.baseline]) & set(side[args.config]))
        for name, extract in METRICS[workload]:
            base = [extract(side[args.baseline][i]) for i in rounds]
            other = [extract(side[args.config][i]) for i in rounds]
            deltas = [o - b for o, b in zip(other, base)]
            lower, higher = sum(d < 0 for d in deltas), sum(d > 0 for d in deltas)
            strict = "faster" if max(deltas) < 0 else "slower" if min(deltas) > 0 else "no measurable difference"
            need = SIGN_THRESHOLD[len(rounds)]
            sign = "faster" if lower >= need else "slower" if higher >= need else "no measurable difference"
            change = statistics.median(other) / statistics.median(base) - 1
            print(f"| {label} | {name} | {num(statistics.median(base))} | {num(statistics.median(other))} | {num(statistics.median(deltas))} ({num(min(deltas))}..{num(max(deltas))}) | {lower}/{len(rounds)} | {change:+.1%} | {strict} | {sign} |")


if __name__ == "__main__":
    main()
