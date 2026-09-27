# Project audit findings

Initial census covered 465 tracked files. Root skills own 28 files, the extension owns 433, and four files are repository metadata. The extension source runtime was assigned to another reviewer.

## Verified defects

1. `skills/implement-cli-from-contract/scripts/differential.py` deleted a path constructed from an unvalidated case ID before probe validation. Absolute paths and parent traversal could delete unrelated directories. Reproduced against temporary evidence. The fix removes deletion because probes already use fresh UUID directories, validates the entire corpus before launch, prevents case options from overriding record identity or output, and rejects symlinked output artifacts. Five new process-boundary tests and nine existing evidence-tool tests passed.
2. `skills/doctor/scripts/inventory.py` used compact-JSON substring filters that ignored valid whitespace-formatted user and system records. Its fallback prompt lookup did not constrain the session header cwd. It did not validate parsed JSON objects, content blocks, sections, or tool declarations. Malformed records could crash a whole scan. `os.walk(..., followlinks=True)` lacked directory identity pruning and followed skill-directory cycles. Fixed and covered by failing-then-passing tests. Prompt reconstruction now follows the final entry's parentId ancestry and excludes abandoned branches.
3. Doctor's npm package lookup always used the user agent directory. Official `package-manager.ts` uses `<cwd>/.pi/npm/node_modules` for project scope. Fixed npm and git scope using the settings base, and fixed effective project sessionDir precedence over user settings. SSH URLs, prefixed SCP URLs, nested protocol prefixes, and refs now normalize to managed install paths. Official unsafe Git path examples produce error records and are skipped during skill discovery. Thirteen doctor tests pass.
4. `skills/reverse-engineer-cli/scripts/probe.py` originally accepted terminal rows/columns outside the unsigned 16-bit range passed to `struct.pack('HHHH', ...)`. Invalid input raised a traceback after output directory creation. Its original top-level main was 239 lines. `investigate.py` had 71-line `init` and 59-line `run` functions. The reverse-tools worker fixed and refactored these cases; the subsequent combined test run passed.
5. `extensions/pi-pstack/skills/pr-review-canvas/renderer.js` accepts an array without checking its elements, then calls string methods on each. Invalid external diff data throws. `renderDiff` is 75 lines. Its repeated searches of adds/dels at lines 144 and 148 are quadratic and can be replaced by indices retained during parsing without changing output. `detectMoves` also compares candidate blocks pairwise. Rendered diff strings are escaped for text context; no unescaped-string XSS was established.

## Literal AGENTS findings

The initial JS/TS AST census found 1,255 function-like bodies, 75 at least 50 lines, and 347 mutation candidates. These totals include preserved upstream copies and generated helpers. Mutation candidates count property/index assignments and mutating collection methods; they require semantic review rather than treating every method named `set` as a proven violation.

Actual code files above the 800-line maximum are `skills/poteto-mode/scripts/orch/store.ts` at 1,607 lines and `skills/poteto-mode/scripts/watch-pr/policy.ts` at 832 lines, each present under both extension generated skills and preserved upstream. `package-lock.json` is 4,501 lines and `docs/resource-map.json` is 1,590 lines. Those are data, but literal all-file wording has no explicit exemption.

Long production helper functions include `createProgram` at 284 lines, `openStore` at 408, `readSnapshot` at 82, `runSimple` at 103, `runQueued` at 130, `parseArgs` at 71, `renderBlocker` at 61, `acquireLock` at 61, `readGates` at 55, `parseFrontier` at 56, and `statusMarkdown` at 61. Test callbacks are also included by literal function-size wording.

The initial scan found six `console.log` occurrences in tracked executable JS/MJS. Root replaced the two maintained resource and CLI verification occurrences with `process.stdout.write`. The two `check-plan.mjs` output lines repeated in generated and upstream copies remain preserved source behavior.

The original extension coverage command included only `src/*.ts`. It proved no coverage threshold for resource generation, CLI verification, generated helpers, preserved helpers, doctor, or Python evidence tools. Root expanded maintained coverage and added `make verify`. The bundled Bun helper package has tests but no coverage threshold script. Doctor initially had no tests and now has a dedicated suite. Retrospective TDD for preexisting code cannot be proven by a passing suite.

Literal zero mutation cannot hold while invoking mutable OS/process/browser APIs such as filesystem writes, DOM class updates, EventEmitter registration, or hashing state. Project-owned data can be immutable without claiming those effects are immutable. A blanket prohibition on every hardcoded value is similarly undefined for protocol strings, regexes, CLI option names, and intended defaults. No network service endpoints were found in this partition, so SQL, CSRF, endpoint authentication, and rate-limit gates have no corresponding endpoint implementation to inspect.

## Source parity

The resource generator pins hashes for every upstream source and generates executable helper copies byte-for-byte. Editing only generated helpers fails `check:resources`; editing pinned upstream files fails hash verification. Parity-preserving fixes require explicit, reviewed generator transformations or a new audited baseline. Treating executable upstream helpers as automatically exempt would conceal the violations above.

## Official source used

Current official source checkout supplied by root is `/tmp/pstack-pi-source`. Session header and cwd matching are in `packages/coding-agent/src/core/session-manager.ts`. `toolsRemoved` is `ToolReference[]`, not strings, in `packages/ai/src/types.ts`. Managed npm install paths are in `packages/coding-agent/src/core/package-manager.ts`.

## Verification after fixes

The latest measured full Python run passed 40 tests across the three suites before the final two evidence-validity regressions were added. Coverage 7.16.1 with branch measurement, subprocess capture, and copied-script path mapping reported 91% combined coverage. Individual results were doctor 91%, differential 91%, investigate 99%, and probe 86%. The report contains all four canonical production scripts. Root owns final combined verification after concurrent edits.

The final input-validation pass reproduced and fixed relative doctor sessionDir resolution against the wrong process directory, null or incorrectly typed settings fields, negative day windows, malformed differential records, and malformed triage entries. Doctor reports invalid settings explicitly. Differential exits with code 2 and a diagnostic for invalid comparison inputs. All doctor and differential functions, including their test methods, remain below 50 lines.

Two final process tests reproduced false `MATCH` outcomes when both targets failed to launch or a capture was incomplete. Comparison now rejects explicit launch errors and incomplete captures with code 2. Older valid records that omit those newer fields remain supported. All eleven differential tests pass after that fix.
