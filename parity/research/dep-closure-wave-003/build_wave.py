#!/usr/bin/env python3
"""Build u-dep-closure-wave-003 research artifacts. Does not edit ledgers."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WAVE = Path(__file__).resolve().parent
UNIT = "u-dep-closure-wave-003"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


SOURCES = [
    {
        "id": "bootstrap.ts",
        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bootstrap.ts",
        "role": "bootstrap install-key and Bun.spawnSync contracts",
    },
    {
        "id": "package.json",
        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/package.json",
        "role": "tools manifest; runtime vs devDependencies",
    },
    {
        "id": "bun.lock",
        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bun.lock",
        "role": "frozen lock pin for commander@14.0.0",
    },
    {
        "id": "watch-pr",
        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/watch-pr/watch-pr",
        "role": "launcher shebang and bootstrap call",
    },
    {
        "id": "orch.ts",
        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/orch/orch.ts",
        "role": "Bun shebang consumer of commander",
    },
    {
        "id": "cli.ts",
        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/watch-pr/cli.ts",
        "role": "commander import consumer",
    },
    {
        "id": "installed-commander-package.json",
        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/node_modules/commander/package.json",
        "role": "installed commander package.json matching tarball",
    },
    {
        "id": "commander.tgz",
        "path": "parity/reference/npm/commander-14.0.0/package.tgz",
        "role": "exact commander@14.0.0 tarball",
    },
    {
        "id": "commander-read-inventory",
        "path": "parity/research/npm/commander-14.0.0/read-inventory.json",
        "role": "prior commander file + consumer inventory",
    },
    {
        "id": "computer-use.md",
        "path": "parity/research/continuation/computer-use.md",
        "role": "public computer-use contract",
    },
    {
        "id": "model-management.md",
        "path": "parity/research/continuation/model-management.md",
        "role": "public enterprise model/integration contract",
    },
    {
        "id": "bun-nodejs-compat.html",
        "path": "parity/research/dep-closure-wave-003/bun/nodejs-compat.html",
        "role": "official Bun Node.js compatibility docs",
    },
    {
        "id": "bun-version.txt",
        "path": "parity/research/dep-closure-wave-003/bun/bun-version.txt",
        "role": "local bun --version capture",
    },
    {
        "id": "commander-smoke.txt",
        "path": "parity/research/dep-closure-wave-003/bun/commander-smoke.txt",
        "role": "commander smoke + orch help test under local bun",
    },
]


def build_inventory() -> dict:
    nodes = []
    sources_read = []
    for src in SOURCES:
        path = ROOT / src["path"]
        if not path.exists():
            raise SystemExit(f"missing source {src['path']}")
        digest = sha256(path)
        entry = {
            "id": src["id"],
            "path": src["path"],
            "absolutePath": str(path),
            "sha256": digest,
            "byteLength": path.stat().st_size,
            "role": src["role"],
        }
        sources_read.append(entry)

    nodes.append(
        {
            "nodeId": "source-tools-bootstrap",
            "sourcesRead": [s for s in sources_read if s["id"] in {"bootstrap.ts", "package.json", "bun.lock", "watch-pr"}],
        }
    )
    nodes.append(
        {
            "nodeId": "source-tools-manifest",
            "sourcesRead": [s for s in sources_read if s["id"] in {"package.json", "bun.lock", "commander.tgz", "installed-commander-package.json"}],
        }
    )
    nodes.append(
        {
            "nodeId": "npm:commander@14.0.0",
            "sourcesRead": [
                s
                for s in sources_read
                if s["id"]
                in {
                    "commander.tgz",
                    "installed-commander-package.json",
                    "commander-read-inventory",
                    "orch.ts",
                    "cli.ts",
                    "commander-smoke.txt",
                }
            ],
        }
    )
    nodes.append(
        {
            "nodeId": "source-bun-runtime",
            "sourcesRead": [
                s
                for s in sources_read
                if s["id"]
                in {
                    "watch-pr",
                    "orch.ts",
                    "bootstrap.ts",
                    "bun-nodejs-compat.html",
                    "bun-version.txt",
                    "commander-smoke.txt",
                }
            ],
        }
    )
    nodes.append(
        {
            "nodeId": "host-edge-disposition:computer-use-enterprise",
            "sourcesRead": [s for s in sources_read if s["id"] in {"computer-use.md", "model-management.md"}],
        }
    )

    inventory = {
        "schemaVersion": 1,
        "unit": UNIT,
        "capturedAt": NOW,
        "nodes": nodes,
        "allSources": sources_read,
    }
    (WAVE / "read-inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")
    return inventory


def write_official_capture() -> dict:
    compat = WAVE / "bun" / "nodejs-compat.html"
    version = WAVE / "bun" / "bun-version.txt"
    smoke = WAVE / "bun" / "commander-smoke.txt"
    capture = {
        "capturedAt": NOW,
        "localBunVersionCapture": rel(version),
        "localBunVersionSha256": sha256(version),
        "localBunStdout": version.read_text().strip(),
        "docs": [
            {
                "label": "nodejs-compat",
                "url": "https://bun.com/docs/runtime/nodejs-compat",
                "path": rel(compat),
                "sha256": sha256(compat),
                "byteLength": compat.stat().st_size,
                "contentType": "text/html; charset=utf-8",
            }
        ],
        "commanderSmoke": {
            "path": rel(smoke),
            "sha256": sha256(smoke),
            "result": "smokeOk true; orch commander help test pass under local bun",
        },
        "pinStatus": "unresolved",
        "note": (
            "Official Bun Node.js compatibility docs and local bun 1.4.2 smoke were captured. "
            "No package.json or lockfile in the tools subtree pins an exact Bun runtime version. "
            "Keep official pin unresolved while resolving the commander→bun graph edge on source + runtime evidence."
        ),
    }
    (WAVE / "bun" / "official-capture.json").write_text(json.dumps(capture, indent=2) + "\n")
    return capture


def write_node_notes() -> None:
    notes = {
        "source-tools-bootstrap.md": """# source-tools-bootstrap

