# u-dep-recursive-runtime-audit-001 report

Status: complete (proposal published, ledgers untouched)

## Summary

HTTP custody audit of the wave-007 recursive extraction finished for all 176 refs. 12 refs fetched and hashed (9 unique URLs). 164 refs classified non-fetchable (relative escapes, localhost, templates, example hosts, doc placeholders, automations webhook). 0 blocked. Merge can remove the recursive runtime-audit unresolvedReference. No Automations, Slack, or editor behavioral exercise was claimed. Ledgers were not edited. `completeDependencyClosure` stays false.

throughput checkpoint: n/a, read-only investigation

## Done predicate (measured)

| Check | Result |
| --- | --- |
| Inventory of all 176 refs with disposition | Passed. `audit.json` has 176 rows, each `fetched+hashed`, `classified-non-fetchable`, or `blocked` |
| HTTP fetch + sha256 where safe | Passed. 9 unique URLs, 12 ref rows |
| Localhost/template classification | Passed. See class-reason table |
| Merge payload for close or narrow | Passed. `canCloseRecursiveUnresolvedReference: true` |
| No fabricated Automations/Slack live exercise | Passed. `behavioralExerciseClaim: false` |
| No ledger edits | Passed. Writes only under owned research/report paths |
| Sample hash verify | Passed. `verify_sample_shasum.py` returned `VERIFIED` |

## Counts

| Class | Count |
| --- | --- |
| Total refs | 176 |
| fetched+hashed | 12 |
| classified-non-fetchable | 164 |
| blocked | 0 |
| Unique fetched URLs | 9 |

### Class reasons

| Reason | Count |
| --- | --- |
| relative_escape_in_distribution | 145 |
| public_http_candidate (fetched) | 12 |
| template_or_markdown_artifact | 9 |
| localhost_or_loopback | 6 |
| example_documentation_host | 2 |
| documentation_placeholder_url | 2 |

## Overview

Wave-007 extracted absolute URLs and relative-escape markdown links from the locked distribution inventory and left `runtimeAuditStatus: open`. This unit closes that custody gap by classifying every extracted target and fetching safe public HTTP documents with sha256 bodies. It does not exercise live integrations. That work stays under the separate live-integrations unresolvedReference.

## Key concepts

- fetched+hashed means a safe public HTTP(S) GET succeeded and the response body was stored with sha256.
- classified-non-fetchable means the target is not a safe live fetch (relative escape, localhost, template, example host, docs placeholder, or automations webhook).
- blocked means a fetch was attempted and failed. This run has zero blocked refs.
- Closing the recursive unresolvedReference means HTTP custody of extracted targets is done. It does not mean Automations/Slack/editor behavior was observed.

## How it works

`audit_refs.py` loads `parity/research/dep-closure-wave-007/recursive/extraction.json` (sha256 `eb531640c75896c1443fd0f8c12f5a82b79c3500d6cbbe9425611222621ca323`). It classifies each of the 176 refs, fetches unique safe URLs once, writes bodies under `bodies/`, and emits `audit.json`, `merge-proposal.json`, and `sample-sha256.txt`.

## Where things live

| Artifact | Path |
| --- | --- |
| Lever | `parity/research/dep-recursive-runtime-audit-001/audit_refs.py` |
| Full inventory | `parity/research/dep-recursive-runtime-audit-001/audit.json` |
| Summary | `parity/research/dep-recursive-runtime-audit-001/summary.json` |
| Merge proposal | `parity/research/dep-recursive-runtime-audit-001/merge-proposal.json` |
| Sample hashes | `parity/research/dep-recursive-runtime-audit-001/sample-sha256.txt` |
| Sample verifier | `parity/research/dep-recursive-runtime-audit-001/verify_sample_shasum.py` |
| Fetched bodies | `parity/research/dep-recursive-runtime-audit-001/bodies/` |
| Worker report | `parity/briefs/reports/u-dep-recursive-runtime-audit-001-report.md` |

## Gotchas

- Relative-escape links (145) point inside the distribution tree. They are not HTTP targets.
- Several absolute URLs are templates or markdown artifacts (`{owner}`, `<port`, trailing backticks).
- `https://api2.cursor.sh/automations/webhook/<id` was classified non-fetchable. No webhook call was made.
- GitHub and Cursor HTML responses can change between fetches. Hashes here are for this capture only.
- Live Automations/Slack exercise remains open under its own unresolvedReference.

## Fetched unique URLs

