#!/usr/bin/env python3
import argparse
import json
from collections import defaultdict
from pathlib import Path

IDLE_FRAMES = {"(idle)", "(program)", "(garbage collector)"}


def self_times(profile: dict, window: tuple[float, float] | None) -> dict[tuple[str, str], float]:
    nodes = {node["id"]: node["callFrame"] for node in profile["nodes"]}
    totals: dict[tuple[str, str], float] = defaultdict(float)
    at = profile["startTime"]
    for node_id, delta in zip(profile["samples"], profile["timeDeltas"]):
        at += delta
        if window and not window[0] <= at <= window[1]:
            continue
        frame = nodes[node_id]
        location = f"{frame['url'].removeprefix('file://')}:{frame['lineNumber'] + 1}" if frame["url"] else ""
        totals[(frame["functionName"] or "(anonymous)", location)] += delta / 1000
    return totals


def main() -> None:
    parser = argparse.ArgumentParser(description="Top self-time functions across .cpuprofile files.")
    parser.add_argument("profile_dir")
    parser.add_argument("--top", type=int, default=15)
    parser.add_argument("--record", help="run.py JSONL whose last record's agent_start..agent_end window limits the samples")
    parser.add_argument("--match", default="pi-snoop-tui/src/", help="path fragment that marks extension code")
    args = parser.parse_args()
    window = None
    if args.record:
        record = json.loads(Path(args.record).read_text().strip().splitlines()[-1])
        window = (record["agentStartHrtimeUs"], record["agentEndHrtimeUs"])
    totals: dict[tuple[str, str], float] = defaultdict(float)
    files = sorted(Path(args.profile_dir).glob("*.cpuprofile"))
    for path in files:
        for key, ms in self_times(json.loads(path.read_text()), window).items():
            totals[key] += ms
    busy = {key: ms for key, ms in totals.items() if key[0] not in IDLE_FRAMES}
    busy_ms = sum(busy.values())
    scope = "agent_start..agent_end" if window else "whole process"
    print(f"{len(files)} profile(s), {scope}, {sum(totals.values()):.0f} ms sampled, {busy_ms:.0f} ms excluding {sorted(IDLE_FRAMES)}\n")
    print("| Self ms | Share of busy | Function | Location |")
    print("|---:|---:|---|---|")
    for (name, location), ms in sorted(busy.items(), key=lambda item: -item[1])[: args.top]:
        print(f"| {ms:.1f} | {ms / busy_ms:.1%} | `{name[:60]}` | `{Path(location).name if location else ''}` |")
    matched = {key: ms for key, ms in busy.items() if args.match in key[1]}
    matched_ms = sum(matched.values())
    print(f"\nFrames matching `{args.match}`: {len(matched)} functions, {matched_ms:.1f} ms self, {matched_ms / busy_ms:.2%} of busy time")
    for (name, location), ms in sorted(matched.items(), key=lambda item: -item[1])[:10]:
        print(f"- {ms:.1f} ms `{name}` `{Path(location).name}`")


if __name__ == "__main__":
    main()
