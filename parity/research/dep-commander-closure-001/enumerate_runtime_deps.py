#!/usr/bin/env python3
"""Enumerate transitive third-party runtime deps for locked commander@14.0.0."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PKG = ROOT / "parity/reference/npm/commander-14.0.0/unpacked/package"
OUT = Path(__file__).resolve().parent / "runtime-deps.json"

REQUIRE_RE = re.compile(
    r"""(?:^|\s|;|=)require\s*\(\s*['"]([^'"]+)['"]\s*\)"""
)
# ESM static import / export-from (line-oriented; ignores prose like `.command()`)
IMPORT_FROM_RE = re.compile(
    r"""(?:^|\n)\s*(?:import|export)\s+(?:[^'";\n]+?\s+from\s+)?['"]([^'"]+)['"]"""
)
NODE_BUILTIN_PREFIXES = ("node:",)
RELATIVE_PREFIXES = ("./", "../")


def is_third_party(spec: str) -> bool:
    if spec.startswith(NODE_BUILTIN_PREFIXES):
        return False
    if spec.startswith(RELATIVE_PREFIXES):
        return False
    # bare Node builtins without node: prefix still count as platform, not npm
    node_bare = {
        "events",
        "child_process",
        "path",
        "fs",
        "process",
        "util",
        "os",
        "url",
        "buffer",
        "stream",
        "assert",
        "module",
    }
    if spec in node_bare:
        return False
    return True


def main() -> int:
    manifest = json.loads((PKG / "package.json").read_text())
    dep_fields = {
        "dependencies": manifest.get("dependencies"),
        "optionalDependencies": manifest.get("optionalDependencies"),
        "peerDependencies": manifest.get("peerDependencies"),
        "bundleDependencies": manifest.get("bundleDependencies"),
        "bundledDependencies": manifest.get("bundledDependencies"),
    }
    js_files = sorted(
        [*(PKG.glob("*.js")), *(PKG.glob("*.mjs")), *(PKG.glob("lib/*.js"))]
    )
    imports: list[dict] = []
    third_party: set[str] = set()
    for path in js_files:
        text = path.read_text()
        specs: list[str] = []
        specs.extend(m.group(1) for m in REQUIRE_RE.finditer(text))
        specs.extend(m.group(1) for m in IMPORT_FROM_RE.finditer(text))
        for spec in specs:
            if is_third_party(spec):
                kind = "third-party"
                third_party.add(spec)
            elif spec.startswith(NODE_BUILTIN_PREFIXES) or (
                not spec.startswith(RELATIVE_PREFIXES)
            ):
                kind = "node-builtin"
            else:
                kind = "relative"
            imports.append(
                {
                    "file": str(path.relative_to(PKG)),
                    "specifier": spec,
                    "kind": kind,
                }
            )

    result = {
        "package": f"{manifest['name']}@{manifest['version']}",
        "manifestDependencyFields": {
            k: (v if v is not None else "<absent>") for k, v in dep_fields.items()
        },
        "thirdPartyRuntimeDependencies": sorted(third_party),
        "thirdPartyRuntimeDependencyCount": len(third_party),
        "importScanFileCount": len(js_files),
        "imports": imports,
        "expectation": "none",
        "matchesExpectation": len(third_party) == 0,
    }
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({
        "thirdPartyRuntimeDependencyCount": result["thirdPartyRuntimeDependencyCount"],
        "matchesExpectation": result["matchesExpectation"],
        "manifestDependencyFields": result["manifestDependencyFields"],
    }, indent=2))
    return 0 if result["matchesExpectation"] else 1


if __name__ == "__main__":
    sys.exit(main())
