#!/usr/bin/env python3
"""Build u-dep-closure-wave-007 research artifacts. Does not edit ledgers."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
WAVE = Path(__file__).resolve().parent
UNIT = "u-dep-closure-wave-007"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
SCRIPTS = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts"
LOCK = SCRIPTS / "bun.lock"
PKG_JSON = SCRIPTS / "package.json"
POTETO = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode"
PLUGINS = ROOT / "parity/reference/cursor-plugins"
DIST_INV = ROOT / "parity/reference/distribution-inventory.txt"
TS_BODY_AUDIT = (
    ROOT / "parity/research/dep-closure-wave-005/npm/typescript-body-audit.json"
)
TS_DEEP_006 = (
    ROOT
    / "parity/research/dep-closure-wave-006/npm/typescript-deep-semantics-disposition.json"
)
CREATE_SKILL = (
    ROOT / "parity/research/dep-closure-wave-001/nodes/cursor-create-skill/SKILL.md"
)
LIVE_CREATE_SKILL = Path.home() / ".cursor/skills-cursor/create-skill/SKILL.md"
COMPUTER_USE = ROOT / "parity/research/continuation/computer-use.md"
MODEL_MGMT = ROOT / "parity/research/continuation/model-management.md"
CONSUMER_BINDING = (
    ROOT / "parity/research/dep-closure-wave-003/consumer-binding.json"
)
LINKED_QUEUE = ROOT / "parity/research/cursor-host/linked-document-queue.json"
SERVICES_PROPOSALS = ROOT / "parity/research/cursor-host/services/proposals.json"
REFCFG = ROOT / "parity/research/dep-closure-wave-001/refcfg/working-env-snapshot.json"
CLI_SNAPSHOTS = ROOT / "parity/research/cursor-host/cli/parent-snapshots"

BUN_DOCS = [
    ("install", "https://bun.com/docs/installation", "install.html"),
    ("lockfile", "https://bun.com/docs/pm/lockfile", "lockfile.html"),
    ("nodejs-compat", "https://bun.com/docs/runtime/nodejs-compat", "nodejs-compat.html"),
    ("package-manager", "https://bun.com/docs/pm/cli/install", "package-manager.html"),
    ("bunfig", "https://bun.com/docs/runtime/bunfig", "bunfig.html"),
]
LEGACY_BUN_VERSION_GUIDE = "https://bun.com/docs/guides/install/bun-version"

URL_RE = re.compile(r"https?://[^\s\)\]\>\"']+")
MD_LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)]+)\)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)
CHECK_RE = re.compile(r"^\s*-\s*\[[ xX]\]\s+(.+)$", re.M)
TEXT_SUFFIXES = {
    ".md",
    ".txt",
    ".json",
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".toml",
    ".yml",
    ".yaml",
    ".sh",
    ".css",
    ".html",
    ".svg",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=False) + "\n")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text if text.endswith("\n") else text + "\n")


def load_bun_lock(path: Path) -> dict:
    raw = path.read_text()
    clean = re.sub(r",\s*([}\]])", r"\1", raw)
    return json.loads(clean)


def fetch_url(url: str, body_path: Path, headers_path: Path) -> dict:
    req = Request(url, headers={"User-Agent": "pi-pstack-parity-dep-closure/7"})
    try:
        with urlopen(req, timeout=60) as resp:
            body = resp.read()
            header_lines = [f"HTTP {resp.status}"]
            for k, v in resp.headers.items():
                header_lines.append(f"{k}: {v}")
            final_url = resp.geturl()
    except HTTPError as exc:
        err_body = exc.read() if exc.fp else b""
        body_path.parent.mkdir(parents=True, exist_ok=True)
        write_text(headers_path, f"HTTP {exc.code}\n{exc.reason}\n")
        if err_body:
            body_path.write_bytes(err_body)
        return {
            "url": url,
            "path": rel(body_path) if err_body else None,
            "sha256": sha256_bytes(err_body) if err_body else None,
            "byteLength": len(err_body),
            "headersPath": rel(headers_path),
            "status": "http_error",
            "httpStatus": exc.code,
            "reason": exc.reason,
        }
    except URLError as exc:
        write_text(headers_path, f"URLError {exc.reason}\n")
        return {
            "url": url,
            "path": None,
            "sha256": None,
            "byteLength": 0,
            "headersPath": rel(headers_path),
            "status": "url_error",
            "reason": str(exc.reason),
        }
    body_path.parent.mkdir(parents=True, exist_ok=True)
    body_path.write_bytes(body)
    write_text(headers_path, "\n".join(header_lines) + "\n")
    return {
        "url": url,
        "finalUrl": final_url,
        "path": rel(body_path),
        "sha256": sha256_bytes(body),
        "byteLength": len(body),
        "headersPath": rel(headers_path),
        "status": "fetched",
    }


def capture_local_bun_version() -> tuple[str, Path]:
    out = subprocess.check_output(["bun", "--version"], text=True).strip()
    path = WAVE / "bun/bun-version.txt"
    write_text(path, out + "\n")
    return out, path


def which_bun() -> str | None:
    try:
        return subprocess.check_output(["which", "bun"], text=True).strip()
    except subprocess.CalledProcessError:
        return None


def find_pin_files(root: Path) -> list[dict]:
    names = {
        ".bun-version",
        "bunfig.toml",
        ".nvmrc",
        ".node-version",
        "mise.toml",
        ".tool-versions",
    }
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {".git", "node_modules"}]
        for name in filenames:
            if name in names:
                p = Path(dirpath) / name
                found.append(
                    {
                        "path": rel(p),
                        "sha256": sha256(p),
                        "byteLength": p.stat().st_size,
                    }
                )
    return found


def shebang_bun_files(root: Path) -> list[dict]:
    hits = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in {".git", "node_modules"}]
        for name in filenames:
            p = Path(dirpath) / name
            try:
                first = p.read_bytes()[:80]
            except OSError:
                continue
            if first.startswith(b"#!/usr/bin/env bun") or first.startswith(b"#!/usr/bin/bun"):
                hits.append(
                    {
                        "path": rel(p),
                        "firstLine": first.splitlines()[0].decode("utf-8", "replace"),
                    }
                )
    return hits


def build_bun_capture() -> dict:
    local_version, version_txt = capture_local_bun_version()
    bun_path = which_bun()
    pkg = json.loads(PKG_JSON.read_text())
    lock = load_bun_lock(LOCK)
    packages = lock.get("packages") or {}
    bun_types_key = None
    for key in packages:
        if key == "bun-types" or key.startswith("bun-types@"):
            bun_types_key = key
            break

    docs = []
    for label, url, fname in BUN_DOCS:
        meta = fetch_url(
            url, WAVE / "bun" / fname, WAVE / "bun" / f"{Path(fname).stem}.headers.txt"
        )
        docs.append({"label": label, **meta})

    legacy_guide = fetch_url(
        LEGACY_BUN_VERSION_GUIDE,
        WAVE / "bun/bun-version-docs.html",
        WAVE / "bun/bun-version-docs.headers.txt",
    )
    docs.append(
        {
            "label": "bun-version-docs-legacy",
            "note": (
                "Legacy guide URL. Pin guidance lives under installation older-versions "
                "and bunfig docs."
            ),
            **legacy_guide,
        }
    )

    pin_files_under_poteto = find_pin_files(POTETO)
    shebangs = shebang_bun_files(SCRIPTS)

    pin_candidates = {
        "package.json.engines": pkg.get("engines"),
        "package.json.packageManager": pkg.get("packageManager"),
        "package.json.volta": pkg.get("volta"),
        "package.json.devEngines": pkg.get("devEngines"),
        "dotBunVersionFile": (SCRIPTS / ".bun-version").exists(),
        "bunfigToml": (SCRIPTS / "bunfig.toml").exists(),
        "miseToml": (SCRIPTS / "mise.toml").exists(),
        "toolVersions": (SCRIPTS / ".tool-versions").exists(),
        "nvmrc": (SCRIPTS / ".nvmrc").exists(),
        "nodeVersion": (SCRIPTS / ".node-version").exists(),
        "bunLockPinsBunBinary": False,
        "pinFilesUnderPotetoMode": pin_files_under_poteto,
        "shebangEnvBunFiles": shebangs,
        "hostWhichBun": bun_path,
        "hostWhichBunIsMiseLatest": bool(
            bun_path and "/mise/installs/bun/latest/" in bun_path
        ),
    }

    return {
        "capturedAt": NOW,
        "localBunVersionCapture": rel(version_txt),
        "localBunVersionSha256": sha256(version_txt),
        "localBunStdout": local_version,
        "docs": docs,
        "pinCandidatesChecked": pin_candidates,
        "manifestDevDependencies": pkg.get("devDependencies"),
        "lockBunTypesResolved": bun_types_key,
        "typesVersusRuntimeNote": (
            f"Lock resolves {bun_types_key}; local bun --version is {local_version}. "
            "bun-types is not an official Bun runtime pin. Host bun from mise 'latest' "
            "is environment state, not a tools subtree pin."
        ),
        "pinStatus": "unresolved",
        "closureCriteria": [
            "Exact Bun binary version declared in tools subtree via engines.bun, packageManager, volta, .bun-version, bunfig, or equivalent lock binding",
            "Declaration must be in source custody under poteto-mode/scripts or a documented official pin path for this package",
        ],
        "note": (
            "Wave-007 re-probed tools scripts and poteto-mode tree for pin files, "
            "recorded shebang usage and host mise-latest path, and re-fetched official "
            "Bun docs. No official Bun binary pin exists. Do not invent a pin from "
            "local version, mise latest, or bun-types."
        ),
    }


def build_typescript_deep_disposition() -> dict:
    audit = json.loads(TS_BODY_AUDIT.read_text())
    deep_files = [
        {
            "path": f["path"],
            "role": f["role"],
            "sha256": f["sha256"],
            "byteLength": f["byteLength"],
            "bodyAudit": f.get("bodyAudit"),
            "exportStatementCount": f.get("exportStatementCount"),
            "importStatementCount": f.get("importStatementCount"),
            "requireCallCount": f.get("requireCallCount"),
        }
        for f in audit["files"]
        if f.get("bodyAudit") == "internal_module_surface"
        or f.get("role") in {"ast-internal", "enums-internal", "dist-internal"}
    ]
    role_counts: Counter[str] = Counter(f["role"] for f in deep_files)

    prior = json.loads(TS_DEEP_006.read_text()) if TS_DEEP_006.exists() else {}
    prior_paths = {f["path"]: f["sha256"] for f in prior.get("files", [])}
    hash_drift = [
        {"path": f["path"], "wave007": f["sha256"], "wave006": prior_paths.get(f["path"])}
        for f in deep_files
        if prior_paths.get(f["path"]) and prior_paths[f["path"]] != f["sha256"]
    ]

    version_probe: dict
    try:
        proc = subprocess.run(
            ["bun", "x", "typescript@7.0.2", "tsc", "--version"],
            cwd=str(SCRIPTS),
            capture_output=True,
            text=True,
            timeout=120,
        )
        version_probe = {
            "command": "bun x typescript@7.0.2 tsc --version",
            "cwd": rel(SCRIPTS),
            "exitCode": proc.returncode,
            "stdout": (proc.stdout or proc.stderr or "").strip(),
            "note": "Package activation only. Not deep compiler-behavior semantics.",
        }
    except Exception as exc:  # noqa: BLE001
        version_probe = {"error": str(exc), "status": "probe_failed"}

    typecheck_probe: dict
    try:
        proc = subprocess.run(
            ["bun", "run", "typecheck"],
            cwd=str(SCRIPTS),
            capture_output=True,
            text=True,
            timeout=180,
        )
        typecheck_probe = {
            "command": "bun run typecheck",
            "cwd": rel(SCRIPTS),
            "exitCode": proc.returncode,
            "stdoutTail": (proc.stdout or "")[-2000:],
            "stderrTail": (proc.stderr or "")[-2000:],
            "note": (
                "Tools consumer typecheck via locked typescript. Proves watch-pr "
                "project typechecks under the installed toolchain. Does not prove "
                "AST/enum/internal helper semantics for all 136 internal dist files."
            ),
        }
    except Exception as exc:  # noqa: BLE001
        typecheck_probe = {"error": str(exc), "status": "probe_failed"}

    return {
        "capturedAt": NOW,
        "package": "typescript@7.0.2",
        "priorStructuralAudit": rel(TS_BODY_AUDIT),
        "priorStructuralAuditSha256": sha256(TS_BODY_AUDIT),
        "priorWave006Disposition": rel(TS_DEEP_006) if TS_DEEP_006.exists() else None,
        "structuralBodyAuditComplete": audit.get("structuralBodyAuditComplete"),
        "deepInternalFileCount": len(deep_files),
        "deepRoleCounts": dict(role_counts),
        "catalogHashDriftFromWave006": hash_drift,
        "catalogHashDriftCount": len(hash_drift),
        "deepCompilerSemanticsStatus": "still_open",
        "disposition": (
            "Structural body-contract audit from wave-005 remains complete. Wave-007 "
            f"re-verified the {len(deep_files)} internal_module_surface catalog against "
            "wave-006 hashes and ran the tools consumer typecheck script. Deep "
            "compiler-behavior semantics stay open."
        ),
        "closureCriteria": [
            "Behavioral proof that AST/enum/internal helpers match TypeScript@7.0.2 contracts under a typecheck or compiler-test oracle",
            "Paired consumer typecheck journeys alone do not prove internal module semantics for all 136 files",
            "Do not mark readingComplete true for deep semantics on structural facts alone",
        ],
        "blocker": (
            "No compiler-test oracle or exhaustive internal-behavior journey was run "
            "against the 136 ast-internal/enums-internal/dist-internal files. "
            "Structural hashes, catalog re-verify, and consumer typecheck are not "
            "compiler-semantics proof."
        ),
        "consumerActivationProbe": version_probe,
        "consumerTypecheckProbe": typecheck_probe,
        "files": deep_files,
    }


def build_host_disposition() -> dict:
    return {
        "capturedAt": NOW,
        "dispositionClass": "environment-bound",
        "edges": [
            {
                "from": "cursor-cli-host",
                "to": "cursor-self-hosted-computer-use",
                "keepStatus": "unresolved",
                "disposition": "environment-bound",
                "evidence": [
                    rel(COMPUTER_USE),
                    "parity/research/dep-closure-wave-007/nodes/host-edge-disposition.md",
                ],
                "docSha256": sha256(COMPUTER_USE),
                "docByteLength": COMPUTER_USE.stat().st_size,
                "blocker": (
                    "Public docs only (computer-use.md). Closing this edge requires "
                    "exercising macOS Cursor Computer Use helper identity "
                    "(co.anysphere.cursor-computer-use / Team ID DCNK4UB866), "
                    "Accessibility and Screen Recording grants, Linux X11/desktop "
                    "packages, and desktop-sharing transport. This worker must not "
                    "fabricate those runtime observations."
                ),
                "docContractsExtracted": [
                    "Explicit opt-in via agent worker --computer-use",
                    "macOS helper Cursor Computer Use with Accessibility + Screen Recording",
                    "Linux X11 display and desktop packages",
                    "Desktop sharing Linux-only via --share-desktop",
                ],
            },
            {
                "from": "cursor-cli-host",
                "to": "cursor-enterprise-integration-policy",
                "keepStatus": "unresolved",
                "disposition": "environment-bound",
                "evidence": [
                    rel(MODEL_MGMT),
                    "parity/research/dep-closure-wave-007/nodes/host-edge-disposition.md",
                ],
                "docSha256": sha256(MODEL_MGMT),
                "docByteLength": MODEL_MGMT.stat().st_size,
                "blocker": (
                    "Public docs only (model-management.md). Closing this edge requires "
                    "observing live Enterprise team/org model access, MCP allowlist "
                    "enforcement, and CLI applicability. Standing orders forbid broad "
                    "allowlist or authorization changes."
                ),
                "docContractsExtracted": [
                    "Enterprise model access via Team Settings and Organization Groups",
                    "Most-permissive union of team and group model allowlists",
                    "MCP allowlist / trust management",
                    "BYOK controls on Team Settings only",
                ],
            },
        ],
        "journeyEdgesUnchanged": [
            {
                "from": "cursor-pstack",
                "to": "cursor-team-kit",
                "keepStatus": "unverified",
                "blocker": (
                    "Distribution custody exists. Complete source and paired journey "
                    "closure for the full skill set is not shown."
                ),
            },
            {
                "from": "cursor-pstack",
                "to": "cursor-cli-host",
                "keepStatus": "unverified",
                "blocker": (
                    "Persistent-mode editor actions (Option/Alt+Enter) and later-turn "
                    "behavior still need paired Cursor+Pi runtime evidence."
                ),
            },
        ],
        "note": (
            "Wave-007 re-hashed public continuation docs. Edges remain "
            "environment-bound unresolved. Runtime helpers and org policy were not "
            "exercised."
        ),
    }


def build_create_skill_journey_matrix() -> dict:
    text = CREATE_SKILL.read_text()
    live_sha = sha256(LIVE_CREATE_SKILL) if LIVE_CREATE_SKILL.exists() else None
    captured_sha = sha256(CREATE_SKILL)
    headings = [
        {"level": len(m.group(1)), "title": m.group(2).strip(), "offset": m.start()}
        for m in HEADING_RE.finditer(text)
    ]
    checks = CHECK_RE.findall(text)
    phases = [h for h in headings if h["title"].startswith("Phase ")]
    journeys = [
        {
            "id": "create-skill-discovery",
            "title": "Phase 1 Discovery paired journey",
            "requiredEvidence": "Cursor+Pi pair that gathers skill requirements per Phase 1",
            "status": "not_run",
        },
        {
            "id": "create-skill-design",
            "title": "Phase 2 Design paired journey",
            "requiredEvidence": "Cursor+Pi pair that produces skill design artifacts per Phase 2",
            "status": "not_run",
        },
        {
            "id": "create-skill-implementation",
            "title": "Phase 3 Implementation paired journey",
            "requiredEvidence": "Cursor+Pi pair that writes SKILL.md via /create-skill or equivalent",
            "status": "not_run",
        },
        {
            "id": "create-skill-verification",
            "title": "Phase 4 Verification paired journey",
            "requiredEvidence": "Cursor+Pi pair that verifies discovery and application of the authored skill",
            "status": "not_run",
        },
    ]
    return {
        "capturedAt": NOW,
        "skillPath": rel(CREATE_SKILL),
        "skillSha256": captured_sha,
        "skillByteLength": CREATE_SKILL.stat().st_size,
        "liveInstallPath": str(LIVE_CREATE_SKILL),
        "liveInstallSha256": live_sha,
        "captureMatchesLiveInstall": live_sha == captured_sha,
        "phaseSections": phases,
        "phaseSectionCount": len(phases),
        "checklistItemCount": len(checks),
        "priorSubordinateAudit": (
            "parity/research/dep-closure-wave-006/create-skill/subordinate-audit.json"
        ),
        "journeyMatrix": journeys,
        "journeyAuditStatus": "open",
        "journeyMatrixStatus": "complete",
        "disposition": (
            "Wave-007 derives a four-phase paired-journey acceptance matrix from the "
            "captured create-skill SKILL.md and re-checks capture vs live install hash. "
            "Subordinate inventory from wave-006 stands. No paired Cursor+Pi journey "
            "was run."
        ),
        "blockerForJourneyClosure": (
            "Paired Cursor+Pi user journeys across Discovery, Design, Implementation, "
            "and Verification remain required."
        ),
    }


def is_external_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:  # noqa: BLE001
        return False
    if parsed.scheme not in {"http", "https"}:
        return False
    host = (parsed.netloc or "").lower()
    if not host:
        return False
    return True


def build_recursive_extraction() -> dict:
    inventory_paths = [
        line.strip()
        for line in DIST_INV.read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    sources_scanned = []
    refs: list[dict] = []
    seen: set[tuple[str, str]] = set()
    scanned = 0
    skipped_binary = 0

    for inv_path in inventory_paths:
        abs_path = PLUGINS / inv_path
        if not abs_path.exists() or not abs_path.is_file():
            continue
        suffix = abs_path.suffix.lower()
        if suffix and suffix not in TEXT_SUFFIXES and abs_path.name not in {
            "LICENSE",
            "watch-pr",
        }:
            # Still attempt small text files without suffix.
            try:
                sample = abs_path.read_bytes()[:256]
            except OSError:
                skipped_binary += 1
                continue
            if b"\0" in sample:
                skipped_binary += 1
                continue
        try:
            text = abs_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            skipped_binary += 1
            continue
        scanned += 1
        file_sha = sha256(abs_path)
        sources_scanned.append(
            {
                "path": f"parity/reference/cursor-plugins/{inv_path}",
                "inventoryPath": inv_path,
                "sha256": file_sha,
                "byteLength": abs_path.stat().st_size,
            }
        )
        for url in URL_RE.findall(text):
            url = url.rstrip(".,;:)")
            if not is_external_url(url):
                continue
            key = (inv_path, url)
            if key in seen:
                continue
            seen.add(key)
            refs.append(
                {
                    "kind": "absolute_url",
                    "target": url,
                    "host": urlparse(url).netloc.lower(),
                    "fromInventoryPath": inv_path,
                    "fromSha256": file_sha,
                }
            )
        for _label, target in MD_LINK_RE.findall(text):
            target = target.strip()
            if target.startswith("#") or target.startswith("mailto:"):
                continue
            if target.startswith("http://") or target.startswith("https://"):
                continue
            # Relative markdown links that leave the containing plugin tree.
            if target.startswith("/") or ".." in Path(target).parts:
                key = (inv_path, f"rel:{target}")
                if key in seen:
                    continue
                seen.add(key)
                refs.append(
                    {
                        "kind": "relative_escape",
                        "target": target,
                        "fromInventoryPath": inv_path,
                        "fromSha256": file_sha,
                    }
                )

    host_counts = Counter(r["host"] for r in refs if r["kind"] == "absolute_url")
    return {
        "capturedAt": NOW,
        "distributionInventory": rel(DIST_INV),
        "distributionInventorySha256": sha256(DIST_INV),
        "inventoryEntryCount": len(inventory_paths),
        "textFilesScanned": scanned,
        "binaryOrUnreadableSkipped": skipped_binary,
        "extractionStatus": "complete",
        "runtimeAuditStatus": "open",
        "uniqueReferenceCount": len(refs),
        "absoluteUrlCount": sum(1 for r in refs if r["kind"] == "absolute_url"),
        "relativeEscapeCount": sum(1 for r in refs if r["kind"] == "relative_escape"),
        "topHosts": host_counts.most_common(20),
        "disposition": (
            "Wave-007 extracted absolute URLs and relative-escape markdown links from "
            f"every readable text file in the locked distribution inventory "
            f"({scanned} files). Extraction is complete with path+hash custody of "
            "source files. Live/runtime audit of extracted external targets remains open."
        ),
        "blockerForRuntimeAudit": (
            "Extracted external URLs and escape links require follow-up custody and "
            "behavioral audit. This wave records extraction only."
        ),
        "sourcesScanned": sources_scanned,
        "references": refs,
    }


def build_live_integrations_inventory() -> dict:
    items: list[dict] = []

    if LINKED_QUEUE.exists():
        queue = json.loads(LINKED_QUEUE.read_text())
        for entry in queue.get("items") or []:
            items.append(
                {
                    "source": "linked-document-queue",
                    "id": entry.get("id") or entry.get("url") or entry.get("path"),
                    "status": entry.get("status"),
                    "url": entry.get("url"),
                    "path": entry.get("path") or entry.get("preserved_source_file"),
                    "note": entry.get("note") or entry.get("title"),
                }
            )

    if SERVICES_PROPOSALS.exists():
        proposals = json.loads(SERVICES_PROPOSALS.read_text())
        nodes = proposals if isinstance(proposals, list) else proposals.get("nodes") or proposals.get("proposals") or []
        for node in nodes:
            if not isinstance(node, dict):
                continue
            nid = node.get("id") or node.get("nodeId") or ""
            owned = node.get("owned_behavior") or node.get("ownedBehavior") or ""
            blob = f"{nid} {owned}".lower()
            if any(
                k in blob
                for k in (
                    "automation",
                    "mcp",
                    "model",
                    "cloud",
                    "integration",
                    "secret",
                    "browser",
                    "routine",
                )
            ):
                items.append(
                    {
                        "source": "services-proposals",
                        "id": nid,
                        "ownedBehavior": owned,
                        "path": node.get("preserved_source_file")
                        or node.get("source_file"),
                    }
                )

    snapshot_hits = []
    if CLI_SNAPSHOTS.exists():
        for path in sorted(CLI_SNAPSHOTS.glob("*.md")):
            text = path.read_text(encoding="utf-8", errors="replace")
            lowered = text.lower()
            tags = [
                tag
                for tag in (
                    "mcp",
                    "automation",
                    "model",
                    "cloud",
                    "integration",
                    "editor",
                    "shell",
                )
                if tag in lowered
            ]
            if tags:
                snapshot_hits.append(
                    {
                        "path": rel(path),
                        "sha256": sha256(path),
                        "tags": tags,
                        "byteLength": path.stat().st_size,
                    }
                )

    refcfg = None
    if REFCFG.exists():
        refcfg = {
            "path": rel(REFCFG),
            "sha256": sha256(REFCFG),
            "byteLength": REFCFG.stat().st_size,
            "note": (
                "Working-env snapshot exists from wave-001. Does not prove the full "
                "multi-integration reference configuration matrix."
            ),
        }

    # Deduplicate by id/path string.
    deduped = []
    seen_ids: set[str] = set()
    for item in items:
        key = str(item.get("id") or item.get("path") or item)
        if key in seen_ids:
            continue
        seen_ids.add(key)
        deduped.append(item)

    return {
        "capturedAt": NOW,
        "inventoryStatus": "complete",
        "liveExerciseStatus": "open",
        "itemCount": len(deduped),
        "cliSnapshotHits": snapshot_hits,
        "cliSnapshotHitCount": len(snapshot_hits),
        "workingEnvSnapshot": refcfg,
        "linkedQueuePath": rel(LINKED_QUEUE) if LINKED_QUEUE.exists() else None,
        "servicesProposalsPath": rel(SERVICES_PROPOSALS)
        if SERVICES_PROPOSALS.exists()
        else None,
        "disposition": (
            "Wave-007 inventories required live integrations, cloud/automation/MCP/"
            "model contracts from the linked-document queue, services proposals, and "
            "CLI parent snapshots, with path+hash on snapshot sources. Live exercise "
            "of those integrations and the automation editor remains open."
        ),
        "blockerForLiveExercise": (
            "Inventoried integrations require authorized live configuration and "
            "paired runtime journeys. Standing orders forbid fabricating liveness or "
            "broad authorization changes."
        ),
        "items": deduped,
    }


def build_consumer_journey_matrix() -> dict:
    binding = json.loads(CONSUMER_BINDING.read_text())
    journeys = []

    # Local tool smokes that do not claim Cursor+Pi paired acceptance.
    smokes = []
    try:
        proc = subprocess.run(
            ["bun", "run", str(SCRIPTS / "orch/orch.ts"), "--help"],
            cwd=str(SCRIPTS),
            capture_output=True,
            text=True,
            timeout=60,
        )
        smokes.append(
            {
                "id": "orch-help",
                "command": "bun run orch/orch.ts --help",
                "exitCode": proc.returncode,
                "stdoutTail": (proc.stdout or "")[-500:],
                "stderrTail": (proc.stderr or "")[-500:],
            }
        )
    except Exception as exc:  # noqa: BLE001
        smokes.append({"id": "orch-help", "error": str(exc)})

    try:
        proc = subprocess.run(
            ["bun", "run", "typecheck"],
            cwd=str(SCRIPTS),
            capture_output=True,
            text=True,
            timeout=180,
        )
        smokes.append(
            {
                "id": "tools-typecheck",
                "command": "bun run typecheck",
                "exitCode": proc.returncode,
                "stdoutTail": (proc.stdout or "")[-500:],
                "stderrTail": (proc.stderr or "")[-500:],
            }
        )
    except Exception as exc:  # noqa: BLE001
        smokes.append({"id": "tools-typecheck", "error": str(exc)})

    for pkg in binding.get("packages") or []:
        for consumer in pkg.get("consumers") or []:
            cpath = consumer.get("path")
            abs_c = ROOT / cpath if cpath and not cpath.startswith("/") else Path(cpath or "")
            entry = {
                "packageId": pkg["id"],
                "activation": pkg.get("activation"),
                "consumerPath": cpath,
                "consumerSha256": sha256(abs_c) if abs_c.exists() else None,
                "importOrLocator": consumer.get("import") or consumer.get("locator"),
                "acceptanceJourney": (
                    f"Paired Cursor+Pi journey exercising {pkg['id']} via "
                    f"{cpath or consumer.get('locator')}"
                ),
                "pairedJourneyStatus": "not_run",
            }
            journeys.append(entry)

    journeys.extend(
        [
            {
                "packageId": "source-tools-bootstrap",
                "activation": "install",
                "acceptanceJourney": (
                    "Paired journey proving frozen bun install --frozen-lockfile and "
                    "restart after install-key change"
                ),
                "pairedJourneyStatus": "not_run",
            },
            {
                "packageId": "npm:bun-types@1.3.14",
                "activation": "test",
                "acceptanceJourney": "Paired journey proving bun test orch watch-pr under locked bun-types",
                "pairedJourneyStatus": "not_run",
            },
        ]
    )

    return {
        "capturedAt": NOW,
        "priorConsumerBinding": rel(CONSUMER_BINDING),
        "priorConsumerBindingSha256": sha256(CONSUMER_BINDING),
        "matrixStatus": "complete",
        "pairedAcceptanceStatus": "open",
        "localSmokeStatus": "recorded",
        "journeyCount": len(journeys),
        "journeys": journeys,
        "localSmokes": smokes,
        "disposition": (
            "Wave-007 expands wave-003 consumer binding into an explicit acceptance "
            "journey matrix with consumer path+hash where files exist, and records "
            "local orch --help plus typecheck smokes. Broader paired Cursor+Pi "
            "acceptance journeys remain open."
        ),
        "blockerForPairedAcceptance": (
            "Local smokes are not paired Cursor+Pi user journeys against the shipped "
            "package digest."
        ),
    }


def build_merge_proposal(
    bun: dict,
    ts: dict,
    host: dict,
    create_skill: dict,
    recursive: dict,
    live: dict,
    consumer: dict,
) -> dict:
    bun_line = (
        "Official Bun runtime version pin under source-bun-runtime remains unresolved "
        f"after wave-007 capture at {rel(WAVE / 'bun/official-capture.json')} "
        f"(local {bun['localBunStdout']} only; no engines/packageManager/volta/"
        ".bun-version/bunfig/mise/.tool-versions under tools; host mise bun/latest "
        "and bun-types lock resolve are not runtime pins)."
    )
    ts_line = (
        "npm:typescript@7.0.2 deep compiler-behavior semantics remain open after "
        f"wave-007 disposition at {rel(WAVE / 'npm/typescript-deep-semantics-disposition.json')} "
        f"({ts['deepInternalFileCount']} internal dist files re-verified path+hash; "
        f"catalogHashDriftCount={ts['catalogHashDriftCount']}; consumer typecheck "
        f"exit={((ts.get('consumerTypecheckProbe') or {}).get('exitCode'))}; "
        "no compiler-test oracle for internals)."
    )
    host_line = (
        "cursor-cli-host edges to computer-use and enterprise policy remain unresolved "
        f"after wave-007 environment-bound disposition at "
        f"{rel(WAVE / 'host-edge-disposition.json')}; runtime services were not exercised."
    )
    create_skill_line = (
        "cursor-create-skill journey audit remains open after wave-007 journey matrix "
        f"at {rel(WAVE / 'create-skill/journey-matrix.json')} "
        f"(SKILL.md sha256 {create_skill['skillSha256']}; "
        f"{create_skill['phaseSectionCount']} phase sections; "
        "paired journeys not run)."
    )
    live_line = (
        "Inventoried live integrations, cloud services, automation/MCP/model contracts "
        f"at {rel(WAVE / 'live/integrations-inventory.json')} "
        f"({live['itemCount']} proposal/queue items; "
        f"{live['cliSnapshotHitCount']} CLI snapshot hits; working-env snapshot "
        "hashed). Live exercise and automation-editor runtime remain open."
    )
    recursive_line = (
        "Recursive references extracted from locked distribution inventory at "
        f"{rel(WAVE / 'recursive/extraction.json')} "
        f"({recursive['textFilesScanned']} text files scanned; "
        f"{recursive['uniqueReferenceCount']} unique refs; extractionStatus=complete). "
        "Live/runtime audit of extracted external targets remains open."
    )
    consumer_line = (
        "Tools package consumer acceptance journey matrix recorded at "
        f"{rel(WAVE / 'consumer/journey-matrix.json')} "
        f"({consumer['journeyCount']} journeys; local smokes recorded; "
        "paired Cursor+Pi acceptance journeys remain open)."
    )

    return {
        "schemaVersion": 1,
        "unit": UNIT,
        "status": "proposal",
        "createdAt": NOW,
        "targets": {
            "dependenciesJson": "parity/dependencies.json",
            "sourceLockJson": "parity/source-lock.json",
        },
        "closureAudited": True,
        "closureAuditedNote": (
            "Leave closureAudited true. Prior independent audit remains the audit "
            "evidence. This wave does not re-audit."
        ),
        "completeDependencyClosure": False,
        "completeDependencyClosureNote": (
            "Do not claim completeDependencyClosure. Bun version pin, host "
            "computer-use/enterprise edges, journey edges, typescript deep "
            "compiler-behavior semantics, create-skill journeys, and live/runtime "
            "follow-ups on inventoried integrations and extracted recursive refs "
            "remain open."
        ),
        "resolvedReferenceCount": 3,
        "unresolvedTargetCount": 7,
        "resolvedReferenceNote": (
            "Closed vague keep-open buckets for recursive extraction, live-integration "
            "inventory, and consumer journey matrix by publishing path+hash evidence "
            "artifacts. Replaced each with a narrower still-open runtime/journey line."
        ),
        "dependencies": {
            "nodeMutations": [
                {
                    "id": "source-bun-runtime",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "read-inventory.json"),
                            rel(WAVE / "bun/official-capture.json"),
                            rel(WAVE / "nodes/bun-pin.md"),
                        ]
                    },
                    "evidence": [rel(WAVE / "bun/official-capture.json")],
                    "disposition": bun["note"],
                },
                {
                    "id": "npm:typescript@7.0.2",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "npm/typescript-deep-semantics-disposition.json"),
                            "parity/research/dep-closure-wave-006/npm/typescript-deep-semantics-disposition.json",
                            "parity/research/dep-closure-wave-005/npm/typescript-body-audit.json",
                            "parity/research/dep-closure-wave-002/npm/typescript@7.0.2/file-inventory.json",
                        ]
                    },
                    "evidence": [
                        rel(WAVE / "npm/typescript-deep-semantics-disposition.json"),
                        rel(WAVE / "nodes/typescript-deep-semantics.md"),
                    ],
                    "disposition": ts["disposition"],
                },
                {
                    "id": "cursor-self-hosted-computer-use",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "host-edge-disposition.json"),
                            rel(WAVE / "nodes/host-edge-disposition.md"),
                        ]
                    },
                    "evidence": [rel(WAVE / "host-edge-disposition.json")],
                    "disposition": (
                        "Environment-bound. Public-doc contracts re-hashed; runtime "
                        "helper/desktop services not exercised."
                    ),
                },
                {
                    "id": "cursor-enterprise-integration-policy",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "host-edge-disposition.json"),
                            rel(WAVE / "nodes/host-edge-disposition.md"),
                        ]
                    },
                    "evidence": [rel(WAVE / "host-edge-disposition.json")],
                    "disposition": (
                        "Environment-bound. Public-doc contracts re-hashed; live "
                        "team/org policy enforcement not observed."
                    ),
                },
                {
                    "id": "cursor-create-skill",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "create-skill/journey-matrix.json"),
                            rel(WAVE / "nodes/create-skill-journey-matrix.md"),
                            "parity/research/dep-closure-wave-006/create-skill/subordinate-audit.json",
                            rel(CREATE_SKILL),
                        ]
                    },
                    "evidence": [rel(WAVE / "create-skill/journey-matrix.json")],
                    "disposition": create_skill["disposition"],
                },
                {
                    "id": "cursor-cli-host",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "live/integrations-inventory.json"),
                            rel(WAVE / "nodes/live-integrations.md"),
                        ]
                    },
                    "evidence": [rel(WAVE / "live/integrations-inventory.json")],
                    "disposition": live["disposition"],
                },
                {
                    "id": "cursor-pstack",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "recursive/extraction.json"),
                            rel(WAVE / "nodes/recursive-extraction.md"),
                        ]
                    },
                    "evidence": [rel(WAVE / "recursive/extraction.json")],
                    "disposition": recursive["disposition"],
                },
                {
                    "id": "source-tools-manifest",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "consumer/journey-matrix.json"),
                            rel(WAVE / "nodes/consumer-journey-matrix.md"),
                            rel(CONSUMER_BINDING),
                        ]
                    },
                    "evidence": [rel(WAVE / "consumer/journey-matrix.json")],
                    "disposition": consumer["disposition"],
                },
            ],
            "edgeMutations": [],
            "honestUnresolvedEdges": host["edges"]
            + [
                {
                    "from": e["from"],
                    "to": e["to"],
                    "keepStatus": e["keepStatus"],
                    "blocker": e["blocker"],
                }
                for e in host["journeyEdgesUnchanged"]
            ],
            "unresolvedReferences": {
                "removeIfPresent": [
                    "Official Bun runtime version pin under source-bun-runtime remains unresolved after wave-006 capture at parity/research/dep-closure-wave-006/bun/official-capture.json (local 1.4.2 only; no engines/packageManager/volta/.bun-version/bunfig/mise/.tool-versions under tools; host mise bun/latest and bun-types lock resolve are not runtime pins).",
                    "npm:typescript@7.0.2 deep compiler-behavior semantics remain open after wave-006 disposition at parity/research/dep-closure-wave-006/npm/typescript-deep-semantics-disposition.json (136 internal dist files cataloged with path+hash; structural body audit from wave-005 stands; no compiler-test oracle).",
                    "cursor-cli-host edges to computer-use and enterprise policy remain unresolved after wave-006 environment-bound disposition at parity/research/dep-closure-wave-006/host-edge-disposition.json; runtime services were not exercised.",
                    "cursor-create-skill journey audit remains open after subordinate workflow inventory at parity/research/dep-closure-wave-006/create-skill/subordinate-audit.json (SKILL.md sha256 255a3d3be7bac8984a13279f754f091a1de6f72c82bdf73e6b3c868e77e7ee82; 12 workflow/phase sections; paired journeys not run).",
                    "Required live integrations, cloud services, automation editor, models and supporting tools.",
                    "Recursive references in inspected sources still require complete extraction and audit.",
                    "Tools package consumer binding recorded at parity/research/dep-closure-wave-003/consumer-binding.json (commander runtime; bun-types/typescript test/typecheck). Broader acceptance journeys remain open.",
                ],
                "add": [
                    bun_line,
                    ts_line,
                    host_line,
                    create_skill_line,
                    live_line,
                    recursive_line,
                    consumer_line,
                ],
                "keep": [],
                "note": (
                    "Replace wave-006 Bun/typescript/host/create-skill lines with "
                    "wave-007 evidence. Resolve vague live/recursive/consumer keep-open "
                    "strings into inventoried/extracted matrix artifacts plus narrower "
                    "runtime/journey blockers."
                ),
            },
        },
        "sourceLock": {
            "cursorPlugins.completeDependencyClosure": {
                "set": False,
                "note": (
                    "Must remain false until Bun pin, host edges, journeys, deep "
                    "typescript semantics, and live/runtime follow-ups close with evidence."
                ),
            }
        },
        "fullProposal": rel(WAVE / "merge-proposal.json"),
    }


def build_nodes(
    bun: dict,
    ts: dict,
    host: dict,
    create_skill: dict,
    recursive: dict,
    live: dict,
    consumer: dict,
) -> None:
    write_text(
        WAVE / "nodes/bun-pin.md",
        "\n".join(
            [
                "# source-bun-runtime Bun pin (wave-007)",
                "",
                f"pinStatus: `{bun['pinStatus']}`",
                f"localBunStdout: `{bun['localBunStdout']}`",
                f"capture: `{rel(WAVE / 'bun/official-capture.json')}` sha256=`{sha256(WAVE / 'bun/official-capture.json')}`",
                "",
                bun["note"],
                "",
                "Closure criteria:",
                *[f"- {c}" for c in bun["closureCriteria"]],
                "",
            ]
        ),
    )
    write_text(
        WAVE / "nodes/typescript-deep-semantics.md",
        "\n".join(
            [
                "# npm:typescript@7.0.2 deep compiler semantics (wave-007)",
                "",
                f"status: `{ts['deepCompilerSemanticsStatus']}`",
                f"deepInternalFileCount: `{ts['deepInternalFileCount']}`",
                f"catalogHashDriftCount: `{ts['catalogHashDriftCount']}`",
                f"consumerTypecheckExit: `{(ts.get('consumerTypecheckProbe') or {}).get('exitCode')}`",
                f"disposition: `{rel(WAVE / 'npm/typescript-deep-semantics-disposition.json')}` sha256=`{sha256(WAVE / 'npm/typescript-deep-semantics-disposition.json')}`",
                "",
                ts["disposition"],
                "",
                f"Blocker: {ts['blocker']}",
                "",
            ]
        ),
    )
    write_text(
        WAVE / "nodes/host-edge-disposition.md",
        "\n".join(
            [
                "# Host computer-use / enterprise edges (wave-007)",
                "",
                f"dispositionClass: `{host['dispositionClass']}`",
                f"capture: `{rel(WAVE / 'host-edge-disposition.json')}` sha256=`{sha256(WAVE / 'host-edge-disposition.json')}`",
                "",
                host["note"],
                "",
                "## Edges",
                "",
                *[
                    f"- `{e['from']}` → `{e['to']}` status=`{e['keepStatus']}` docSha256=`{e['docSha256']}`\n  Blocker: {e['blocker']}"
                    for e in host["edges"]
                ],
                "",
            ]
        ),
    )
    write_text(
        WAVE / "nodes/create-skill-journey-matrix.md",
        "\n".join(
            [
                "# cursor-create-skill journey matrix (wave-007)",
                "",
                f"skillSha256: `{create_skill['skillSha256']}`",
                f"captureMatchesLiveInstall: `{create_skill['captureMatchesLiveInstall']}`",
                f"journeyMatrixStatus: `{create_skill['journeyMatrixStatus']}`",
                f"journeyAuditStatus: `{create_skill['journeyAuditStatus']}`",
                f"matrix: `{rel(WAVE / 'create-skill/journey-matrix.json')}` sha256=`{sha256(WAVE / 'create-skill/journey-matrix.json')}`",
                "",
                create_skill["disposition"],
                "",
                f"Journey blocker: {create_skill['blockerForJourneyClosure']}",
                "",
                "Required journeys:",
                *[f"- {j['id']}: {j['title']} ({j['status']})" for j in create_skill["journeyMatrix"]],
                "",
            ]
        ),
    )
    write_text(
        WAVE / "nodes/recursive-extraction.md",
        "\n".join(
            [
                "# Recursive reference extraction (wave-007)",
                "",
                f"extractionStatus: `{recursive['extractionStatus']}`",
                f"runtimeAuditStatus: `{recursive['runtimeAuditStatus']}`",
                f"textFilesScanned: `{recursive['textFilesScanned']}`",
                f"uniqueReferenceCount: `{recursive['uniqueReferenceCount']}`",
                f"capture: `{rel(WAVE / 'recursive/extraction.json')}` sha256=`{sha256(WAVE / 'recursive/extraction.json')}`",
                "",
                recursive["disposition"],
                "",
                f"Blocker: {recursive['blockerForRuntimeAudit']}",
                "",
            ]
        ),
    )
    write_text(
        WAVE / "nodes/live-integrations.md",
        "\n".join(
            [
                "# Live integrations inventory (wave-007)",
                "",
                f"inventoryStatus: `{live['inventoryStatus']}`",
                f"liveExerciseStatus: `{live['liveExerciseStatus']}`",
                f"itemCount: `{live['itemCount']}`",
                f"cliSnapshotHitCount: `{live['cliSnapshotHitCount']}`",
                f"capture: `{rel(WAVE / 'live/integrations-inventory.json')}` sha256=`{sha256(WAVE / 'live/integrations-inventory.json')}`",
                "",
                live["disposition"],
                "",
                f"Blocker: {live['blockerForLiveExercise']}",
                "",
            ]
        ),
    )
    write_text(
        WAVE / "nodes/consumer-journey-matrix.md",
        "\n".join(
            [
                "# Tools consumer journey matrix (wave-007)",
                "",
                f"matrixStatus: `{consumer['matrixStatus']}`",
                f"pairedAcceptanceStatus: `{consumer['pairedAcceptanceStatus']}`",
                f"journeyCount: `{consumer['journeyCount']}`",
                f"capture: `{rel(WAVE / 'consumer/journey-matrix.json')}` sha256=`{sha256(WAVE / 'consumer/journey-matrix.json')}`",
                "",
                consumer["disposition"],
                "",
                f"Blocker: {consumer['blockerForPairedAcceptance']}",
                "",
            ]
        ),
    )


def build_inventory(paths: list[Path]) -> dict:
    sources = []
    for i, path in enumerate(paths):
        if not path.exists():
            continue
        sources.append(
            {
                "id": f"w7-{i:03d}-{path.name}",
                "path": rel(path),
                "absolutePath": str(path.resolve()),
                "sha256": sha256(path),
                "byteLength": path.stat().st_size,
            }
        )
    return {
        "unit": UNIT,
        "capturedAt": NOW,
        "allSources": sources,
        "sourceCount": len(sources),
    }


def write_verify_script() -> None:
    write_text(
        WAVE / "verify_inventory_shasum.py",
        '''#!/usr/bin/env python3
"""Rerun inventory hash check with shasum -a 256. Exit 1 on mismatch."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
inv = json.loads((Path(__file__).parent / "read-inventory.json").read_text())
bad = 0
for src in inv["allSources"]:
    path = Path(src["absolutePath"])
    if not path.exists():
        path = ROOT / src["path"]
    out = subprocess.check_output(["shasum", "-a", "256", str(path)], text=True).split()[0]
    if out != src["sha256"]:
        print(f"MISMATCH {src['id']} {path}")
        bad += 1
    else:
        try:
            shown = path.relative_to(ROOT)
        except ValueError:
            shown = path
        print(f"OK {src['id']} {shown}")