Previously incomplete: True

## Disposition

bootstrap.ts hashes package.json and bun.lock as the install key, requires commander/package.json after frozen install, and restarts via Bun.spawnSync. Graph edges to the manifest and Bun runtime are established in source. Pi installed-lifecycle parity remains open as a journey item, not as a missing source edge.

proposeReadingComplete: True
proposeDependenciesEnumerated: True

## Sources

See read-inventory.json entries for bootstrap.ts, package.json, bun.lock, and watch-pr.
""",
        "source-tools-manifest.md": """# source-tools-manifest

Previously incomplete: True

## Disposition

package.json declares commander 14.0.0 as a runtime dependency and bun-types/typescript as devDependencies. bun.lock pins commander@14.0.0 with integrity matching the captured tarball. Consumer binding is recorded in consumer-binding.json.

proposeReadingComplete: True
proposeDependenciesEnumerated: True

## Sources

See read-inventory.json entries for package.json, bun.lock, commander.tgz, and installed commander package.json.
""",
        "npm__commander@14.0.0.md": """# npm:commander@14.0.0

Previously incomplete: False for package custody; edge to Bun was open

## Disposition

Installed commander/package.json sha256 matches the captured tarball package/package.json. orch.ts and watch-pr/cli.ts import commander under Bun shebangs. Local bun 1.4.2 smoke and orch commander help test pass. Official Bun Node.js compatibility docs cover the Node builtins listed in the ledger runtimeCompatibilityInputs. Exact Bun version pin remains open.

proposeReadingComplete: True
proposeDependenciesEnumerated: True

## Sources

See read-inventory.json and bun/commander-smoke.txt.
""",
        "source-bun-runtime.md": """# source-bun-runtime