| URL | sha256 | bytes |
| --- | --- | --- |
| `https://cursor.com/blog/projects` | `2ae7fa6e93e3365402268b4319ecc5dc7b0ed8d2e48bfe6ce16ed6343341213e` | 185489 |
| `https://cursor.com/docs/skills` | `214ae1e8719f12562eba98aa4a1005d69efde0c7910b784a7adaaf05b2fe0b4d` | 502740 |
| `https://cursor.com/docs/subagents#cloud-subagents` | `91501df321b1a76105cb4d25f32435e0379b1f34913f8ae93aede4c55fc4fd97` | 700143 |
| `https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap` | `6eb402fe7dd4733eae8c16533c6ea4a06dd8fc31d822723f6443bee2aac293aa` | 1581 |
| `https://github.com/cursor/plugins` | `1bc34b7bca351de0de7534be142359c662542783c5df86c557cba639ce92fd7c` | 365196 |
| `https://github.com/cursor/plugins/blob/main/pstack/` | `47872963ce2d3f2a62265335df36a4385f1a36d096131e99fdf0a6b9d6dfa6ac` | 344361 |
| `https://github.com/cursor/plugins/tree/main/pstack` | `1f52a4167b631d03b35a8ca64d2a513b6aceb0caa433b8f94046cbc65371e44c` | 344361 |
| `https://tailscale.com/install.sh` | `4207f322e10ad26b3054abe7c99dfb54da09843c8d0a50d0a82f8eff4972a0d1` | 20309 |
| `https://x.com/poteto` | `b49911b819424ce8b516b72d3d7833e62ab125491ccdd3ba0efdab8e21b60b5d` | 177200 |

## Verification

Run from the repository root:

```bash
python3 parity/research/dep-recursive-runtime-audit-001/verify_sample_shasum.py
```

Observed result: `VERIFIED` (5 sample bodies matched via `shasum -a 256 -c` and independent Python re-hash).

## Can merge close the recursive unresolvedReference?

Yes. All 176 refs have custody dispositions, blocked count is 0, and Automations/Slack were not fabricated as live. Coordinator should remove the open recursive line and attach `audit.json` as evidence on `cursor-pstack`. Keep the live-integrations unresolvedReference. Do not set `completeDependencyClosure` true.

## Merge payload

Coordinator-only apply target. Worker did not edit ledgers.

Path: `parity/research/dep-recursive-runtime-audit-001/merge-proposal.json`

```json
{
  "schemaVersion": 1,
  "unit": "u-dep-recursive-runtime-audit-001",
  "status": "proposal",
  "createdAt": "2026-10-09T02:07:31Z",
  "targets": {
    "dependenciesJson": "parity/dependencies.json"
  },
  "completeDependencyClosure": false,
  "completeDependencyClosureNote": "Do not claim completeDependencyClosure. Other unresolvedReferences and environment-bound edges remain open.",
  "canCloseRecursiveUnresolvedReference": true,
  "closeRationale": "All 176 extracted refs have an honest disposition (fetched+hashed or classified-non-fetchable; blocked=0). HTTP custody audit of extracted targets is complete. Remove the recursive runtime-audit unresolvedReference. Do not claim Automations/Slack/editor behavioral exercise; that stays under the live-integrations unresolvedReference.",
  "evidenceSummary": {
    "auditPath": "parity/research/dep-recursive-runtime-audit-001/audit.json",
    "extractionSha256": "eb531640c75896c1443fd0f8c12f5a82b79c3500d6cbbe9425611222621ca323",
    "fetchedHashed": 12,
    "classifiedNonFetchable": 164,
    "blocked": 0,
    "fetchedUniqueUrlCount": 9
  },
  "dependencies": {
    "nodeMutations": [
      {
        "id": "cursor-pstack",
        "set": {
          "readingEvidence": [
            "parity/research/dep-recursive-runtime-audit-001/audit.json",
            "parity/research/dep-closure-wave-007/recursive/extraction.json"
          ]
        },
        "evidence": [
          "parity/research/dep-recursive-runtime-audit-001/audit.json"
        ],
        "disposition": "Recursive extracted external targets audited for HTTP custody (fetch+hash where safe; localhost/template/example/placeholder/relative-escape classified). No Automations/Slack/editor behavioral exercise."
      }
    ],
    "edgeMutations": [],
    "unresolvedReferences": {
      "removeIfPresent": [
        "Recursive references extraction carried forward from parity/research/dep-closure-wave-007/recursive/extraction.json (sha256 eb531640c75896c1443fd0f8c12f5a82b79c3500d6cbbe9425611222621ca323). Live/runtime audit of extracted external targets remains open."
      ],
      "add": [],
      "note": "Remove the recursive runtime-audit open line. Evidence lives at parity/research/dep-recursive-runtime-audit-001/audit.json. Keep the live-integrations unresolvedReference unchanged."
    }
  }
}
```
