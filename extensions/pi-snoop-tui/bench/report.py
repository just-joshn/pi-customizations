#!/usr/bin/env python3
import argparse
import json
import statistics
from collections import defaultdict

CONFIG_ORDER = ["stock", "theme", "full"]
BASELINE = "stock"


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    rank = (len(ordered) - 1) * p / 100
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


METRICS = [
    ("Workload CPU ms (user+sys)", lambda r: r["workload"]["cpuUserMs"] + r["workload"]["cpuSystemMs"]),
    ("Idle CPU ms over 10 s", lambda r: r["idle"]["cpuUserMs"] + r["idle"]["cpuSystemMs"]),
    ("Workload event-loop delay p50 ms", lambda r: r["workload"]["eldP50Ms"]),
    ("Workload event-loop delay p99 ms", lambda r: r["workload"]["eldP99Ms"]),
    ("Idle event-loop delay p50 ms", lambda r: r["idle"]["eldP50Ms"]),
    ("Idle event-loop delay p99 ms", lambda r: r["idle"]["eldP99Ms"]),
    ("Echo latency p50 ms", lambda r: percentile(r["echo"]["latenciesMs"], 50)),
    ("Echo latency p95 ms", lambda r: percentile(r["echo"]["latenciesMs"], 95)),
    ("Echo misses", lambda r: r["echo"]["misses"]),
    ("PTY bytes, workload", lambda r: r["pty"]["workloadBytes"]),
    ("PTY bytes, idle 10 s", lambda r: r["pty"]["idleBytes"]),
    ("PTY bytes, idle after first 1 s", lambda r: r["pty"]["idleLateBytes"]),
    ("Tool results", lambda r: r["toolResults"]),
    ("Tool errors", lambda r: r["toolErrors"]),
    ("Workload wall ms", lambda r: r["workload"]["wallMs"]),
]


def cell(values: list[float]) -> str:
    integral = all(float(v).is_integer() for v in values)
    magnitude = max(abs(v) for v in values)
    digits = 0 if integral or magnitude >= 100 else 1 if magnitude >= 10 else 2
    return f"{statistics.median(values):.{digits}f} ({min(values):.{digits}f}..{max(values):.{digits}f})"


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize run.py results as a Markdown table.")
    parser.add_argument("results", nargs="?", default="results.jsonl")
    args = parser.parse_args()
    runs: dict[str, list[dict]] = defaultdict(list)
    failed: dict[str, int] = defaultdict(int)
    with open(args.results) as handle:
        for line in handle:
            record = json.loads(line)
            if "error" in record:
                failed[record["config"]] += 1
            else:
                runs[record["config"]].append(record)
    configs = [c for c in CONFIG_ORDER if c in runs] + sorted(set(runs) - set(CONFIG_ORDER))
    print("Median (min..max) per config.\n")
    print("| Metric | " + " | ".join(f"{c} (n={len(runs[c])}, failed={failed[c]})" for c in configs) + " |")
    print("|---|" + "---|" * len(configs))
    for name, extract in METRICS:
        print(f"| {name} | " + " | ".join(cell([extract(r) for r in runs[c]]) for c in configs) + " |")
    others = [c for c in configs if c != BASELINE]
    if BASELINE not in runs or not others:
        return
    baseline = {r["round"]: r for r in runs[BASELINE]}
    print(f"\nPaired by round: config minus {BASELINE}, median (min..max), and rounds where the config was lower.\n")
    print("| Metric | " + " | ".join(others) + " |")
    print("|---|" + "---|" * len(others))
    for name, extract in METRICS:
        cells = []
        for config in others:
            deltas = [extract(r) - extract(baseline[r["round"]]) for r in runs[config] if r["round"] in baseline]
            cells.append(f"{cell(deltas)}, lower {sum(d < 0 for d in deltas)}/{len(deltas)}")
        print(f"| {name} | " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main()
