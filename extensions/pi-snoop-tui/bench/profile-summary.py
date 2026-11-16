#!/usr/bin/env python3
import argparse
import sys
import bisect
import json
import re
from collections import defaultdict
from functools import cache
from pathlib import Path

IDLE_FRAMES = {"(idle)", "(program)", "(garbage collector)"}
CLASS_START = re.compile(r"\bclass(?:\s+([A-Za-z_$][\w$]*))?(?:\s+extends\s+[\w$.]+)?(?:\s+implements\s+[\w$.,\s<>]+)?\s*(?:<[^{]*>)?\s*\{")
CLASS_NAME_BEFORE = re.compile(r"([A-Za-z_$][\w$]*)\s*=\s*$")
REGEX_PREFIX = set("(,=:[!&|?{};+-*%<>~^")
REGEX_KEYWORDS = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"}


def brace_pairs(text: str) -> dict[int, int]:
    """Map each code `{` offset to its matching `}`, skipping strings, templates, comments, and regex literals."""
    pairs: dict[int, int] = {}
    stack: list[int] = []
    templates: list[int] = []
    i, n = 0, len(text)
    last = ""
    word = ""
    while i < n:
        c = text[i]
        if c in " \t\r\n":
            i += 1
            continue
        if c == "/" and text.startswith("//", i):
            i = text.find("\n", i)
            i = n if i < 0 else i
            continue
        if c == "/" and text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        if c == "/" and (last == "" or last in REGEX_PREFIX or word in REGEX_KEYWORDS):
            i += 1
            in_class = False
            while i < n and (text[i] != "/" or in_class):
                if text[i] == "\\":
                    i += 1
                elif text[i] == "[":
                    in_class = True
                elif text[i] == "]":
                    in_class = False
                elif text[i] == "\n":
                    break
                i += 1
            i += 1
            last, word = "/", ""
            continue
        if c in "'\"":
            i += 1
            while i < n and text[i] != c and text[i] != "\n":
                i += 2 if text[i] == "\\" else 1
            i += 1
            last, word = c, ""
            continue
        if c == "`" or (c == "}" and templates and templates[-1] == len(stack)):
            if c == "}":
                templates.pop()
            i += 1
            while i < n and text[i] != "`":
                if text[i] == "\\":
                    i += 2
                    continue
                if text.startswith("${", i):
                    templates.append(len(stack))
                    i += 2
                    break
                i += 1
            else:
                i += 1
            last, word = "`", ""
            continue
        if c == "{":
            stack.append(i)
        elif c == "}" and stack:
            pairs[stack.pop()] = i
        if c.isalnum() or c in "_$":
            j = i
            while j < n and (text[j].isalnum() or text[j] in "_$"):
                j += 1
            word = text[i:j]
            last = "w"
            i = j
            continue
        last, word = c, ""
        i += 1
    return pairs


@cache
def class_index(path: str) -> tuple[list[int], list[str], list[int], list[int]]:
    try:
        text = Path(path).read_text()
    except (OSError, UnicodeDecodeError):
        return [0], [], [], []
    line_starts = [0] + [m.end() for m in re.finditer("\n", text)]
    pairs = brace_pairs(text)
    spans = []
    for match in CLASS_START.finditer(text):
        open_at = match.end() - 1
        if open_at not in pairs:
            continue
        name = match.group(1)
        if not name:
            before = CLASS_NAME_BEFORE.search(text, max(0, match.start() - 80), match.start())
            name = before.group(1) if before else "(anonymous class)"
        spans.append((open_at, pairs[open_at], name))
    spans.sort()
    return line_starts, [s[2] for s in spans], [s[0] for s in spans], [s[1] for s in spans]


def owner_class(url: str, line: int, column: int) -> str | None:
    if not url.startswith("file://"):
        return None
    line_starts, names, starts, ends = class_index(url.removeprefix("file://"))
    if line >= len(line_starts):
        return None
    offset = line_starts[line] + column
    best = None
    for k in range(bisect.bisect_right(starts, offset) - 1, -1, -1):
        if starts[k] <= offset <= ends[k] and (best is None or starts[k] > starts[best]):
            best = k
    return names[best] if best is not None else None


def file_label(url: str) -> str:
    if not url:
        return "(native)"
    if "pi-snoop-tui/" in url:
        return "snoop:" + url.split("pi-snoop-tui/", 1)[1]
    if url.startswith("node:") or "/" not in url:
        return url
    return Path(url).name


def window_for(record: dict, phase: str) -> tuple[float, float]:
    provider = {
        "workload": ("agentStartHrtimeUs", "agentEndHrtimeUs"),
        "idle": ("agentEndHrtimeUs", "idleEndHrtimeUs"),
        "cleanIdle": ("idleEndHrtimeUs", "cleanIdleEndHrtimeUs"),
    }
    if phase in provider:
        start, end = provider[phase]
        return record[start], record[end]
    nested = {"typing": record.get("collapsedEcho"), "expandedTyping": record.get("echo"), "burst": record.get("burst"), "startup": record.get("startup") or record.get("steps", {}).get("startup")}
    source = nested.get(phase) or record.get("steps", {}).get(phase)
    if not source:
        raise SystemExit(f"phase {phase!r} not in record")
    return tuple(source["windowUs"])


