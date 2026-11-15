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


STREAM_METRICS = [
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
    ("Clean idle CPU ms over 10 s, no sampler", lambda r: r["cleanIdle"]["cpuUserMs"] + r["cleanIdle"]["cpuSystemMs"]),
    ("Clean idle involuntary context switches", lambda r: r["cleanIdle"]["involuntaryContextSwitches"]),
    ("PTY bytes, clean idle 10 s", lambda r: r["pty"]["cleanIdleBytes"]),
    ("Tool results", lambda r: r["toolResults"]),
    ("Tool errors", lambda r: r["toolErrors"]),
    ("Workload wall ms", lambda r: r["workload"]["wallMs"]),
]
LONG_STEPS = ["startup", "narrow", "wide", "expand", "collapse", "storm"]
LONG_METRICS = [
    ("Process CPU ms (user+sys), whole run", lambda r: r["cpuMs"]["user"] + r["cpuMs"]["sys"]),
    ("Collapsed echo latency p50 ms", lambda r: percentile(r["collapsedEcho"]["latenciesMs"], 50)),
    ("Collapsed echo latency p95 ms", lambda r: percentile(r["collapsedEcho"]["latenciesMs"], 95)),
    ("Collapsed echo latency max ms", lambda r: max(r["collapsedEcho"]["latenciesMs"])),
    ("Collapsed echo misses", lambda r: r["collapsedEcho"]["misses"]),
    ("Burst of 50 keys, ms to full echo", lambda r: r["burst"]["ms"]),
    ("Burst PTY bytes", lambda r: r["burst"]["bytes"]),
    ("Burst echoed", lambda r: int(r["burst"]["echoed"])),
    ("Expanded echo latency p50 ms", lambda r: percentile(r["echo"]["latenciesMs"], 50)),
    ("Expanded echo latency p95 ms", lambda r: percentile(r["echo"]["latenciesMs"], 95)),
    ("Expanded echo misses", lambda r: r["echo"]["misses"]),
    *[(f"{step} settle ms", lambda r, step=step: r["steps"][step]["ms"]) for step in LONG_STEPS],
    *[(f"{step} PTY bytes", lambda r, step=step: r["steps"][step]["bytes"]) for step in LONG_STEPS],
    ("Exit PTY bytes", lambda r: r["exitBytes"]),
    ("Steps with output", lambda r: sum(step["output"] for step in r["steps"].values())),
]
STARTUP_METRICS = [
    ("First settled frame ms", lambda r: r["startup"]["ms"]),
    ("First frame PTY bytes", lambda r: r["startup"]["bytes"]),
    ("Process CPU ms (user+sys), spawn to exit", lambda r: r["cpuMs"]["user"] + r["cpuMs"]["sys"]),
    ("Exit PTY bytes", lambda r: r["exitBytes"]),
    ("PI_TIMING main TOTAL ms", lambda r: r["timingsMs"]["main"]["TOTAL"]),
    ("PI_TIMING createAgentSessionRuntime ms", lambda r: r["timingsMs"]["main"]["createAgentSessionRuntime"]),
    ("PI_TIMING initTheme ms", lambda r: r["timingsMs"]["main"]["initTheme"]),
    ("PI_TIMING interactiveMode.init ms", lambda r: r["timingsMs"]["main"]["interactiveMode.init"]),
    ("PI_TIMING extensions TOTAL ms", lambda r: r["timingsMs"]["extensions"]["TOTAL"]),
    ("PI_STARTUP_BENCHMARK process CPU ms", lambda r: r["timingCpuMs"]["user"] + r["timingCpuMs"]["sys"]),
]
METRICS = {"stream": STREAM_METRICS, "medium": STREAM_METRICS, "long": LONG_METRICS, "mixed": LONG_METRICS, "startup": STARTUP_METRICS}


def present(metric, records: list[dict]) -> bool:
    try:
        for record in records:
            metric[1](record)
    except (KeyError, ValueError):
        return False
    return True


def cell(values: list[float]) -> str:
    integral = all(float(v).is_integer() for v in values)
    magnitude = max(abs(v) for v in values)
    digits = 0 if integral or magnitude >= 100 else 1 if magnitude >= 10 else 2
    return f"{statistics.median(values):.{digits}f} ({min(values):.{digits}f}..{max(values):.{digits}f})"


def table(runs: dict[str, list[dict]], failed: dict[str, int], metrics: list) -> None:
    configs = [c for c in CONFIG_ORDER if c in runs] + sorted(set(runs) - set(CONFIG_ORDER))
    print("Median (min..max) per config.\n")
    print("| Metric | " + " | ".join(f"{c} (n={len(runs[c])}, failed={failed[c]}, problems={sum('problems' in r for r in runs[c])})" for c in configs) + " |")
    print("|---|" + "---|" * len(configs))
    for name, extract in metrics:
        print(f"| {name} | " + " | ".join(cell([extract(r) for r in runs[c]]) for c in configs) + " |")
    others = [c for c in configs if c != BASELINE]
    if BASELINE not in runs or not others:
        return
    baseline = {r["round"]: r for r in runs[BASELINE]}
    print(f"\nPaired by round: config minus {BASELINE}, median (min..max), and rounds where the config was lower.\n")
    print("| Metric | " + " | ".join(others) + " |")
    print("|---|" + "---|" * len(others))
    for name, extract in metrics:
        cells = []
        for config in others:
            deltas = [extract(r) - extract(baseline[r["round"]]) for r in runs[config] if r["round"] in baseline]
            cells.append(f"{cell(deltas)}, lower {sum(d < 0 for d in deltas)}/{len(deltas)}")
        print(f"| {name} | " + " | ".join(cells) + " |")


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize run.py results as Markdown tables, one section per workload.")
    parser.add_argument("results", nargs="?", default="results.jsonl")
    args = parser.parse_args()
    runs: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    failed: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    with open(args.results) as handle:
        for line in handle:
            record = json.loads(line)
            workload = record.get("workloadName", "stream")
            if "error" in record:
                failed[workload][record["config"]] += 1
            else:
                runs[workload][record["config"]].append(record)
    for workload in [w for w in METRICS if w in runs or w in failed]:
        print(f"### {workload} workload\n")
        records = [record for group in runs[workload].values() for record in group]
        metrics = [metric for metric in METRICS[workload] if present(metric, records)]
        table(runs[workload], failed[workload], metrics)
        print()


if __name__ == "__main__":
    main()
