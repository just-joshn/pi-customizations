#!/usr/bin/env python3
"""Terminal Bun pin probe for u-dep-bun-pin-terminal-001. Does not edit ledgers."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
UNIT = "u-dep-bun-pin-terminal-001"
# Fixed stamp so VERIFY reruns keep a stable capture hash.
NOW = "2026-10-09T02:05:00Z"

# Official locked tools custody (same roots as wave-009).
SCRIPTS = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts"
PKG_JSON = SCRIPTS / "package.json"
POTETO = ROOT / "parity/reference/cursor-plugins/pstack/skills/poteto-mode"
# Live extension mirror (not inventing a pin; reported for exhaustiveness).
EXT_POTETO = ROOT / "extensions/pi-pstack/skills/poteto-mode"
EXT_SCRIPTS = EXT_POTETO / "scripts"
EXT_PKG = EXT_SCRIPTS / "package.json"

PIN_NAMES = [
    ".bun-version",
    "bunfig.toml",
    "mise.toml",
    ".tool-versions",
    ".nvmrc",
    ".node-version",
    ".asdf-versions",
    "asdf.toml",
]

BUN_DOCS = [
    ("install", "https://bun.com/docs/installation", "install.html"),
    ("lockfile", "https://bun.com/docs/pm/lockfile", "lockfile.html"),
    ("bunfig", "https://bun.com/docs/runtime/bunfig", "bunfig.html"),
]
LEGACY_BUN_VERSION_GUIDE = "https://bun.com/docs/guides/install/bun-version"

WAVE009_REF = (
    "Official Bun runtime version pin under source-bun-runtime remains unresolved "
    "after wave-009 capture at parity/research/dep-closure-wave-009/bun/official-capture.json "
    "(local 1.4.2 only; no engines/packageManager/volta/.bun-version/bunfig/mise/.tool-versions "
    "under tools; host mise bun/latest and bun-types lock resolve are not runtime pins)."
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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


def run(cmd: list[str]) -> dict:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    return {
        "cmd": cmd,
        "exitCode": proc.returncode,
        "stdout": (proc.stdout or "").rstrip("\n"),
        "stderr": (proc.stderr or "").rstrip("\n"),
    }


def fetch_url(url: str, body: Path, headers_path: Path) -> dict:
    req = Request(url, headers={"User-Agent": "pi-pstack-parity-bun-pin-terminal/1.0"})
    try:
        with urlopen(req, timeout=60) as resp:
            data = resp.read()
            status = getattr(resp, "status", 200)
            final = resp.geturl()
            hdr_lines = [f"HTTP {status}", f"final-url: {final}"]
            for k, v in resp.headers.items():
                hdr_lines.append(f"{k}: {v}")
            write_text(headers_path, "\n".join(hdr_lines) + "\n")
            body.write_bytes(data)
            return {
                "url": url,
                "finalUrl": final,
                "path": rel(body),
                "sha256": sha256(body),
                "byteLength": len(data),
                "headersPath": rel(headers_path),
                "status": "fetched",
                "httpStatus": status,
                "reason": None,
            }
    except HTTPError as e:
        data = e.read() if e.fp else b""
        body.write_bytes(data)
        write_text(
            headers_path,
            f"HTTP {e.code}\nfinal-url: {url}\nreason: {e.reason}\n",
        )
        return {
            "url": url,
            "finalUrl": url,
            "path": rel(body),
            "sha256": sha256(body) if body.exists() else None,
            "byteLength": len(data),
            "headersPath": rel(headers_path),
            "status": "http_error",
            "httpStatus": e.code,
            "reason": str(e.reason),
        }
    except URLError as e:
        write_text(headers_path, f"URLError\nurl: {url}\nreason: {e.reason}\n")
        return {
            "url": url,
            "finalUrl": url,
            "path": rel(body),
            "sha256": None,
            "byteLength": 0,
            "headersPath": rel(headers_path),
            "status": "url_error",
            "httpStatus": None,
            "reason": str(e.reason),
        }


def pkg_fields(pkg_path: Path) -> dict:
    if not pkg_path.exists():
        return {"exists": False, "path": rel(pkg_path)}
    pkg = json.loads(pkg_path.read_text())
    return {
        "exists": True,
        "path": rel(pkg_path),
        "sha256": sha256(pkg_path),
        "engines": pkg.get("engines"),
        "packageManager": pkg.get("packageManager"),
        "volta": pkg.get("volta"),
        "devEngines": pkg.get("devEngines"),
        "devDependencies": {
            "bun-types": (pkg.get("devDependencies") or {}).get("bun-types"),
            "typescript": (pkg.get("devDependencies") or {}).get("typescript"),
        },
    }


def probe_pin_files(bases: list[Path]) -> list[dict]:
    rows = []
    for base in bases:
        for name in PIN_NAMES:
            candidate = base / name
            rows.append(
                {
                    "candidate": name,
                    "base": rel(base),
                    "path": rel(candidate),
                    "exists": candidate.exists(),
                    "sha256": sha256(candidate) if candidate.exists() else None,
                }
            )
    return rows


def find_shebang_bun(roots: list[Path]) -> list[dict]:
    hits = []
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if "node_modules" in path.parts:
                continue
            try:
                with path.open("rb") as f:
                    first = f.readline()
            except OSError:
                continue
            if first.startswith(b"#!") and b"bun" in first.lower():
                hits.append(
                    {
                        "path": rel(path),
                        "firstLine": first.decode("utf-8", errors="replace").rstrip(
                            "\n"
                        ),
                        "sha256": sha256(path),
                    }
                )
    return hits


def lock_mentions_bun_binary(scripts: Path) -> dict:
    candidates = [
        scripts / "bun.lock",
        scripts / "bun.lockb",
        scripts / "package-lock.json",
        scripts / "yarn.lock",
        scripts / "pnpm-lock.yaml",
    ]
    out = []
    for path in candidates:
        if not path.exists():
            out.append({"path": rel(path), "exists": False})
            continue
        text = path.read_text(errors="replace") if path.suffix != ".lockb" else ""
        # Presence of bun-types in a lock is not a binary pin.
        out.append(
            {
                "path": rel(path),
                "exists": True,
                "sha256": sha256(path),
                "byteLength": path.stat().st_size,
                "containsBunTypes": "bun-types" in text if text else None,
                "containsEnginesBun": '"bun"' in text and "engines" in text
                if text
                else None,
                "note": "Lockfile presence does not declare a Bun binary version pin.",
            }
        )
    return {"lockCandidates": out}


def main() -> None:
    bun_dir = OUT / "bun"
    bun_dir.mkdir(parents=True, exist_ok=True)

    version = run(["bun", "--version"])
    which = run(["which", "bun"])
    write_text(bun_dir / "bun-version.txt", version["stdout"] + "\n")

    docs = []
    for label, url, name in BUN_DOCS:
        docs.append(
            {
                "label": label,
                **fetch_url(url, bun_dir / name, bun_dir / f"{name}.headers.txt"),
            }
        )
    docs.append(
        {
            "label": "bun-version-docs-legacy",
            "note": "Legacy guide URL still expected 404.",
            **fetch_url(
                LEGACY_BUN_VERSION_GUIDE,
                bun_dir / "bun-version-docs.html",
                bun_dir / "bun-version-docs.headers.txt",
            ),
        }
    )

    ref_pkg = pkg_fields(PKG_JSON)
    ext_pkg = pkg_fields(EXT_PKG)
    pin_probe = probe_pin_files([SCRIPTS, POTETO, EXT_SCRIPTS, EXT_POTETO])
    pin_hits = [r for r in pin_probe if r["exists"]]
    shebangs = find_shebang_bun([POTETO, EXT_POTETO])
    locks = lock_mentions_bun_binary(SCRIPTS)

    host_is_mise_latest = "/mise/installs/bun/latest/" in which["stdout"]

    # Exhaustive candidate inventory with hashes for absent paths (null) and present files.
    candidate_list = []
    for field in ("engines", "packageManager", "volta", "devEngines"):
        candidate_list.append(
            {
                "kind": f"package.json.{field}",
                "custody": "reference-tools",
                "path": ref_pkg["path"],
                "value": ref_pkg.get(field),
                "present": ref_pkg.get(field) is not None,
                "packageJsonSha256": ref_pkg.get("sha256"),
            }
        )
    for row in pin_probe:
        candidate_list.append(
            {
                "kind": "pin-file",
                "name": row["candidate"],
                "path": row["path"],
                "exists": row["exists"],
                "sha256": row["sha256"],
            }
        )

    any_official_pin = any(
        c.get("present") is True for c in candidate_list if c["kind"].startswith("package.json.")
    ) or any(c.get("exists") is True for c in candidate_list if c["kind"] == "pin-file")

    if any_official_pin:
        pin_status = "pin-found"
        verdict = "pin-found"
        disposition = (
            "Official Bun binary pin found under tools/poteto custody. "
            "See pinCandidatesChecked for path+hash."
        )
    else:
        pin_status = "absent-in-source"
        verdict = "absent-in-source"
        disposition = (
            "Exhaustive re-probe of locked poteto-mode tools custody and the extensions "
            "mirror found no official Bun binary pin "
            "(no engines/packageManager/volta/devEngines, no "
            ".bun-version/bunfig.toml/mise.toml/.tool-versions/.nvmrc/.node-version). "
            f"Host bun {version['stdout']} via mise latest and bun-types:latest are not "
            "runtime pins and must not be invented into engines/packageManager/.bun-version."
        )

    capture = {
        "capturedAt": NOW,
        "unit": UNIT,
        "verdict": verdict,
        "pinStatus": pin_status,
        "localBunVersionCapture": rel(bun_dir / "bun-version.txt"),
        "localBunVersionSha256": sha256(bun_dir / "bun-version.txt"),
        "localBunStdout": version["stdout"],
        "whichBun": which["stdout"],
        "hostWhichBunIsMiseLatest": host_is_mise_latest,
        "docs": docs,
        "packageJson": {"reference": ref_pkg, "extensionsMirror": ext_pkg},
        "pinCandidatesChecked": {
            "package.json.engines": ref_pkg.get("engines"),
            "package.json.packageManager": ref_pkg.get("packageManager"),
            "package.json.volta": ref_pkg.get("volta"),
            "package.json.devEngines": ref_pkg.get("devEngines"),
            "pinFilesFound": pin_hits,
            "pinFileProbe": pin_probe,
            "shebangEnvBunFiles": shebangs,
            "locks": locks,
        },
        "exhaustiveCandidateList": candidate_list,
        "nonPinsExplicit": {
            "hostBunVersion": version["stdout"],
            "hostBunPath": which["stdout"],
            "hostMiseLatest": host_is_mise_latest,
            "bunTypesDevDependency": (ref_pkg.get("devDependencies") or {}).get(
                "bun-types"
            ),
            "statement": (
                "Host bun 1.4.2 / mise latest / bun-types are not pins. "
                "They must not be written into engines, packageManager, or .bun-version."
            ),
        },
        "disposition": disposition,
        "closureCriteria": [
            "Exact Bun binary version declared in tools subtree via engines.bun, packageManager, volta, .bun-version, bunfig, or equivalent lock binding",
            "Declaration must be in source custody under poteto-mode/scripts or a documented official pin path for this package",
        ],
        "terminalNote": (
            "When no declaration exists in source, the honest terminal status is "
            "absent-in-source, not an invented version string."
        ),
    }
    write_json(bun_dir / "official-capture.json", capture)

    write_text(
        OUT / "nodes/bun-pin.md",
        "\n".join(
            [
                "# source-bun-runtime pin (terminal)",
                "",
                f"pinStatus: `{pin_status}`",
                f"verdict: `{verdict}`",
                f"localBunStdout: `{version['stdout']}`",
                f"whichBun: `{which['stdout']}`",
                "",
                disposition,
                "",
                "Host bun / mise latest / bun-types are not pins.",
                "",
                f"Evidence: `{rel(bun_dir / 'official-capture.json')}`",
                "",
            ]
        ),
    )

    capture_sha = sha256(bun_dir / "official-capture.json")
    closed_line = (
        f"Official Bun runtime version pin under source-bun-runtime closed as "
        f"absent-in-source by {UNIT} at {rel(bun_dir / 'official-capture.json')} "
        f"(sha256 {capture_sha}; no engines/packageManager/volta/devEngines/"
        f".bun-version/bunfig/mise/.tool-versions under poteto-mode tools; host "
        f"bun {version['stdout']} / mise latest / bun-types are not pins)."
    )

    merge = {
        "schemaVersion": 1,
        "unit": UNIT,
        "status": "proposal",
        "createdAt": NOW,
        "verdict": verdict,
        "mergePayloadReady": verdict == "absent-in-source",
        "targets": {
            "dependenciesJson": "parity/dependencies.json",
            "sourceLockJson": "parity/source-lock.json",
        },
        "completeDependencyClosure": False,
        "completeDependencyClosureNote": (
            "Must remain false. Closing Bun pin as absent-in-source does not close "
            "host edges, persistent-mode, typescript deep semantics, or journey/live refs."
        ),
        "resolvedReferenceCount": 1 if verdict == "absent-in-source" else 0,
        "resolvedEdgeCount": 0,
        "dependencies": {
            "nodeMutations": [
                {
                    "id": "source-bun-runtime",
                    "set": {
                        "readingEvidence": [
                            rel(bun_dir / "official-capture.json"),
                            rel(OUT / "nodes/bun-pin.md"),
                        ],
                        "pinStatus": pin_status,
                    },
                    "evidence": [rel(bun_dir / "official-capture.json")],
                    "disposition": disposition,
                }
            ],
            "unresolvedReferences": {
                "removeIfPresent": [WAVE009_REF],
                "add": [],
                "keep": [],
                "closedAs": {
                    "prior": WAVE009_REF,
                    "status": pin_status,
                    "replacementNote": closed_line,
                },
                "note": (
                    "Remove the wave-009 Bun pin unresolvedReference. Do not invent a "
                    "version pin. Do not add a replacement unresolved Bun pin line."
                ),
            },
        },
        "sourceLock": {
            "cursorPlugins.completeDependencyClosure": {
                "set": False,
                "note": (
                    "Remains false after Bun absent-in-source close; other blockers remain."
                ),
            }
        },
        "fullProposal": rel(OUT / "merge-payload.json"),
    }
    write_json(OUT / "merge-payload.json", merge)

    verify = {
        "unit": UNIT,
        "verifiedAt": NOW,
        "captureSha256": capture_sha,
        "bunVersionTxtSha256": sha256(bun_dir / "bun-version.txt"),
        "docs": [
            {"label": d["label"], "sha256": d.get("sha256"), "status": d.get("status")}
            for d in docs
        ],
        "pinHitsCount": len(pin_hits),
        "verdict": verdict,
        "mergePayloadReady": merge["mergePayloadReady"],
        "nonPinsStatement": capture["nonPinsExplicit"]["statement"],
    }
    write_json(OUT / "verify-hashes.json", verify)
    print(json.dumps({"verdict": verdict, "captureSha256": capture_sha}, indent=2))


if __name__ == "__main__":
    main()