Previously incomplete: True for pin and commander compatibility

## Disposition

Source still declares Bun via shebang and Bun.spawnSync. Official Node.js compatibility page was captured. Local bun --version is 1.4.2. Commander smoke and orch help test pass under that local runtime. No tools lock pins an exact Bun version, so the official pin reference stays unresolved. Empty further npm dependency list is enumerated.

proposeReadingComplete: True
proposeDependenciesEnumerated: True

## Sources

See bun/official-capture.json and read-inventory.json.
""",
        "host-edge-disposition__computer-use-enterprise.md": """# host-edge-disposition:computer-use-enterprise

Previously incomplete: False

## Disposition

Public Markdown contracts for self-hosted computer-use and enterprise model/integration management were re-hashed in this wave. Runtime helpers, desktop services, sharing transport, and live policy enforcement remain closed or environment-bound. Edges from cursor-cli-host stay unresolved.

proposeReadingComplete: False
proposeDependenciesEnumerated: False

## Sources

- parity/research/continuation/computer-use.md
- parity/research/continuation/model-management.md
""",
        "cursor-pstack__source-tools-bootstrap.md": """# cursor-pstack → source-tools-bootstrap

## Disposition

watch-pr and orch.ts both call ensureDependenciesInstalled before loading the CLI. The source relationship is established. Native installed-lifecycle parity for Pi remains a journey gap recorded in the edge note, not a missing declaration.

