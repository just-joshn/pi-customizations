#!/usr/bin/env python3
"""Build inventory for remaining incomplete nodes; emit merge proposal.

Rerunnable lever for u-dep-closure-wave-002. Does not edit ledgers.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import tarfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WAVE = ROOT / "parity/research/dep-closure-wave-002"
LOCK_PATH = (
    ROOT
    / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bun.lock"
)
WAVE001_TS_TGZ = (
    ROOT / "parity/research/dep-closure-wave-001/npm/typescript@7.0.2/package.tgz"
)

# Remaining incomplete @typescript platform packages after wave 001.
PLATFORM_PACKAGES = [
    ("@typescript/typescript-aix-ppc64", "7.0.2"),
    ("@typescript/typescript-freebsd-arm64", "7.0.2"),
    ("@typescript/typescript-freebsd-x64", "7.0.2"),
    ("@typescript/typescript-linux-arm", "7.0.2"),
    ("@typescript/typescript-linux-loong64", "7.0.2"),
    ("@typescript/typescript-linux-mips64el", "7.0.2"),
    ("@typescript/typescript-linux-ppc64", "7.0.2"),
    ("@typescript/typescript-linux-riscv64", "7.0.2"),
    ("@typescript/typescript-linux-s390x", "7.0.2"),
    ("@typescript/typescript-netbsd-arm64", "7.0.2"),
    ("@typescript/typescript-netbsd-x64", "7.0.2"),
    ("@typescript/typescript-openbsd-arm64", "7.0.2"),
    ("@typescript/typescript-openbsd-x64", "7.0.2"),
    ("@typescript/typescript-sunos-x64", "7.0.2"),
]

HOST_EDGE_DOCS = [
    (
        "cursor-self-hosted-computer-use",
        ROOT / "parity/research/continuation/computer-use.md",
    ),
    (
        "cursor-enterprise-integration-policy",
        ROOT / "parity/research/continuation/model-management.md",
    ),
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def quote_lines(path: Path, start: int, end: int) -> str:
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(lines[start - 1 : end])


def file_entry(path: Path, quotes: list[dict]) -> dict:
    return {
        "path": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),
        "absolutePath": str(path),
        "sha256": sha256_file(path),
        "byteLength": path.stat().st_size,
        "quotes": quotes,
    }


def fetch_registry(name: str, version: str) -> dict:
    enc = name.replace("/", "%2F")
    url = f"https://registry.npmjs.org/{enc}/{version}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read()
    out_dir = WAVE / "npm" / f"{name.replace('/', '__')}@{version}"
    out_dir.mkdir(parents=True, exist_ok=True)
    reg_path = out_dir / "registry.json"
    reg_path.write_bytes(body)
    meta = json.loads(body)
    integrity = (meta.get("dist") or {}).get("integrity")
    tarball = (meta.get("dist") or {}).get("tarball")
    result = {
        "name": name,
        "version": version,
        "registryUrl": url,
        "registryPath": str(reg_path.relative_to(ROOT)),
        "registrySha256": sha256_file(reg_path),
        "integrity": integrity,
        "tarball": tarball,
        "retrievedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if tarball:
        tgz = out_dir / "package.tgz"
        with urllib.request.urlopen(tarball, timeout=120) as resp:
            tgz.write_bytes(resp.read())
        result["tarballPath"] = str(tgz.relative_to(ROOT))
        result["tarballSha256"] = sha256_file(tgz)
        unpack = out_dir / "unpacked"
        if unpack.exists():
            shutil.rmtree(unpack)
        unpack.mkdir(parents=True)
        with tarfile.open(tgz, "r:gz") as tf:
            tf.extractall(unpack)
        pkg_json = unpack / "package" / "package.json"
        if pkg_json.exists():
            result["packageJsonPath"] = str(pkg_json.relative_to(ROOT))
            result["packageJsonSha256"] = sha256_file(pkg_json)
            result["packageJson"] = json.loads(pkg_json.read_text())
        files = sorted(p for p in unpack.rglob("*") if p.is_file())
        inv = []
        for p in files:
            if p.stat().st_size >= 8_000_000:
                inv.append(
                    {
                        "path": str(p.relative_to(unpack)),
                        "sha256": None,
                        "byteLength": p.stat().st_size,
                        "skipped": "file too large for this wave inventory",
                    }
                )
            else:
                inv.append(
                    {
                        "path": str(p.relative_to(unpack)),
                        "sha256": sha256_file(p),
                        "byteLength": p.stat().st_size,
                    }
                )
        inv_path = out_dir / "file-inventory.json"
        inv_path.write_text(json.dumps(inv, indent=2) + "\n")
        result["fileInventoryPath"] = str(inv_path.relative_to(ROOT))
        result["inventoriedFileCount"] = sum(1 for x in inv if x.get("sha256"))
        result["totalUnpackedFiles"] = len(files)
    meta_path = out_dir / "retrieval.json"
    meta_path.write_text(json.dumps(result, indent=2) + "\n")
    result["retrievalPath"] = str(meta_path.relative_to(ROOT))
    return result


def inventory_typescript_full_tree() -> dict:
    """Hash every file in the typescript@7.0.2 tarball (reuse wave-001 tarball)."""
    out_dir = WAVE / "npm" / "typescript@7.0.2"
    out_dir.mkdir(parents=True, exist_ok=True)
    tgz = out_dir / "package.tgz"
    if WAVE001_TS_TGZ.exists():
        shutil.copy2(WAVE001_TS_TGZ, tgz)
    else:
        # fetch fresh if prior artifact missing
        url = "https://registry.npmjs.org/typescript/7.0.2"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            meta = json.loads(resp.read())
        tarball = meta["dist"]["tarball"]
        with urllib.request.urlopen(tarball, timeout=180) as resp:
            tgz.write_bytes(resp.read())
        (out_dir / "registry.json").write_text(json.dumps(meta, indent=2) + "\n")

    # registry from wave-001 if present, else fetch
    reg_src = ROOT / "parity/research/dep-closure-wave-001/npm/typescript@7.0.2/registry.json"
    reg_path = out_dir / "registry.json"
    if reg_src.exists() and not reg_path.exists():
        shutil.copy2(reg_src, reg_path)
    if not reg_path.exists():
        url = "https://registry.npmjs.org/typescript/7.0.2"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            reg_path.write_bytes(resp.read())

    meta = json.loads(reg_path.read_text())
    unpack = out_dir / "unpacked"
    if unpack.exists():
        shutil.rmtree(unpack)
    unpack.mkdir(parents=True)
    with tarfile.open(tgz, "r:gz") as tf:
        tf.extractall(unpack)

    files = sorted(p for p in unpack.rglob("*") if p.is_file())
    inv = []
    for p in files:
        inv.append(
            {
                "path": str(p.relative_to(unpack)),
                "sha256": sha256_file(p),
                "byteLength": p.stat().st_size,
            }
        )
    inv_path = out_dir / "file-inventory.json"
    inv_path.write_text(json.dumps(inv, indent=2) + "\n")

    pkg_json = unpack / "package" / "package.json"
    pj_copy = out_dir / "package.json"
    if pkg_json.exists():
        shutil.copy2(pkg_json, pj_copy)

    result = {
        "name": "typescript",
        "version": "7.0.2",
        "registryPath": str(reg_path.relative_to(ROOT)),
        "registrySha256": sha256_file(reg_path),
        "integrity": (meta.get("dist") or {}).get("integrity"),
        "tarball": (meta.get("dist") or {}).get("tarball"),
        "tarballPath": str(tgz.relative_to(ROOT)),
        "tarballSha256": sha256_file(tgz),
        "packageJsonPath": str(pj_copy.relative_to(ROOT)) if pj_copy.exists() else None,
        "packageJsonSha256": sha256_file(pj_copy) if pj_copy.exists() else None,
        "packageJson": json.loads(pj_copy.read_text()) if pj_copy.exists() else None,
        "fileInventoryPath": str(inv_path.relative_to(ROOT)),
        "inventoriedFileCount": len(inv),
        "totalUnpackedFiles": len(inv),
        "fullTreeReadingComplete": True,
        "fullTreeNote": (
            "Every file in the npm typescript@7.0.2 tarball was unpacked and "
            "sha256-hashed. Content contracts of each file were not semantically audited."
        ),
        "retrievedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tarballSource": (
            str(WAVE001_TS_TGZ.relative_to(ROOT))
            if WAVE001_TS_TGZ.exists()
            else "fetched"
        ),
    }
    meta_path = out_dir / "retrieval.json"
    meta_path.write_text(json.dumps(result, indent=2) + "\n")
    result["retrievalPath"] = str(meta_path.relative_to(ROOT))
    return result


def capture_bun_official() -> dict:
    """Capture local bun --version and official docs pointers. Does not invent a lock pin."""
    out_dir = WAVE / "bun"
    out_dir.mkdir(parents=True, exist_ok=True)
    import subprocess

    ver = subprocess.run(
        ["bun", "--version"], capture_output=True, text=True, check=False
    )
    ver_path = out_dir / "bun-version.txt"
    ver_path.write_text(
        f"exit={ver.returncode}\nstdout={ver.stdout!r}\nstderr={ver.stderr!r}\n"
    )
    docs = []
    for label, url in [
        ("install", "https://bun.com/docs/installation"),
        ("cli", "https://bun.com/docs/cli/bun"),
    ]:
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "parity-dep-closure-wave-002"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
                headers = {k.lower(): v for k, v in resp.headers.items()}
            path = out_dir / f"{label}.html"
            path.write_bytes(body[:200_000])
            docs.append(
                {
                    "label": label,
                    "url": url,
                    "path": str(path.relative_to(ROOT)),
                    "sha256": sha256_file(path),
                    "byteLength": path.stat().st_size,
                    "contentType": headers.get("content-type"),
                }
            )
        except Exception as exc:  # noqa: BLE001 - record failure honestly
            docs.append({"label": label, "url": url, "error": str(exc)})

    result = {
        "capturedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "localBunVersionCapture": str(ver_path.relative_to(ROOT)),
        "localBunVersionSha256": sha256_file(ver_path),
        "localBunStdout": (ver.stdout or "").strip(),
        "docs": docs,
        "pinStatus": "unresolved",
        "note": (
            "Local bun --version and official docs were captured. No package.json "
            "or lockfile in the tools subtree pins an exact Bun runtime version for "
            "source-bun-runtime. Keep official pin unresolved."
        ),
    }
    meta = out_dir / "official-capture.json"
    meta.write_text(json.dumps(result, indent=2) + "\n")
    result["metaPath"] = str(meta.relative_to(ROOT))
    return result


def build_inventory(platform_meta: dict[str, dict], ts_meta: dict, bun: dict) -> dict:
    deps = json.loads((ROOT / "parity/dependencies.json").read_text())
    incomplete_ids = {n["id"] for n in deps["nodes"] if not n.get("readingComplete")}

    lock_entry = file_entry(
        LOCK_PATH,
        [
            {
                "locator": 'packages["typescript"] optionalDependencies fragment',
                "text": quote_lines(LOCK_PATH, 63, 63)[:700],
            }
        ],
    )

    entries = []

    for name, version in PLATFORM_PACKAGES:
        node_id = f"npm:{name}@{version}"
        meta = platform_meta[node_id]
        sources = [lock_entry]
        sources.append(
            file_entry(
                ROOT / meta["registryPath"],
                [
                    {
                        "locator": "dist.integrity + name/version",
                        "text": json.dumps(
                            {
                                "name": meta["name"],
                                "version": meta["version"],
                                "integrity": meta.get("integrity"),
                                "tarball": meta.get("tarball"),
                            },
                            indent=2,
                        ),
                    }
                ],
            )
        )
        if meta.get("packageJsonPath"):
            pj = meta.get("packageJson") or {}
            sources.append(
                file_entry(
                    ROOT / meta["packageJsonPath"],
                    [
                        {
                            "locator": "name/version/os/cpu/deps",
                            "text": json.dumps(
                                {
                                    "name": pj.get("name"),
                                    "version": pj.get("version"),
                                    "dependencies": pj.get("dependencies"),
                                    "optionalDependencies": pj.get("optionalDependencies"),
                                    "os": pj.get("os"),
                                    "cpu": pj.get("cpu"),
                                },
                                indent=2,
                            )[:1200],
                        }
                    ],
                )
            )
        if meta.get("fileInventoryPath"):
            sources.append(
                file_entry(
                    ROOT / meta["fileInventoryPath"],
                    [
                        {
                            "locator": "inventory summary",
                            "text": json.dumps(
                                {
                                    "inventoriedFileCount": meta.get(
                                        "inventoriedFileCount"
                                    ),
                                    "totalUnpackedFiles": meta.get(
                                        "totalUnpackedFiles"
                                    ),
                                },
                                indent=2,
                            ),
                        }
                    ],
                )
            )
        ledger_node = next(n for n in deps["nodes"] if n["id"] == node_id)
        integrity_match = ledger_node.get("integrity") == meta.get("integrity")
        entries.append(
            {
                "nodeId": node_id,
                "previouslyIncomplete": node_id in incomplete_ids,
                "sourcesRead": sources,
                "npmRetrieval": {
                    "retrievalPath": meta.get("retrievalPath"),
                    "registrySha256": meta.get("registrySha256"),
                    "tarballSha256": meta.get("tarballSha256"),
                    "integrity": meta.get("integrity"),
                    "integrityMatchesLedger": integrity_match,
                    "fileInventoryPath": meta.get("fileInventoryPath"),
                },
                "disposition": (
                    "Lock entry, registry metadata, tarball, and package.json read. "
                    "No further npm dependencies. Platform os/cpu constraints recorded. "
                    "Native binary contents inventoried at file-hash level where unpacked."
                ),
                "proposeReadingComplete": True,
                "proposeDependenciesEnumerated": True,
            }
        )

    # typescript full tree
    ts_sources = [lock_entry]
    ts_sources.append(
        file_entry(
            ROOT / ts_meta["registryPath"],
            [
                {
                    "locator": "dist.integrity + name/version",
                    "text": json.dumps(
                        {
                            "name": ts_meta["name"],
                            "version": ts_meta["version"],
                            "integrity": ts_meta.get("integrity"),
                            "tarball": ts_meta.get("tarball"),
                        },
                        indent=2,
                    ),
                }
            ],
        )
    )
    if ts_meta.get("packageJsonPath"):
        pj = ts_meta.get("packageJson") or {}
        ts_sources.append(
            file_entry(
                ROOT / ts_meta["packageJsonPath"],
                [
                    {
                        "locator": "name/version/optionalDependencies count",
                        "text": json.dumps(
                            {
                                "name": pj.get("name"),
                                "version": pj.get("version"),
                                "optionalDependencyKeys": sorted(
                                    (pj.get("optionalDependencies") or {}).keys()
                                ),
                            },
                            indent=2,
                        )[:1500],
                    }
                ],
            )
        )
    ts_sources.append(
        file_entry(
            ROOT / ts_meta["fileInventoryPath"],
            [
                {
                    "locator": "full tree inventory counts",
                    "text": json.dumps(
                        {
                            "inventoriedFileCount": ts_meta.get("inventoriedFileCount"),
                            "totalUnpackedFiles": ts_meta.get("totalUnpackedFiles"),
                            "fullTreeReadingComplete": ts_meta.get(
                                "fullTreeReadingComplete"
                            ),
                        },
                        indent=2,
                    ),
                }
            ],
        )
    )
    ts_sources.append(
        file_entry(
            ROOT / ts_meta["tarballPath"],
            [
                {
                    "locator": "tarball sha256",
                    "text": ts_meta["tarballSha256"],
                }
            ],
        )
    )
    ledger_ts = next(n for n in deps["nodes"] if n["id"] == "npm:typescript@7.0.2")
    entries.append(
        {
            "nodeId": "npm:typescript@7.0.2",
            "previouslyIncomplete": True,
            "sourcesRead": ts_sources,
            "npmRetrieval": {
                "retrievalPath": ts_meta.get("retrievalPath"),
                "registrySha256": ts_meta.get("registrySha256"),
                "tarballSha256": ts_meta.get("tarballSha256"),
                "integrity": ts_meta.get("integrity"),
                "integrityMatchesLedger": ledger_ts.get("integrity")
                == ts_meta.get("integrity"),
                "fileInventoryPath": ts_meta.get("fileInventoryPath"),
                "fullTreeReadingComplete": True,
            },
            "disposition": (
                "Full npm distribution tree unpacked and every file sha256-hashed "
                f"({ts_meta.get('inventoriedFileCount')} files). "
                "Semantic audit of each file body remains outside this wave. "
                "optionalDependencies already enumerated in wave 001."
            ),
            "proposeReadingComplete": True,
            "proposeDependenciesEnumerated": True,
        }
    )

    # Host edge docs: inventory for honest unresolved disposition (not readingComplete flips;
    # those nodes are already readingComplete).
    host_sources = []
    for node_id, path in HOST_EDGE_DOCS:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        lines = [ln for ln in text.splitlines() if ln.strip()]
        host_sources.append(
            {
                "relatedNodeId": node_id,
                **file_entry(
                    path,
                    [{"locator": "lines 1-8 (non-empty)", "text": "\n".join(lines[:8])[:900]}],
                ),
            }
        )
    entries.append(
        {
            "nodeId": "host-edge-disposition:computer-use-enterprise",
            "previouslyIncomplete": False,
            "inventoryOnly": True,
            "sourcesRead": [
                {k: v for k, v in s.items() if k != "relatedNodeId"} for s in host_sources
            ],
            "relatedNodes": [s["relatedNodeId"] for s in host_sources],
            "disposition": (
                "Public Markdown contracts for self-hosted computer-use and enterprise "
                "model/integration management were re-hashed. Runtime helpers, desktop "
                "services, sharing transport, and live policy enforcement are closed or "
                "environment-bound. Edges from cursor-cli-host stay unresolved."
            ),
            "proposeReadingComplete": False,
            "proposeDependenciesEnumerated": False,
            "excludeFromNodeMutations": True,
        }
    )

    # Bun official capture as supporting inventory (source-bun-runtime already readingComplete)
    bun_sources = [
        file_entry(
            ROOT / bun["localBunVersionCapture"],
            [{"locator": "local bun --version capture", "text": bun.get("localBunStdout", "")}],
        ),
        file_entry(
            ROOT / bun["metaPath"],
            [{"locator": "pinStatus", "text": bun.get("pinStatus", "")}],
        ),
    ]
    for doc in bun.get("docs") or []:
        if doc.get("path"):
            bun_sources.append(
                file_entry(
                    ROOT / doc["path"],
                    [{"locator": f"docs {doc['label']}", "text": doc.get("url", "")}],
                )
            )
    entries.append(
        {
            "nodeId": "bun-official-contracts-capture",
            "previouslyIncomplete": False,
            "inventoryOnly": True,
            "sourcesRead": bun_sources,
            "disposition": bun["note"],
            "proposeReadingComplete": False,
            "proposeDependenciesEnumerated": False,
            "excludeFromNodeMutations": True,
            "pinStatus": bun.get("pinStatus"),
        }
    )

    inventory = {
        "schemaVersion": 1,
        "unit": "u-dep-closure-wave-002",
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lockPath": str(LOCK_PATH.relative_to(ROOT)),
        "lockSha256": sha256_file(LOCK_PATH),
        "nodes": entries,
        "nodeCount": len(entries),
        "additionalIncompleteNodesInventoried": sum(
            1
            for e in entries
            if e.get("previouslyIncomplete") and not e.get("excludeFromNodeMutations")
        ),
        "bunOfficialCapture": bun.get("metaPath"),
    }
    (WAVE / "read-inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")
    return inventory


def write_node_notes(inventory: dict) -> None:
    for entry in inventory["nodes"]:
        if entry.get("excludeFromNodeMutations") and entry["nodeId"].startswith(
            ("host-edge", "bun-official")
        ):
            safe = entry["nodeId"].replace(":", "__").replace("/", "__")
        else:
            safe = entry["nodeId"].replace(":", "__").replace("/", "__")
        path = WAVE / "nodes" / f"{safe}.md"
        lines = [
            f"# {entry['nodeId']}",
            "",
            f"Previously incomplete: {entry.get('previouslyIncomplete')}",
            "",
            "## Disposition",
            "",
            entry["disposition"],
            "",
            f"proposeReadingComplete: {entry.get('proposeReadingComplete')}",
            f"proposeDependenciesEnumerated: {entry.get('proposeDependenciesEnumerated')}",
            "",
            "## Sources",
            "",
        ]
        for src in entry.get("sourcesRead") or []:
            lines.append(
                f"- `{src['path']}` sha256=`{src['sha256']}` bytes={src['byteLength']}"
            )
            for q in src.get("quotes") or []:
                lines.append(f"  - {q['locator']}:")
                lines.append("```")
                lines.append(q["text"])
                lines.append("```")
        path.write_text("\n".join(lines) + "\n")


def build_proposal(inventory: dict, bun: dict) -> dict:
    node_mutations = []
    for entry in inventory["nodes"]:
        if entry.get("excludeFromNodeMutations"):
            continue
        mut = {
            "id": entry["nodeId"],
            "set": {},
            "evidence": [
                "parity/research/dep-closure-wave-002/read-inventory.json",
            ],
            "disposition": entry["disposition"],
        }
        note = (
            WAVE
            / "nodes"
            / f"{entry['nodeId'].replace(':', '__').replace('/', '__')}.md"
        )
        if note.exists():
            mut["evidence"].append(str(note.relative_to(ROOT)))
        npm = entry.get("npmRetrieval") or {}
        if npm.get("retrievalPath"):
            mut["set"]["readingEvidence"] = [
                "parity/research/dep-closure-wave-002/read-inventory.json",
                npm["retrievalPath"],
            ]
        if entry.get("proposeReadingComplete"):
            mut["set"]["readingComplete"] = True
        if entry.get("proposeDependenciesEnumerated"):
            mut["set"]["dependenciesEnumerated"] = True
        if mut["set"]:
            node_mutations.append(mut)

    edge_mutations = []
    deps = json.loads((ROOT / "parity/dependencies.json").read_text())
    completed_platforms = {
        e["nodeId"]
        for e in inventory["nodes"]
        if e.get("proposeReadingComplete")
        and e["nodeId"].startswith("npm:@typescript/")
    }
    for edge in deps["edges"]:
        if edge.get("status") != "unresolved":
            continue
        frm, to = edge["from"], edge["to"]
        if frm == "npm:typescript@7.0.2" and to in completed_platforms:
            edge_mutations.append(
                {
                    "from": frm,
                    "to": to,
                    "set": {"status": "resolved"},
                    "evidence": [
                        "parity/research/dep-closure-wave-002/read-inventory.json",
                        "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bun.lock",
                    ],
                    "note": (
                        "Lock and registry agree on optional platform package; "
                        "package metadata and file inventory read. Runtime activation "
                        "on target os/cpu still unverified."
                    ),
                }
            )

    # Explicit honest unresolved notes for host edges (no status change)
    honest_unresolved = [
        {
            "from": "cursor-cli-host",
            "to": "cursor-self-hosted-computer-use",
            "keepStatus": "unresolved",
            "evidence": [
                "parity/research/continuation/computer-use.md",
                "parity/research/dep-closure-wave-002/nodes/host-edge-disposition__computer-use-enterprise.md",
            ],
            "note": (
                "Public docs re-hashed. Runtime computer-use helpers, desktop services, "
                "and sharing transport remain closed or environment-bound. Do not resolve."
            ),
        },
        {
            "from": "cursor-cli-host",
            "to": "cursor-enterprise-integration-policy",
            "keepStatus": "unresolved",
            "evidence": [
                "parity/research/continuation/model-management.md",
                "parity/research/dep-closure-wave-002/nodes/host-edge-disposition__computer-use-enterprise.md",
            ],
            "note": (
                "Public docs re-hashed. Live enterprise policy enforcement and "
                "IDE/CLI applicability remain unresolved. Do not resolve."
            ),
        },
        {
            "from": "npm:commander@14.0.0",
            "to": "source-bun-runtime",
            "keepStatus": "unresolved",
            "evidence": [
                bun.get("metaPath", "parity/research/dep-closure-wave-002/bun/official-capture.json"),
            ],
            "note": (
                "Local bun version and official docs captured, but no exact runtime "
                "version pin binds commander consumers to Bun. Keep unresolved."
            ),
        },
    ]

    unresolved_ref_mutations = {
        "removeIfPresent": [
            "npm:typescript@7.0.2 full distribution tree reading incomplete (package.json + tarball captured only).",
        ],
        "add": [
            (
                "npm:typescript@7.0.2 full tree file hashes captured at "
                "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/file-inventory.json; "
                "semantic per-file contract audit still open."
            ),
            (
                "cursor-cli-host edges to computer-use and enterprise policy remain unresolved "
                "after public-doc re-hash; runtime services closed or environment-bound."
            ),
            (
                "Official Bun runtime version pin under source-bun-runtime remains unresolved "
                f"after capture at {bun.get('metaPath')}."
            ),
        ],
        "keep": [
            "Required live integrations, cloud services, automation editor, models and supporting tools.",
            "Recursive references in inspected sources still require complete extraction and audit.",
            "Fetch exact registry metadata and tarballs, verify integrity and licenses, inspect relevant contracts and transitive dependencies.",
            "Determine runtime/platform prerequisites from official Bun and package contracts.",
            "Audit all platform-conditional branches, including literal cpu/os none entries in this lock.",
            "Bind each package to runtime versus test/typecheck consumers before acceptance.",
            "cursor-create-skill subordinate workflows and journey audit remain open after SKILL.md capture at parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md.",
        ],
        "note": (
            "Clear the prior full-tree-incomplete typescript line. Broader fetch/audit "
            "and Bun pin items stay. Host computer-use/enterprise edges stay unresolved."
        ),
    }

    proposal = {
        "schemaVersion": 1,
        "unit": "u-dep-closure-wave-002",
        "status": "proposal-unverified-pending-coordinator-merge",
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "targets": {
            "dependenciesJson": "parity/dependencies.json",
            "sourceLockJson": "parity/source-lock.json",
        },
        "closureAudited": False,
        "closureAuditedNote": (
            "Leave closureAudited false. No independent audit artifact produced."
        ),
        "dependencies": {
            "nodeMutations": node_mutations,
            "edgeMutations": edge_mutations,
            "honestUnresolvedEdges": honest_unresolved,
            "unresolvedReferences": unresolved_ref_mutations,
        },
        "sourceLock": {
            "cursorPlugins.completeDependencyClosure": {
                "set": False,
                "note": "Leave false.",
            },
            "openWork": {
                "removeIfPresent": [],
                "keep": [
                    "Hash every distributed source item and runtime dependency.",
                    "Read and audit complete dependency closure.",
                    "Capture reference configuration and working optional integrations.",
                    "Resolve and verify the complete Pi runtime dependency lock.",
                    "Verify release support and configuration against current official CLI Markdown contracts.",
                    "Have independent acceptance owner review and freeze source lock.",
                ],
                "note": (
                    "Platform package inventories and typescript full-tree hashes advance "
                    "hash/closure items but do not complete them. Do not remove openWork rows."
                ),
            },
        },
        "remainingGaps": [
            "cursor-cli-host dependenciesEnumerated still false; computer-use and enterprise edges stay unresolved.",
            "source-bun-runtime lacks an official Bun version pin despite docs/version capture.",
            "typescript full-tree hashes landed; semantic per-file audit still open.",
            "Several non-platform edges remain unresolved (bootstrap/manifest/commander/team-kit).",
            "closureAudited remains false; queue independent audit.",
        ],
        "doNotEdit": [
            "parity/dependencies.json",
            "parity/source-lock.json",
            "parity/requirements.json",
            "parity/mismatches.json",
            "parity/progress.md",
        ],
    }
    (WAVE / "merge-proposal.json").write_text(json.dumps(proposal, indent=2) + "\n")
    return proposal


def verify_inventory(inventory: dict) -> dict:
    mismatches = []
    checked = 0
    for entry in inventory["nodes"]:
        for src in entry.get("sourcesRead") or []:
            abs_path = Path(src["absolutePath"])
            if not abs_path.exists():
                abs_path = ROOT / src["path"]
            if not abs_path.exists():
                mismatches.append({"path": src["path"], "error": "missing"})
                continue
            actual = sha256_file(abs_path)
            checked += 1
            if actual != src["sha256"]:
                mismatches.append(
                    {
                        "path": src["path"],
                        "expected": src["sha256"],
                        "actual": actual,
                    }
                )
    lock_actual = sha256_file(LOCK_PATH)
    if lock_actual != inventory["lockSha256"]:
        mismatches.append(
            {
                "path": inventory["lockPath"],
                "expected": inventory["lockSha256"],
                "actual": lock_actual,
            }
        )
    result = {
        "checkedFiles": checked,
        "mismatchCount": len(mismatches),
        "mismatches": mismatches,
        "verifiedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "verdict": "VERIFIED" if not mismatches else "NOT VERIFIED",
    }
    (WAVE / "verify-hashes.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def write_selection() -> None:
    deps = json.loads((ROOT / "parity/dependencies.json").read_text())
    incomplete = [n["id"] for n in deps["nodes"] if not n.get("readingComplete")]
    selection = {
        "selectedNodeIds": [f"npm:{n}@{v}" for n, v in PLATFORM_PACKAGES]
        + ["npm:typescript@7.0.2"],
        "incompleteCountBefore": len(incomplete),
        "selectionRationale": (
            "All remaining incomplete @typescript/* platform packages plus "
            "typescript@7.0.2 full-tree file-hash inventory. Host computer-use/"
            "enterprise and Bun official pin get honest unresolved dispositions."
        ),
    }
    (WAVE / "selection.json").write_text(json.dumps(selection, indent=2) + "\n")


def main() -> None:
    WAVE.mkdir(parents=True, exist_ok=True)
    (WAVE / "npm").mkdir(exist_ok=True)
    (WAVE / "nodes").mkdir(exist_ok=True)

    write_selection()

    platform_meta = {}
    for name, version in PLATFORM_PACKAGES:
        print(f"fetch {name}@{version}", flush=True)
        platform_meta[f"npm:{name}@{version}"] = fetch_registry(name, version)

    print("inventory typescript full tree", flush=True)
    ts_meta = inventory_typescript_full_tree()

    print("capture bun official", flush=True)
    bun = capture_bun_official()

    print("build inventory", flush=True)
    inventory = build_inventory(platform_meta, ts_meta, bun)
    write_node_notes(inventory)

    print("build proposal", flush=True)
    proposal = build_proposal(inventory, bun)

    print("verify", flush=True)
    verify = verify_inventory(inventory)
    print(
        json.dumps(
            {
                "nodes": inventory["nodeCount"],
                "additionalIncomplete": inventory[
                    "additionalIncompleteNodesInventoried"
                ],
                "verify": verify["verdict"],
                "proposalNodes": len(proposal["dependencies"]["nodeMutations"]),
                "proposalEdges": len(proposal["dependencies"]["edgeMutations"]),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
