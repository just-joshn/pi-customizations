#!/usr/bin/env python3
"""Audit wave-007 recursive extraction refs: classify, fetch safe URLs, hash bodies."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parents[3]
WAVE = Path(__file__).resolve().parent
EXTRACTION = (
    REPO
    / "parity/research/dep-closure-wave-007/recursive/extraction.json"
)
USER_AGENT = "pi-pstack-parity-recursive-runtime-audit/1"

EXAMPLE_HOST_SUFFIXES = (".example",)
LOCAL_HOST_MARKERS = (
    "127.0.0.1",
    "localhost",
    "0.0.0.0",
    "[::1]",
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text if text.endswith("\n") else text + "\n")


def write_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=False) + "\n")


def rel(path: Path) -> str:
    return str(path.relative_to(REPO))


def strip_trailing_artifacts(target: str) -> str:
    cleaned = target.rstrip("`").rstrip()
    return cleaned


def looks_like_template(target: str) -> bool:
    cleaned = strip_trailing_artifacts(target)
    return any(m in cleaned for m in ("${", "{", "}", "<", ">"))


def is_localhost(target: str) -> bool:
    parsed = urlparse(strip_trailing_artifacts(target))
    host = (parsed.hostname or "").lower()
    if host in {"127.0.0.1", "localhost", "0.0.0.0", "::1"}:
        return True
    netloc = (parsed.netloc or "").lower()
    return any(m in netloc for m in LOCAL_HOST_MARKERS)


def is_example_host(target: str) -> bool:
    parsed = urlparse(strip_trailing_artifacts(target))
    host = (parsed.hostname or "").lower()
    return any(host.endswith(suf) for suf in EXAMPLE_HOST_SUFFIXES)


def is_automation_or_webhook(target: str) -> bool:
    lower = strip_trailing_artifacts(target).lower()
    return "automations/webhook" in lower or "api2.cursor.sh/automations" in lower


def is_documentation_placeholder(target: str) -> bool:
    cleaned = strip_trailing_artifacts(target)
    parsed = urlparse(cleaned)
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    if host != "github.com":
        return False
    # Explicit docs placeholders seen in extraction, not real project targets.
    if path.startswith("/example-org/") or path == "/example-org":
        return True
    if path.startswith("/owner/repo"):
        return True
    return False
def slug_for_url(url: str) -> str:
    digest = sha256_bytes(url.encode("utf-8"))[:16]
    parsed = urlparse(url)
    host = re.sub(r"[^a-zA-Z0-9._-]+", "_", parsed.netloc or "unknown")[:40]
    return f"{host}_{digest}"


def fetch_url(url: str, body_path: Path, headers_path: Path) -> dict:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(req, timeout=60) as resp:
            body = resp.read()
            header_lines = [f"HTTP {resp.status}"]
            for k, v in resp.headers.items():
                header_lines.append(f"{k}: {v}")
            final_url = resp.geturl()
            status_code = resp.status
    except HTTPError as exc:
        err_body = exc.read() if exc.fp else b""
        body_path.parent.mkdir(parents=True, exist_ok=True)
        write_text(headers_path, f"HTTP {exc.code}\n{exc.reason}\n")
        if err_body:
            body_path.write_bytes(err_body)
        return {
            "fetchUrl": url,
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
            "fetchUrl": url,
            "path": None,
            "sha256": None,
            "byteLength": 0,
            "headersPath": rel(headers_path),
            "status": "url_error",
            "reason": str(exc.reason),
        }
    except Exception as exc:  # noqa: BLE001 — record unexpected transport failures
        write_text(headers_path, f"Exception {type(exc).__name__}: {exc}\n")
        return {
            "fetchUrl": url,
            "path": None,
            "sha256": None,
            "byteLength": 0,
            "headersPath": rel(headers_path),
            "status": "exception",
            "reason": f"{type(exc).__name__}: {exc}",
        }

    body_path.parent.mkdir(parents=True, exist_ok=True)
    body_path.write_bytes(body)
    write_text(headers_path, "\n".join(header_lines) + "\n")
    return {
        "fetchUrl": url,
        "finalUrl": final_url,
        "path": rel(body_path),
        "sha256": sha256_bytes(body),
        "byteLength": len(body),
        "headersPath": rel(headers_path),
        "status": "fetched",
        "httpStatus": status_code,
    }


def classify_ref(ref: dict) -> dict:
    kind = ref["kind"]
    target = ref["target"]
    base = {
        "kind": kind,
        "target": target,
        "host": ref.get("host"),
        "fromInventoryPath": ref.get("fromInventoryPath"),
        "fromSha256": ref.get("fromSha256"),
    }

    if kind == "relative_escape":
        return {
            **base,
            "disposition": "classified-non-fetchable",
            "classReason": "relative_escape_in_distribution",
            "fetchAttempted": False,
        }

    if kind != "absolute_url":
        return {
            **base,
            "disposition": "blocked",
            "classReason": f"unknown_kind:{kind}",
            "fetchAttempted": False,
        }

    cleaned = strip_trailing_artifacts(target)

    if is_localhost(target):
        return {
            **base,
            "disposition": "classified-non-fetchable",
            "classReason": "localhost_or_loopback",
            "fetchAttempted": False,
        }

    if looks_like_template(target):
        return {
            **base,
            "disposition": "classified-non-fetchable",
            "classReason": "template_or_markdown_artifact",
            "fetchAttempted": False,
        }

    if is_example_host(target):
        return {
            **base,
            "disposition": "classified-non-fetchable",
            "classReason": "example_documentation_host",
            "fetchAttempted": False,
        }

    if is_documentation_placeholder(target):
        return {
            **base,
            "disposition": "classified-non-fetchable",
            "classReason": "documentation_placeholder_url",
            "fetchAttempted": False,
        }

    if is_automation_or_webhook(target):
        return {
            **base,
            "disposition": "classified-non-fetchable",
            "classReason": "automations_webhook_not_exercised",
            "fetchAttempted": False,
        }
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"}:
        return {
            **base,
            "disposition": "classified-non-fetchable",
            "classReason": f"unsupported_scheme:{parsed.scheme or 'none'}",
            "fetchAttempted": False,
        }

    if not parsed.netloc:
        return {
            **base,
            "disposition": "classified-non-fetchable",
            "classReason": "missing_netloc",
            "fetchAttempted": False,
        }

    return {
        **base,
        "disposition": "fetch_candidate",
        "classReason": "public_http_candidate",
        "fetchAttempted": True,
        "fetchUrl": cleaned,
    }


def main() -> int:
    extraction = json.loads(EXTRACTION.read_text())
    refs = extraction["references"]
    if len(refs) != extraction["uniqueReferenceCount"]:
        print(
            f"ref count mismatch: list={len(refs)} "
            f"uniqueReferenceCount={extraction['uniqueReferenceCount']}",
            file=sys.stderr,
        )
        return 2

    classified = [classify_ref(r) for r in refs]
    fetch_cache: dict[str, dict] = {}
    inventory: list[dict] = []

    for item in classified:
        if item["disposition"] != "fetch_candidate":
            inventory.append(item)
            continue

        fetch_url_str = item["fetchUrl"]
        if fetch_url_str not in fetch_cache:
            slug = slug_for_url(fetch_url_str)
            body_path = WAVE / "bodies" / f"{slug}.bin"
            headers_path = WAVE / "headers" / f"{slug}.headers.txt"
            fetch_cache[fetch_url_str] = fetch_url(
                fetch_url_str, body_path, headers_path
            )

        meta = fetch_cache[fetch_url_str]
        if meta["status"] == "fetched":
            inventory.append(
                {
                    **{k: v for k, v in item.items() if k != "disposition"},
                    "disposition": "fetched+hashed",
                    "fetch": meta,
                }
            )
        else:
            inventory.append(
                {
                    **{k: v for k, v in item.items() if k != "disposition"},
                    "disposition": "blocked",
                    "classReason": f"fetch_{meta['status']}",
                    "fetch": meta,
                }
            )

    counts = Counter(row["disposition"] for row in inventory)
    class_reasons = Counter(row.get("classReason", "") for row in inventory)

    fetched_unique = sorted(
        {
            row["fetch"]["fetchUrl"]: {
                "fetchUrl": row["fetch"]["fetchUrl"],
                "finalUrl": row["fetch"].get("finalUrl"),
                "sha256": row["fetch"]["sha256"],
                "byteLength": row["fetch"]["byteLength"],
                "path": row["fetch"]["path"],
                "headersPath": row["fetch"]["headersPath"],
                "httpStatus": row["fetch"].get("httpStatus"),
            }
            for row in inventory
            if row["disposition"] == "fetched+hashed"
        }.values(),
        key=lambda x: x["fetchUrl"],
    )

    sample = fetched_unique[:5]
    sample_lines = []
    for entry in sample:
        assert entry["path"]
        sample_lines.append(f"{entry['sha256']}  {entry['path']}")

    sample_path = WAVE / "sample-sha256.txt"
    write_text(sample_path, "\n".join(sample_lines) + ("\n" if sample_lines else ""))

    captured_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    audit = {
        "unit": "u-dep-recursive-runtime-audit-001",
        "capturedAt": captured_at,
        "extractionPath": rel(EXTRACTION),
        "extractionSha256": sha256_file(EXTRACTION),
        "uniqueReferenceCount": len(inventory),
        "dispositionCounts": dict(counts),
        "classReasonCounts": dict(class_reasons),
        "fetchedUniqueUrlCount": len(fetched_unique),
        "fetchedUniqueUrls": fetched_unique,
        "sampleSha256Path": rel(sample_path),
        "behavioralExerciseClaim": False,
        "behavioralExerciseNote": (
            "HTTP custody fetch/classify only. No live Automations, Slack, "
            "or editor behavioral exercise was performed."
        ),
        "references": inventory,
    }
    write_json(WAVE / "audit.json", audit)

    remove_line = (
        "Recursive references extraction carried forward from "
        "parity/research/dep-closure-wave-007/recursive/extraction.json "
        "(sha256 eb531640c75896c1443fd0f8c12f5a82b79c3500d6cbbe9425611222621ca323). "
        "Live/runtime audit of extracted external targets remains open."
    )

    can_close = (
        len(inventory) == 176
        and counts.get("fetched+hashed", 0)
        + counts.get("classified-non-fetchable", 0)
        + counts.get("blocked", 0)
        == 176
        and counts.get("blocked", 0) == 0
    )

    merge = {
        "schemaVersion": 1,
        "unit": "u-dep-recursive-runtime-audit-001",
        "status": "proposal",
        "createdAt": captured_at,
        "targets": {
            "dependenciesJson": "parity/dependencies.json",
        },
        "completeDependencyClosure": False,
        "completeDependencyClosureNote": (
            "Do not claim completeDependencyClosure. Other unresolvedReferences "
            "and environment-bound edges remain open."
        ),
        "canCloseRecursiveUnresolvedReference": can_close,
        "closeRationale": (
            "All 176 extracted refs have an honest disposition "
            "(fetched+hashed or classified-non-fetchable; blocked=0). "
            "HTTP custody audit of extracted targets is complete. "
            "Remove the recursive runtime-audit unresolvedReference. "
            "Do not claim Automations/Slack/editor behavioral exercise; "
            "that stays under the live-integrations unresolvedReference."
            if can_close
            else "Inventory incomplete, disposition gap, or blocked fetches; do not close."
        ),
        "evidenceSummary": {
            "auditPath": rel(WAVE / "audit.json"),
            "extractionSha256": audit["extractionSha256"],
            "fetchedHashed": counts.get("fetched+hashed", 0),
            "classifiedNonFetchable": counts.get("classified-non-fetchable", 0),
            "blocked": counts.get("blocked", 0),
            "fetchedUniqueUrlCount": len(fetched_unique),
        },
        "dependencies": {
            "nodeMutations": [
                {
                    "id": "cursor-pstack",
                    "set": {
                        "readingEvidence": [
                            rel(WAVE / "audit.json"),
                            rel(EXTRACTION),
                        ]
                    },
                    "evidence": [rel(WAVE / "audit.json")],
                    "disposition": (
                        "Recursive extracted external targets audited for HTTP "
                        "custody (fetch+hash where safe; localhost/template/"
                        "example/placeholder/relative-escape classified). "
                        "No Automations/Slack/editor behavioral exercise."
                    ),
                }
            ],
            "edgeMutations": [],
            "unresolvedReferences": {
                "removeIfPresent": [remove_line] if can_close else [],
                "add": [],
                "note": (
                    "Remove the recursive runtime-audit open line. Evidence lives "
                    f"at {rel(WAVE / 'audit.json')}. Keep the live-integrations "
                    "unresolvedReference unchanged."
                    if can_close
                    else "Do not mutate unresolvedReferences; audit incomplete."
                ),
            },
        },
    }
    write_json(WAVE / "merge-proposal.json", merge)

    summary = {
        "uniqueReferenceCount": len(inventory),
        "dispositionCounts": dict(counts),
        "fetchedUniqueUrlCount": len(fetched_unique),
        "blockedCount": counts.get("blocked", 0),
        "fetchedCount": counts.get("fetched+hashed", 0),
        "classifiedNonFetchableCount": counts.get(
            "classified-non-fetchable", 0
        ),
        "canCloseRecursiveUnresolvedReference": can_close,
        "auditPath": rel(WAVE / "audit.json"),
        "mergeProposalPath": rel(WAVE / "merge-proposal.json"),
        "sampleSha256Path": rel(sample_path),
    }
    write_json(WAVE / "summary.json", summary)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
