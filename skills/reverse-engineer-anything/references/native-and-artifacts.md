# Binaries, Go metadata, archives and packages

These commands read file bytes. None of them executes the target, opens a disassembler, or requires
a provider installation.

## Binary file and linked layout

```bash
node scripts/rea.mjs inspect-binary-layout /path/to/binary --json
```

Supported containers: Mach-O (thin and fat/universal), ELF (32/64-bit, either endianness), PE
(32/64-bit). The result carries:

| Field | Meaning |
| --- | --- |
| `format`, `bits`, `endianness`, `architecture`, `file_type` | What the header declares |
| `slices` | Mach-O fat architecture slices with their byte ranges |
| `segments`, `sections` | File offset, size, virtual address and permissions where the format declares them |
| `entrypoint` | The declared entry address, or `null` |
| `symbols.imports`, `symbols.exports`, `symbols.table` | What the symbol or import table actually contains |
| `symbols.coverage` | Whether a table existed at all; `unavailable` on a stripped binary |
| `libraries` | `LC_LOAD_DYLIB`, `DT_NEEDED` or the PE import DLL list |
| `mitigations` | NX, PIE, RELRO, stack canary and FORTIFY candidates, each with the `marker` that produced it |
| `digests.sha256` | The digest of the bytes that were read |

Rules to follow when reading it out:

- A mitigation is a **candidate** read from a marker, not a proof of hardening. Quote the marker.
- `symbols.coverage.status: "unavailable"` means there was no table to read. It never means the
  binary has no imports; say "no symbol table is present" instead.
- The reference implementation supports Linux x64 through pwntools and refuses other hosts. This
  port reads Mach-O, ELF and PE natively, so a comparison between the two is expected to differ on
  macOS; results state that deviation in `limitations`.
- This is a header/table read. It is **not** decompilation. Function-level questions need Hopper,
  Ghidra or IDA, which this port does not have; record the question as an unknown rather than
  guessing from strings.

## Go build metadata

```bash
node scripts/rea.mjs inspect-go-binary /path/to/binary --json
```

Reports `go_version`, `build_settings` (`key=value`), the `modules` list with versions and `=>`
replacements, and the byte `ranges` each came from. Rules:

- No marker means the metadata is unavailable, not that the file is not a Go program. The command
  returns `capability_unavailable` with that sentence; keep it and do not rephrase it as "not Go".
- A `(devel)` or empty version is what the bytes say. Do not invent a release.
- If the address-to-offset mapping could not be resolved, `coverage.status` is `partial` and the
  limit says so — report the uncertainty rather than the version you expected.

## Archive and package inventory

```bash
node scripts/rea.mjs inspect-artifact /path/to/package.zip --json                      # fail on mismatch
node scripts/rea.mjs inspect-artifact /path/to/package.apk --integrity-policy record-and-continue --json
```

Supported containers: the ZIP family (`zip`, `apk`, `ipa`, `msix`, `appx`, including ZIP64). Members
are read in memory by logical path; nothing is extracted to disk and no member is executed.

- `collections.occurrences` — one entry per member with `logical_path`, sizes, `calculated_sha256`,
  the declared CRC when present, and `safe_path`.
- `collections.integrity_contradictions` — members whose bytes disagree with what the container
  declares. The default policy fails the whole call with `artifact_integrity_mismatch`; the
  `record-and-continue` policy returns the inventory with the contradiction recorded. Prefer failing
  when the contradiction matters to the question.
- `safe_path: false` marks an absolute, drive-lettered or `..` member path. Those are never read.
- A member that declares more than 256 MiB, or that fails to decompress, is never read whole: the
  call fails under the default policy, or records the contradiction and reports `coverage.truncated`
  with an exact `omitted_count` under `record-and-continue`.
- The inventory caps at 2000 members; a capped result reports `coverage.truncated` with an exact
  `omitted_count`. A member missing from a partial inventory is not absent from the archive.

Compare a selected set of members without re-reading the archive:

```bash
node scripts/rea.mjs inspect-analysis-view <evidence_id> --view inventory \
  --collection occurrences --logical-paths package.json,main.js --json
```

Containers outside the ZIP family are refused by name (`dmg`, `gzip`, `tar`, `7z`). A disk image
needs a mount this port does not perform; say so rather than describing the image's contents.
