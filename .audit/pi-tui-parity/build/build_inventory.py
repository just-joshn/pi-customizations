#!/usr/bin/env python3
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "inventory.tsv"
SEP = "⇥"
HEADER = ["id", "family", "component", "states", "visual_spec", "keys", "source", "evidence", "depends_on"]
FAMILIES = ["renderer", "theme", "markdown", "code", "diff", "review", "transcript", "tool-ui", "spinner",
            "composer", "footer", "palette", "decision", "banner", "mode", "vim", "command", "pager", "chrome",
            "startup", "wizard", "notification", "toast"]
PREFIX = {f: f for f in FAMILIES}
PREFIX.update({"tool": "tool-ui", "cmd": "command"})
EVIDENCE = ["observed", "spot-checked", "source-derived"]
DEPENDS = {"none", "reference-auth", "reference-api", "cloud-agents", "statsig", "mcp", "sandbox-runtime",
           "plugins-marketplace", "team-account", "bedrock", "usage-billing", "image-generation", "web-search",
           "semantic-index", "lints", "persistent-sessions", "reference-editor-binary", "ai-attribution", "updater",
           "background-shells", "subagents", "git"}
ID_RE = re.compile(r"^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$")


def parse_parts():
    rows, errors = [], []
    for part in sorted((HERE / "parts").glob("*.txt")):
        for n, line in enumerate(part.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip() or line.startswith("#"):
                continue
            where = f"{part.name}:{n}"
            if "\t" in line:
                errors.append(f"{where}: raw tab in source line")
            fields = [f.strip() for f in line.split(SEP)]
            if len(fields) != 9:
                errors.append(f"{where}: {len(fields)} fields")
                continue
            rows.append((where, fields))
    return rows, errors


def validate(rows):
    errors, seen = [], {}
    for where, f in rows:
        rid, fam, _, states, _, _, _, ev, dep = f
        if any(not x for x in f):
            errors.append(f"{where} {rid}: empty field")
        if not ID_RE.match(rid):
            errors.append(f"{where} {rid}: bad id")
        if rid in seen:
            errors.append(f"{where} {rid}: duplicate of {seen[rid]}")
        seen[rid] = where
        if fam not in FAMILIES:
            errors.append(f"{where} {rid}: bad family {fam}")
        if PREFIX.get(rid.split(".")[0]) != fam:
            errors.append(f"{where} {rid}: prefix does not match family {fam}")
        if ev not in EVIDENCE:
            errors.append(f"{where} {rid}: bad evidence {ev}")
        deps = dep.split(";")
        if any(d not in DEPENDS for d in deps) or ("none" in deps and len(deps) > 1):
            errors.append(f"{where} {rid}: bad depends_on {dep}")
        if "UNRESOLVED" in states and "UNRESOLVED:" not in states and "UNRESOLVED (" not in states:
            errors.append(f"{where} {rid}: malformed UNRESOLVED marker")
    return errors


def main():
    rows, errors = parse_parts()
    errors += validate(rows)
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    lines = ["\t".join(HEADER)] + ["\t".join(f) for _, f in rows]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    fams = Counter(f[1] for _, f in rows)
    evs = Counter(f[7] for _, f in rows)
    unresolved = sum("UNRESOLVED" in f[3] for _, f in rows)
    print(f"rows {len(rows)} ; unresolved rows {unresolved}")
    print("family " + ", ".join(f"{k} {fams[k]}" for k in FAMILIES))
    print("evidence " + ", ".join(f"{k} {evs[k]}" for k in EVIDENCE))


if __name__ == "__main__":
    main()