def collect(profile: dict, window: tuple[float, float] | None, acc: dict, callers_of: str | None) -> None:
    nodes = {node["id"]: node for node in profile["nodes"]}
    parent = {child: node["id"] for node in profile["nodes"] for child in node.get("children", [])}
    owners: dict[int, list[str]] = {}

    def stack_classes(node_id: int) -> list[str]:
        if node_id not in owners:
            frame = nodes[node_id]["callFrame"]
            own = owner_class(frame["url"], frame["lineNumber"], frame["columnNumber"])
            above = stack_classes(parent[node_id]) if node_id in parent else []
            owners[node_id] = ([own] if own else []) + above
        return owners[node_id]

    at = profile["startTime"]
    for node_id, delta in zip(profile["samples"], profile["timeDeltas"]):
        at += delta
        if window and not window[0] <= at <= window[1]:
            continue
        frame = nodes[node_id]["callFrame"]
        ms = delta / 1000
        acc["total"] += ms
        name = frame["functionName"] or "(anonymous)"
        if name in IDLE_FRAMES:
            continue
        location = f"{frame['url'].removeprefix('file://')}:{frame['lineNumber'] + 1}" if frame["url"] else ""
        acc["functions"][(name, location)] += ms
        acc["files"][file_label(frame["url"])] += ms
        classes = stack_classes(node_id)
        acc["owners"][classes[0] if classes else f"(no class) {file_label(frame['url'])}"] += ms
        for cls in set(classes):
            acc["inclusive"][cls] += ms
        if callers_of and name == callers_of:
            chain, cursor = [], node_id
            while cursor in parent and len(chain) < 8:
                cursor = parent[cursor]
                caller = nodes[cursor]["callFrame"]
                chain.append(f"{caller['functionName'] or '(anonymous)'}@{file_label(caller['url'])}:{caller['lineNumber'] + 1}")
            acc["callers"][" < ".join(chain)] += ms


def table(title: str, rows: dict, busy_ms: float, top: int) -> None:
    print(f"\n{title}\n")
    print("| ms | Share of busy | Name |")
    print("|---:|---:|---|")
    for key, ms in sorted(rows.items(), key=lambda item: -item[1])[:top]:
        print(f"| {ms:.1f} | {ms / busy_ms:.1%} | `{key}` |")


def main() -> None:
    parser = argparse.ArgumentParser(description="Top self-time functions and per-class buckets across .cpuprofile files.")
    parser.add_argument("profile_dir")
    parser.add_argument("--top", type=int, default=15)
    parser.add_argument("--record", help="run.py JSONL; its last record's window limits the samples")
    parser.add_argument("--phase", default="workload", help="window in the record: workload, idle, cleanIdle, startup, typing, expandedTyping, burst, or a long step name")
    parser.add_argument("--callers", help="print the call chains above samples whose leaf function has this name")
    parser.add_argument("--match", default="pi-snoop-tui/src/", help="path fragment that marks extension code")
    args = parser.parse_args()
    sys.setrecursionlimit(100_000)
    window = None
    if args.record:
        window = window_for(json.loads(Path(args.record).read_text().strip().splitlines()[-1]), args.phase)
    acc = {"total": 0.0, "functions": defaultdict(float), "files": defaultdict(float), "owners": defaultdict(float), "inclusive": defaultdict(float), "callers": defaultdict(float)}
    files = sorted(Path(args.profile_dir).glob("*.cpuprofile"))
    for path in files:
        collect(json.loads(path.read_text()), window, acc, args.callers)
    busy_ms = sum(acc["functions"].values())
    scope = f"{args.phase} window {window[1] - window[0]:.0f} us" if window else "whole process"
    print(f"{len(files)} profile(s), {scope}, {acc['total']:.0f} ms sampled, {busy_ms:.0f} ms excluding {sorted(IDLE_FRAMES)}\n")
    if busy_ms == 0:
        return
    print("| Self ms | Share of busy | Function | Location |")
    print("|---:|---:|---|---|")
    for (name, location), ms in sorted(acc["functions"].items(), key=lambda item: -item[1])[: args.top]:
        print(f"| {ms:.1f} | {ms / busy_ms:.1%} | `{name[:60]}` | `{Path(location).name if location else ''}` |")
    table("Self time by owner (innermost class on the stack)", acc["owners"], busy_ms, args.top)
    table("Inclusive time by class (each class counted once per sample)", acc["inclusive"], busy_ms, args.top)
    table("Self time by file", acc["files"], busy_ms, args.top)
    if args.callers:
        table(f"Callers of `{args.callers}`", acc["callers"], busy_ms, args.top)
    matched = {key: ms for key, ms in acc["functions"].items() if args.match in key[1]}
    matched_ms = sum(matched.values())
    print(f"\nFrames matching `{args.match}`: {len(matched)} functions, {matched_ms:.1f} ms self, {matched_ms / busy_ms:.2%} of busy time")
    for (name, location), ms in sorted(matched.items(), key=lambda item: -item[1])[:10]:
        print(f"- {ms:.1f} ms `{name}` `{Path(location).name}`")


if __name__ == "__main__":
    main()