print("VERIFIED" if bad == 0 else f"NOT VERIFIED ({bad})")
sys.exit(0 if bad == 0 else 1)
''',
    )


def main() -> None:
    for sub in ("bun", "npm", "nodes", "create-skill", "recursive", "live", "consumer"):
        (WAVE / sub).mkdir(parents=True, exist_ok=True)

    bun = build_bun_capture()
    write_json(WAVE / "bun/official-capture.json", bun)

    ts = build_typescript_deep_disposition()
    write_json(WAVE / "npm/typescript-deep-semantics-disposition.json", ts)

    host = build_host_disposition()
    write_json(WAVE / "host-edge-disposition.json", host)

    create_skill = build_create_skill_journey_matrix()
    write_json(WAVE / "create-skill/journey-matrix.json", create_skill)

    recursive = build_recursive_extraction()
    # Write a slim summary beside the full extraction for inventory hashing of the summary.
    write_json(WAVE / "recursive/extraction.json", recursive)
    summary = {
        k: recursive[k]
        for k in recursive
        if k not in {"sourcesScanned", "references"}
    }
    summary["sourcesScannedCount"] = len(recursive["sourcesScanned"])
    summary["referencesSample"] = recursive["references"][:25]
    write_json(WAVE / "recursive/extraction-summary.json", summary)

    live = build_live_integrations_inventory()
    write_json(WAVE / "live/integrations-inventory.json", live)

    consumer = build_consumer_journey_matrix()
    write_json(WAVE / "consumer/journey-matrix.json", consumer)

    # Node markdown needs json artifacts already written for sha256().
    build_nodes(bun, ts, host, create_skill, recursive, live, consumer)

    proposal = build_merge_proposal(
        bun, ts, host, create_skill, recursive, live, consumer
    )
    write_json(WAVE / "merge-proposal.json", proposal)

    decisions = [
        "timestamp\tdecision\tevidence\tnote",
        f"{NOW}\tbun_pin_unresolved\t{rel(WAVE / 'bun/official-capture.json')}\tno pin files; host mise latest not a pin",
        f"{NOW}\ttypescript_deep_still_open\t{rel(WAVE / 'npm/typescript-deep-semantics-disposition.json')}\tcatalog re-verified; consumer typecheck recorded; no compiler oracle",
        f"{NOW}\thost_edges_environment_bound\t{rel(WAVE / 'host-edge-disposition.json')}\tdocs re-hashed; runtime not exercised",
        f"{NOW}\tcreate_skill_journey_matrix\t{rel(WAVE / 'create-skill/journey-matrix.json')}\tmatrix complete; paired journeys open",
        f"{NOW}\trecursive_extraction_complete\t{rel(WAVE / 'recursive/extraction.json')}\textraction complete; runtime audit open",
        f"{NOW}\tlive_integrations_inventoried\t{rel(WAVE / 'live/integrations-inventory.json')}\tinventory complete; live exercise open",
        f"{NOW}\tconsumer_journey_matrix\t{rel(WAVE / 'consumer/journey-matrix.json')}\tmatrix+local smokes; paired acceptance open",
        f"{NOW}\tcompleteDependencyClosure_false\t{rel(WAVE / 'merge-proposal.json')}\tno fabricated closure",
    ]
    write_text(WAVE / "decisions.tsv", "\n".join(decisions) + "\n")

    inventory_paths = [
        WAVE / "bun/official-capture.json",
        WAVE / "bun/bun-version.txt",
        WAVE / "npm/typescript-deep-semantics-disposition.json",
        WAVE / "host-edge-disposition.json",
        WAVE / "create-skill/journey-matrix.json",
        WAVE / "recursive/extraction-summary.json",
        WAVE / "recursive/extraction.json",
        WAVE / "live/integrations-inventory.json",
        WAVE / "consumer/journey-matrix.json",
        WAVE / "merge-proposal.json",
        WAVE / "nodes/bun-pin.md",
        WAVE / "nodes/typescript-deep-semantics.md",
        WAVE / "nodes/host-edge-disposition.md",
        WAVE / "nodes/create-skill-journey-matrix.md",
        WAVE / "nodes/recursive-extraction.md",
        WAVE / "nodes/live-integrations.md",
        WAVE / "nodes/consumer-journey-matrix.md",
        WAVE / "decisions.tsv",
        CREATE_SKILL,
        COMPUTER_USE,
        MODEL_MGMT,
        TS_BODY_AUDIT,
        CONSUMER_BINDING,
        DIST_INV,
        PKG_JSON,
        LOCK,
    ]
    for _label, _url, fname in BUN_DOCS:
        inventory_paths.append(WAVE / "bun" / fname)
        inventory_paths.append(WAVE / "bun" / f"{Path(fname).stem}.headers.txt")
    inventory_paths.append(WAVE / "bun/bun-version-docs.headers.txt")
    if (WAVE / "bun/bun-version-docs.html").exists():
        inventory_paths.append(WAVE / "bun/bun-version-docs.html")

    inv = build_inventory(inventory_paths)
    write_json(WAVE / "read-inventory.json", inv)
    write_verify_script()

    verify = subprocess.run(
        ["python3", str(WAVE / "verify_inventory_shasum.py")],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    write_json(
        WAVE / "verify-hashes.json",
        {
            "capturedAt": NOW,
            "status": "VERIFIED" if verify.returncode == 0 else "NOT_VERIFIED",
            "exitCode": verify.returncode,
            "stdout": verify.stdout,
            "stderr": verify.stderr,
        },
    )
    print(verify.stdout)
    if verify.returncode != 0:
        raise SystemExit(verify.returncode)
    print(f"Wrote {UNIT} artifacts under {rel(WAVE)}")
    print(
        json.dumps(
            {
                "bunPin": bun["pinStatus"],
                "tsDeep": ts["deepCompilerSemanticsStatus"],
                "tsTypecheckExit": (ts.get("consumerTypecheckProbe") or {}).get(
                    "exitCode"
                ),
                "recursiveRefs": recursive["uniqueReferenceCount"],
                "liveItems": live["itemCount"],
                "consumerJourneys": consumer["journeyCount"],
                "resolvedRefs": 3,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