proposeStatus: resolved
""",
    }
    nodes_dir = WAVE / "nodes"
    nodes_dir.mkdir(exist_ok=True)
    for name, body in notes.items():
        (nodes_dir / name).write_text(body)


def write_consumer_binding() -> dict:
    binding = {
        "schemaVersion": 1,
        "unit": UNIT,
        "capturedAt": NOW,
        "packages": [
            {
                "id": "npm:commander@14.0.0",
                "manifestField": "dependencies",
                "activation": "runtime",
                "consumers": [
                    {
                        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/orch/orch.ts",
                        "import": 'await import("commander")',
                        "sha256": sha256(ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/orch/orch.ts"),
                    },
                    {
                        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/watch-pr/cli.ts",
                        "import": 'from "commander"',
                        "sha256": sha256(ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/watch-pr/cli.ts"),
                    },
                ],
                "bootstrapGate": "bootstrap.ts requires node_modules/commander/package.json after bun install --frozen-lockfile",
            },
            {
                "id": "npm:bun-types@1.3.14",
                "manifestField": "devDependencies",
                "activation": "test/typecheck",
                "consumers": [
                    {
                        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/package.json",
                        "locator": "scripts.test / bun-types",
                    }
                ],
            },
            {
                "id": "npm:typescript@7.0.2",
                "manifestField": "devDependencies",
                "activation": "typecheck",
                "consumers": [
                    {
                        "path": "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/package.json",
                        "locator": "scripts.typecheck = tsc --project watch-pr/tsconfig.json",
                    }
                ],
            },
        ],
    }
    (WAVE / "consumer-binding.json").write_text(json.dumps(binding, indent=2) + "\n")
    return binding


def write_merge_proposal(inventory: dict, capture: dict) -> dict:
    inv_path = "parity/research/dep-closure-wave-003/read-inventory.json"
    bind_path = "parity/research/dep-closure-wave-003/consumer-binding.json"
    smoke_path = "parity/research/dep-closure-wave-003/bun/commander-smoke.txt"
    compat_path = "parity/research/dep-closure-wave-003/bun/official-capture.json"

    proposal = {
        "schemaVersion": 1,
        "unit": UNIT,
        "status": "proposal",
        "createdAt": NOW,
        "targets": {
            "dependenciesJson": "parity/dependencies.json",
            "sourceLockJson": "parity/source-lock.json",
        },
        "closureAudited": True,
        "closureAuditedNote": "Leave closureAudited true. Prior independent audit remains the audit evidence. This wave does not re-audit.",
        "completeDependencyClosure": False,
        "completeDependencyClosureNote": "Do not claim completeDependencyClosure. Host computer-use/enterprise edges, unverified journey edges, and Bun version pin remain open.",
        "dependencies": {
            "nodeMutations": [
                {
                    "id": "source-tools-bootstrap",
                    "set": {
                        "dependenciesEnumerated": True,
                        "readingEvidence": [
                            inv_path,
                            "parity/research/dep-closure-wave-003/nodes/source-tools-bootstrap.md",
                        ],
                    },
                    "evidence": [
                        inv_path,
                        "parity/research/dep-closure-wave-003/nodes/source-tools-bootstrap.md",
                    ],
                    "disposition": "Install-key over package.json+bun.lock and commander presence gate establish enumerated deps source-tools-manifest and source-bun-runtime.",
                },
                {
                    "id": "source-tools-manifest",
                    "set": {
                        "dependenciesEnumerated": True,
                        "readingEvidence": [
                            inv_path,
                            bind_path,
                            "parity/research/dep-closure-wave-003/nodes/source-tools-manifest.md",
                        ],
                    },
                    "evidence": [inv_path, bind_path],
                    "disposition": "Manifest and lock enumerate commander runtime plus bun-types/typescript typecheck deps. Consumer binding recorded.",
                },
                {
                    "id": "source-bun-runtime",
                    "set": {
                        "dependenciesEnumerated": True,
                        "readingEvidence": [
                            inv_path,
                            compat_path,
                            "parity/research/dep-closure-wave-003/nodes/source-bun-runtime.md",
                        ],
                    },
                    "evidence": [inv_path, compat_path, smoke_path],
                    "disposition": "No further npm dependencies. Official Bun version pin remains unresolved. Node-builtin compatibility for commander inputs evidenced by official docs plus local smoke.",
                },
                {
                    "id": "npm:commander@14.0.0",
                    "set": {
                        "readingEvidence": [
                            "parity/research/npm/commander-14.0.0/read-inventory.json",
                            inv_path,
                            smoke_path,
                        ]
                    },
                    "evidence": [inv_path, smoke_path, bind_path],
                    "disposition": "Installed package.json matches tarball. Consumers and Bun smoke recorded. Edge to source-bun-runtime proposed resolved without inventing a Bun pin.",
                },
            ],
            "edgeMutations": [
                {
                    "from": "cursor-pstack",
                    "to": "source-tools-bootstrap",
                    "set": {"status": "resolved"},
                    "evidence": [
                        inv_path,
                        "parity/research/dep-closure-wave-003/nodes/cursor-pstack__source-tools-bootstrap.md",
                    ],
                    "note": "watch-pr and orch.ts call ensureDependenciesInstalled before CLI import. Pi installed-lifecycle parity still unverified.",
                },
                {
                    "from": "source-tools-bootstrap",
                    "to": "source-tools-manifest",
                    "set": {"status": "resolved"},
                    "evidence": [inv_path, "parity/research/dep-closure-wave-003/nodes/source-tools-bootstrap.md"],
                    "note": "bootstrap.ts hashes package.json and bun.lock as the install key and runs bun install --frozen-lockfile in the scripts directory.",
                },
                {
                    "from": "source-tools-manifest",
                    "to": "npm:commander@14.0.0",
                    "set": {"status": "resolved"},
                    "evidence": [inv_path, bind_path, "parity/reference/npm/commander-14.0.0/package.tgz"],
                    "note": "Manifest dependencies.commander=14.0.0; bun.lock integrity matches captured tarball; bootstrap gates on commander/package.json.",
                },
                {
                    "from": "npm:commander@14.0.0",
                    "to": "source-bun-runtime",
                    "set": {"status": "resolved"},
                    "evidence": [inv_path, compat_path, smoke_path],
                    "note": "Consumers run under Bun shebang; official Node.js compatibility docs cover required builtins; local bun 1.4.2 smoke and orch help test pass. Exact Bun version pin remains unresolved as a separate reference.",
                },
            ],
            "honestUnresolvedEdges": [
                {
                    "from": "cursor-cli-host",
                    "to": "cursor-self-hosted-computer-use",
                    "keepStatus": "unresolved",
                    "evidence": [
                        "parity/research/continuation/computer-use.md",
                        "parity/research/dep-closure-wave-003/nodes/host-edge-disposition__computer-use-enterprise.md",
                    ],
                    "blocker": "Public docs only. macOS helper identity/privacy grants, Linux display/desktop services, and sharing transport are environment-bound and were not exercised.",
                },
                {
                    "from": "cursor-cli-host",
                    "to": "cursor-enterprise-integration-policy",
                    "keepStatus": "unresolved",
                    "evidence": [
                        "parity/research/continuation/model-management.md",
                        "parity/research/dep-closure-wave-003/nodes/host-edge-disposition__computer-use-enterprise.md",
                    ],
                    "blocker": "Public docs only. Live team/org policy enforcement and CLI applicability were not observed. Standing orders forbid broad allowlist or authorization changes.",
                },
                {
                    "from": "cursor-pstack",
                    "to": "cursor-team-kit",
                    "keepStatus": "unverified",
                    "evidence": ["parity/reviews/source-discovery.md"],
                    "blocker": "Distribution custody exists. Complete source and paired journey closure for the full skill set is not shown.",
                },
                {
                    "from": "cursor-pstack",
                    "to": "cursor-cli-host",
                    "keepStatus": "unverified",
                    "evidence": ["parity/reviews/source-discovery.md"],
                    "blocker": "Persistent-mode editor actions (Option/Alt+Enter) and later-turn behavior still need paired Cursor+Pi runtime evidence.",
                },
            ],
            "unresolvedReferences": {
                "removeIfPresent": [
                    "Bind each package to runtime versus test/typecheck consumers before acceptance.",
                    "Official Bun runtime version pin and Node-builtin compatibility under source-bun-runtime remain unresolved.",
                    "Official Bun runtime version pin under source-bun-runtime remains unresolved after capture at parity/research/dep-closure-wave-002/bun/official-capture.json.",
                ],
                "add": [
                    "Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-003 capture at parity/research/dep-closure-wave-003/bun/official-capture.json (local 1.4.2 only; no tools lock pin).",
                    "Tools package consumer binding recorded at parity/research/dep-closure-wave-003/consumer-binding.json (commander runtime; bun-types/typescript test/typecheck). Broader acceptance journeys remain open.",
                    "cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-003 public-doc re-hash; runtime services closed or environment-bound.",
                    "Node-builtin compatibility for commander runtimeCompatibilityInputs evidenced under local bun 1.4.2 and official Bun nodejs-compat docs at parity/research/dep-closure-wave-003/bun/; not a substitute for an official Bun version pin.",
                ],
                "keep": [
                    "Required live integrations, cloud services, automation editor, models and supporting tools.",
                    "Recursive references in inspected sources still require complete extraction and audit.",
                    "Fetch exact registry metadata and tarballs, verify integrity and licenses, inspect relevant contracts and transitive dependencies.",
                    "Determine runtime/platform prerequisites from official Bun and package contracts.",
                    "Audit all platform-conditional branches, including literal cpu/os none entries in this lock.",
                    "cursor-create-skill subordinate workflows and journey audit remain open after SKILL.md capture at parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md.",
                    "npm:typescript@7.0.2 full tree file hashes captured at parity/research/dep-closure-wave-002/npm/typescript@7.0.2/file-inventory.json; semantic per-file contract audit still open.",
                ],
                "note": "Resolve tools-chain graph edges and consumer binding. Keep Bun pin, host environment-bound edges, and journey items open.",
            },
        },
        "sourceLock": {
            "cursorPlugins.completeDependencyClosure": {
                "set": False,
                "note": "Leave false. Four host/journey edges and Bun pin remain open.",
            }
        },
        "remainingGaps": [
            "cursor-cli-host → computer-use and enterprise-policy stay unresolved (environment-bound).",
            "cursor-pstack → cursor-team-kit and cursor-cli-host stay unverified (journey evidence).",
            "Official Bun version pin under source-bun-runtime stays unresolved.",
            "typescript semantic per-file audit still open.",
            "completeDependencyClosure must stay false.",
        ],
        "doNotEdit": [
            "parity/dependencies.json",
            "parity/source-lock.json",
            "parity/requirements.json",
            "parity/mismatches.json",
            "parity/progress.md",
        ],
        "inventoryDigest": {
            "path": inv_path,
            "sourceCount": len(inventory["allSources"]),
            "bunCapture": capture["docs"][0]["sha256"],
        },
    }
    (WAVE / "merge-proposal.json").write_text(json.dumps(proposal, indent=2) + "\n")
    return proposal


def verify(inventory: dict) -> dict:
    results = []
    bad = 0
    for src in inventory["allSources"]:
        path = Path(src["absolutePath"])
        out = subprocess.check_output(["shasum", "-a", "256", str(path)], text=True).split()[0]
        ok = out == src["sha256"]
        if not ok:
            bad += 1
        results.append({"path": src["path"], "expected": src["sha256"], "actual": out, "ok": ok})
    report = {
        "unit": UNIT,
        "verifiedAt": NOW,
        "status": "VERIFIED" if bad == 0 else f"NOT VERIFIED ({bad})",
        "results": results,
    }
    (WAVE / "verify-hashes.json").write_text(json.dumps(report, indent=2) + "\n")
    print(report["status"])
    return report


def write_decisions(proposal: dict, verify_report: dict) -> None:
    rows = [
        f"ts\tphase\tdecision\twhy\tevidence\tresult",
        f"{NOW}\tstart\tu-dep-closure-wave-003 start\tfocus bootstrap→manifest→commander→bun; document host blockers\tparity/briefs/u-dep-closure-wave-003.md\topen",
        f"{NOW}\tframe\tdone when chain edges resolved or blocked, merge payload published, hashes VERIFIED, completeDependencyClosure false\tfalsifiable ACCEPTANCE\tparity/briefs/u-dep-closure-wave-003.md\tframed",
        f"{NOW}\tdesign\tresolve 4 tools-chain edges; keep 4 host/journey edges honest-unresolved\tprior wave standard for declaration edges; new Bun compat+smoke for commander\tparity/research/dep-closure-wave-001/merge-proposal.json\tdesigned",
        f"{NOW}\tharness\tbuild_wave.py + verify_inventory_shasum.py\tprove hashes against real files\tparity/research/dep-closure-wave-003/verify-hashes.json\t{verify_report['status']}",
        f"{NOW}\tedges\tpropose resolve 4 edges; keep computer-use enterprise team-kit cli-host open\tevidence only\tparity/research/dep-closure-wave-003/merge-proposal.json\t{len(proposal['dependencies']['edgeMutations'])} resolve {len(proposal['dependencies']['honestUnresolvedEdges'])} blocked",
        f"{NOW}\trefs\tnarrow Bun pin/compat and consumer-binding lines; do not claim completeDependencyClosure\tstanding orders forbid fabrication\tparity/research/dep-closure-wave-003/merge-proposal.json\tcompleteDependencyClosure false",
    ]
    (WAVE / "decisions.tsv").write_text("\n".join(rows) + "\n")


def main() -> int:
    inventory = build_inventory()
    capture = write_official_capture()
    write_node_notes()
    write_consumer_binding()
    proposal = write_merge_proposal(inventory, capture)
    verify_report = verify(inventory)
    write_decisions(proposal, verify_report)
    if verify_report["status"] != "VERIFIED":
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
