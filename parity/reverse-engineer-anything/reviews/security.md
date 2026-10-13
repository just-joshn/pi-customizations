Review complete. I read the CLI entrypoint, the store/IO layer, and every format reader. Findings are ordered by severity.

## Findings

**1. Zip bomb → unbounded memory / OOM — CONFIRMED**
`scripts/lib/formats/zip.mjs:193`
`inflateRawSync(compressed)` runs with no cap on `entry.uncompressed_size`. A hostile archive with a small deflate member (e.g. 42 KB → 4.5 GB) makes the process allocate gigabytes and crash. `readZipMember` only bounds `compressed_size` against the file length, never the *decompressed* size. `inspect-artifact` reads up to 2000 members, so one bomb is enough.
*Fix:* refuse (or stream-cap) members whose `uncompressed_size` exceeds a hard limit (e.g. 256 MB) before inflating; use `inflateRawSync` with `maxOutputLength`.

**2. Arbitrary file write via hostile bundle's `unknown_id` — CONFIRMED**
`scripts/lib/store.mjs:162,177-178` → `scripts/lib/unknowns.mjs:126-131`
`importBundle` validates every *evidence* record's content address (`assertBundleIntegrity`), but the `unknowns` array is trusted: `importUnknownRecord` does `join(dir, \`${record.unknown_id}.json\`)` with an attacker-controlled id and `writeJsonAtomic` writes the whole attacker JSON object. `unknown_id = "../../../../tmp/x"` writes arbitrary JSON to any path the process can write. No format check, no `../`/absolute-path rejection.
*Fix:* validate `unknown_id` against `/^unk_[0-9a-f]{64}$/` before joining, and reject the bundle otherwise.

**3. HAR credential leak: URL query strings are not redacted — CONFIRMED**
`scripts/lib/formats/har.mjs:153-162`
`readUrl` strips userinfo and splits origin/path at `?`/`#`, but returns the *full* `url` including the query string. Tokens/API keys passed as query params (`?token=`, `?api_key=`, `?sig=`) are persisted verbatim into the retained evidence envelope.
*Fix:* strip the query/fragment from `url` (or redact known credential query keys) before returning.

**4. HAR redaction list misses common credential headers — CONFIRMED (incompleteness)**
`scripts/lib/formats/har.mjs:18,143-146`
Redaction is name-substring based and has no `key`/`credential`/`signature`/`access` parts. `x-amz-credential`, `x-amz-signature`, `x-access-key`, `x-client-key` etc. are copied with full values into `request_headers`/`response_headers` and persisted.
*Fix:* broaden the parts list (add `key`, `credential`, `signature`, `access`, `pass`) or default to redacting any header whose *value* looks like a token when the name is unknown.

**5. Path traversal on user-supplied evidence/unknown ids — CONFIRMED**
`scripts/lib/store.mjs:106-108`, `scripts/lib/unknowns.mjs:61-64,174-175`
`readRecord`, `updateUnknown`, and `verifyUnknownResolution` all do `join(dir, \`${id}.json\`)` with no format validation. `update-unknown ../../../../x` or an `inspect-analysis-view` selector like `ev_../../..` escapes the store directory (read of any JSON file; `updateUnknown` can also overwrite a file that already parses with a matching `head.revision`).
*Fix:* require `/^ev_[0-9a-f]{64}$/` (evidence) and `/^unk_[0-9a-f]{64}$/` (unknown) at the boundary, and resolve+verify the joined path stays under the store root.

**6. Unknown-revision update is unsynchronized → lost update — CONFIRMED**
`scripts/lib/unknowns.mjs:61-109`
`updateUnknown` does read → revision check → write with no lock. Two concurrent `update-unknown` invocations both read revision N, both pass the check, both write revision N+1, silently dropping one investigator's conclusion. (Ledger writes go through `withLedgerLock`; unknown writes do not.)
*Fix:* route `updateUnknown` through the same lock, or make the write compare-and-swap (re-read revision inside the critical section / use `O_EXCL`+rename).

**7. Ledger lock stale-takeover can delete a successor's lock — SUSPECTED**
`scripts/lib/store.mjs:79-99`
If writer A's work exceeds `LOCK_STALE_MS` (10 s), writer B declares the lock stale, `rm`s it, and acquires it. A's `finally` then does `rm(lockPath, { force: true })`, deleting B's lock, so a third writer can enter concurrently and lose ledger updates. Triggerable under slow disk/huge ledger.
*Fix:* store a unique owner token in the lock file and only remove on ownership; compare `ino`/`ctime` before the `finally` rm.

**8. Deeply nested ASAR/bundle JSON → stack overflow DoS — SUSPECTED**
`scripts/lib/formats/asar.mjs` (recursive `walk` + `JSON.parse`), `scripts/lib/canonical.mjs` (`canonicalJson` recursion during `assertBundleIntegrity`/`evidenceId`)
A hostile ASAR header or bundle with thousands of nested objects throws `RangeError` (caught only at the top-level error envelope, so the run fails). No code execution or store corruption, but it's a cheap DoS of the tool.
*Fix:* bound nesting depth (iterative walk or explicit depth limit) before/while parsing.

## Clean categories

- **Command/argument injection:** clean. No `child_process`/`spawn`/`exec` anywhere; argv never reaches a shell; all `import()` calls use static string literals (`commands.mjs:143,164,189`, `route.mjs:34`).
- **Executing target content:** clean. The JS "analyzer" is a hand-written lexer/token scanner (`javascript-lexer.mjs`, `javascript-graph.mjs`); no `eval`/`Function`/`require`/dynamic `import` of target bytes. `NODE_BUILTINS` (incl. `child_process`) is only a `Set` used to classify `require()` specifiers in text — never invoked.
- **Archive member path handling for writes:** clean. `normalizeMemberPath` (`zip.mjs:43-50`) refuses absolute, drive-letter, and `..` paths, and the analysis never extracts/writes members to disk; unsafe-path members are skipped before any decompression (`artifact.mjs:104-105`). Symlinks in a directory target are not followed (`target.mjs` `isDirectory()`/`isFile()` skip symlinks).
- **Evidence-id collisions:** clean. Evidence ids are content-addressed (`ev_` + SHA-256 over canonical content); dedup is intentional, and collision requires a SHA-256 break.
