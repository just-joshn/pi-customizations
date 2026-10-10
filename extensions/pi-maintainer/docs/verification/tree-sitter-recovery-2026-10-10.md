# Tree-sitter recovery, 2026-10-10

## Keep the parser choice open

Aider's edit watcher uses `grep_ast.TreeContext` at `aider/watch.py:235`. Parser compatibility is therefore an edit dependency, not work deferred to the map SAR. No production parser is accepted by this report.

The stopped TS0 worker preserved experiments under `/tmp/pi-maintainer-ts0`. These saved comparisons cover 150 language identifiers and a small fixture corpus. They are prototype observations, not proof over all inputs or platforms.

| Saved candidate | Identical language trees | Differing | Missing | Identical query comparisons | Differing | Failing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Kreuzberg grammar bridge with node-tree-sitter | 123 | 27 | 0 | 29 | 4 | 6 |
| Same bridge with query shim | 123 | 27 | 0 | 32 | 5 | 2 |
| Pinned-source WASMs with web-tree-sitter 0.25.10 | 135 | 12 | 3 | 36 | 2 | 1 |
| Same WASMs with query shim | 134 | 12 | 4 | 37 | 2 | 0 |

Each query comparison also records one reference failure reproduced by the candidate. It is not counted as a successful query above. A shim that removes a query error does not establish parser parity.

The underlying saved reports are in `/tmp/pi-maintainer-ts0/out`.

- `c1n-kreuzberg+node-tree-sitter.compare.json`
- `c1n-kreuzberg+node-tree-sitter+shim.compare.json`
- `c3-pinned-wts0.25.10.compare.json`
- `c3-pinned-wts0.25.10+shim.compare.json`

## Isolate the input-encoding difference

A fresh parent experiment reran the twelve differing pinned-WASM languages without the query shim. It parsed 57 fixture files with web-tree-sitter 0.25.10, then parsed the same files with the installed Python tree-sitter 0.25.2 and language pack 0.13.0.

Aider supplies UTF-8 bytes. The Python baseline kept that behavior. A separate counterfactual supplied UTF-16LE bytes to the same Python parser. The observer converted UTF-16 byte columns back to UTF-8 columns before comparing depth, node type, named status, start/end points, missing status, and error status.

| Language | Files | Mismatches against Python UTF-8 | Remaining mismatches against Python UTF-16LE |
| --- | ---: | ---: | --- |
| cmake | 3 | 1 | `err2.cmake` |
| cpp | 6 | 1 | None |
| csharp | 6 | 1 | `tagserr2.cs` |
| go | 6 | 1 | None |
| meson | 3 | 1 | None |
| nix | 3 | 1 | None |
| powershell | 3 | 1 | None |
| r | 6 | 1 | None |
| ron | 3 | 1 | None |
| solidity | 6 | 1 | None |
| swift | 6 | 2 | `err1.swift`, `ok.swift` |
| typescript | 6 | 1 | None |

All 42 fixtures in nine languages matched when Python received UTF-16LE. Four fixtures in the remaining three languages still differed. The input representation accounts for nine language-level disagreements in this corpus; the cause of the remaining four fixture disagreements is not established.

Source inspection supports this result.

- `web-tree-sitter/lib/tree-sitter.c:218` hardcodes `TSInputEncodingUTF16LE`.
- `tree-sitter/src/parser.cc:35` in the native Node package also selects UTF-16LE.
- The existing Python prototype in `ref/dump_py.py` supplies UTF-8 bytes, as Aider does.

Converting output coordinates alone cannot restore a different parsed tree. Do not change the Aider baseline to UTF-16 to make a candidate pass.

The committed result is [parser-encoding-2026-10-10.json](parser-encoding-2026-10-10.json). The parent probe is in the active agent store at `recovery/verify-parser-encoding.py`. It is audit tooling, not production parser code.

## Repeat the experiment

The preserved prototype checkout, grammar assets, and fixture corpus are prerequisites. Run the existing JavaScript observer into a separate output directory so the stopped worker's comparison remains unchanged.

```sh
node /tmp/pi-maintainer-ts0/dump_wts.mjs \
  /tmp/pi-maintainer-ts0/wts-0.25.10 \
  /tmp/pi-maintainer-ts0/c3-pinned/grammar-map.json \
  /tmp/pi-maintainer-ts0/out/parent-wts-02510 \
  cmake cpp csharp go meson nix powershell r ron solidity swift typescript

PYTHONDONTWRITEBYTECODE=1 \
  /Users/josh-desktop/src/experiments/aider/.re/build/venv/bin/python \
  /Users/josh-desktop/.pi/agent/pstack/store/pi-maintainer-6c98944b/recovery/verify-parser-encoding.py
```

The JavaScript observer's final line prints the total directory inventory, `150 langs`, even with a language filter. This run selected twelve languages and 57 files, not all 150 languages.

## Finish TS0 before wiring the watcher

A future recovery owner must preserve Python's UTF-8 semantics, explain the remaining grammar/runtime disagreements, resolve the missing languages, compare actual query captures, and verify loading through real Pi. Distribution size, supported platforms, cleanup, and cancellation remain unverified. The experiment does not choose a parser bridge or authorize an output-repair workaround.
