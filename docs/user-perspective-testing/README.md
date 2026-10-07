# User-perspective verification program

This directory holds the record for the exhaustive user-perspective verification of every package in this repository. The run is governed by the `figure-it-out` skill. Framing, scope, tiers and sequence live in the program framing document in the run store; this file records the contract that everything else obeys.

## Deliverables

| Artifact | Path | Written by |
| --- | --- | --- |
| Surface inventory (recon) | run store `surface-matrix.md` | coordinator |
| Unit list | `surfaces.tsv` | generator, from the inventory |
| Raw evidence | `artifacts/user-perspective/<scenario>/` | drives |
| Receipts | `artifacts/user-perspective/<scenario>/<surface_id>.json` | drives |
| Rolled-up verdicts | `verdicts.tsv` | `coverage-report.mjs` |
| Open findings | `open-findings.md` | coordinator |
| Decision trail | `decisions.tsv` | coordinator |

## The receipt contract

A drive asserts, and only asserts, by writing a receipt. A surface never receives a verdict any other way, and a verdict never comes from a worker's prose. One file per asserted surface, written by the drive process.

```json
{
  "surface_id": "PS-CMD-4",
  "package": "extensions/pi-pstack",
  "scenario": "pstack-commands",
  "verdict": "verified",
  "expected": "sending /pstack status posts a pstack-status custom message",
  "observed": "custom message customType=pstack-status, text starts \"pstack 0.15.9\"",
  "evidence": "artifacts/user-perspective/pstack-commands/raw/rpc-1.jsonl",
  "head_sha": "78dd5a0f1c2b3a4d5e6f708192a3b4c5d6e7f809",
  "pi_version": "1.0.4",
  "checked_at": "2026-10-07T18:00:00Z",
  "reason": null
}
```

Rules for the fields.

- `verdict` is exactly one of `verified`, `failed`, `inconclusive`, `env-limited`, `not-drivable`.
- `reason` is required and specific for every verdict except `verified`. "Needs network" is not specific. "Grok subscription login requires an interactive browser and the account is not enrolled in this environment" is.
- `observed` states the value that was actually read, not a restatement of `expected`. A receipt whose `observed` could have been written without running anything is a defect in the drive.
- `evidence` points at the raw capture the assertion was made against. The capture is written before the assertion, so a crash still leaves the evidence.
- `head_sha` is the commit the drive ran against. A fix invalidates receipts for the surfaces it touched, which is how a stale pass gets caught.

## The unit list

`surfaces.tsv` has one row per user-triggerable surface:

| Column | Meaning |
| --- | --- |
| `surface_id` | Stable ID from the inventory, such as `PS-CMD-4` |
| `package` | Owning package, as a repo-relative path |
| `kind` | command, tool, provider, theme, skill, and so on |
| `name` | The literal identifier a user types or sees |
| `trigger` | What a user does to reach it |
| `expected` | The user-observable result |
| `source` | `file:line` for the registration site |
| `tier` | `T1` discovery, `T2` behaviour, or `T3` deep flow |
| `veto` | The one observation that falsifies the row |

`veto` is the important column. If it cannot be written in one line, the row is not a testable unit and must be split.

## The predicate

Every surface in `surfaces.tsv` has a receipt, and every defect found is either fixed with a real-artifact receipt or parked in `open-findings.md` with a reproduction. `scripts/coverage-report.mjs` computes this from the two tables. A row with no receipt is `uncovered`, and `uncovered` is the only state the predicate rejects.

## Non-negotiables

- Do not weaken a gate to make a row pass. A drive that cannot assert is deleted or marked, never softened.
- Do not infer one surface's verdict from a neighbouring surface's drive.
- Do not hand-write a receipt. Every receipt comes from a drive that ran.
- A verdict is tied to a commit. Re-verify after any fix that touches the surface.
