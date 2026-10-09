# Commander 14.0.0 source discovery

## Overview

This is a source reader's proposal for the parent dependency and requirement owners. It is not an acceptance definition, independent closure audit, parity verdict, or working-service receipt. No package or source helper ran. No installation or external communication occurred.

All package locators below are relative to `parity/reference/npm/commander-14.0.0/unpacked/package/` in the parent checkout. Consumer locators are relative to `parity/reference/cursor-plugins/`. `read-inventory.json` binds each file to its SHA-256 and complete inclusive read ranges. The parent contract was read as historical task context, not as authority to implement or run acceptance work in this partition.

The supplied registry metadata identifies `commander@14.0.0`, repository `git+https://github.com/tj/commander.js.git`, and gitHead `395cf7145fe28122f5a69026b310e02df114f907`. Its tarball URL is `https://registry.npmjs.org/commander/-/commander-14.0.0.tgz`. The retrieval files both record `2026-10-08T05:33:48Z`. The integrity receipt records `2026-10-08T05:34:25.751Z` and tarball SHA-256 `eaef3a697e7173c7347ca4c1e60dd2bc1d38214d2aaecce89d70881a51d7fde7`.

The registry and existing source lock agree on `sha512-2uM9rYjPvyq39NwLRqaiLtWHyDC1FvryJDa2ATTVims5YAS4PupsEQsDvP14FqhFr0P49CYDugi59xaxJlTXRA==`. The supplied receipt says `"registryIntegrityMatched": true` and `"signatureAuthenticated": false`. Registry metadata contains a signature with key ID `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`. Presence is not authentication. This task did not perform signature authentication or re-download the package.

## Key concepts

### Distribution and dependency roles

`package.json:35-61` declares CommonJS `index.js`, ESM `esm.mjs`, and corresponding declaration entries. `index.js:1-24` loads local modules and exposes `program`, factories, `Command`, `Option`, `Argument`, `Help`, and both error classes. `esm.mjs:1-16` supplies named exports from the CommonJS object. `typings/esm.d.mts:1-3` reexports declarations through `./index.js`. These files are distribution obligations even if a Pi adapter imports only `Command`.

There are no `dependencies`, `optionalDependencies`, or `peerDependencies` fields in the complete package manifest. No third-party runtime import appears in the distributed JavaScript. Runtime dependencies are local package modules and Node builtins. `lib/command.js:1-11` explicitly requires `node:events`, `node:child_process`, `node:path`, `node:fs`, and `node:process`. `Buffer` and `Error.captureStackTrace` are also used. There is no distributed native binary, platform-specific package, network client, credential loader, or install lifecycle hook.

Commander development dependencies are the ranges in `package.json:62-76`. They are `@eslint/js`, `@types/jest`, `@types/node`, `eslint`, `eslint-config-prettier`, `eslint-plugin-jest`, `globals`, `jest`, `prettier`, `ts-jest`, `tsd`, `typescript`, and `typescript-eslint`. They support Commander's repository scripts at lines 21-33. They do not become runtime transitive dependencies of pstack merely because the published manifest retains them. The tarball does not distribute the tests or tsconfig files those scripts mention.

The official pstack source helper manifest separately declares `"commander": "14.0.0"` under `dependencies`, `"bun-types": "latest"` and `"typescript": "latest"` under `devDependencies`, `"test": "bun test orch watch-pr"`, and `"typecheck": "tsc --project watch-pr/tsconfig.json --noEmit --strict"`. Its inspected lock fragment resolves the latter two to `bun-types@1.3.14` and `typescript@7.0.2`. The `bun-types` to `@types/node@26.1.2` to `undici-types@8.3.0` chain belongs to helper development/typecheck discovery. It is not a Commander runtime dependency. TypeScript's platform optional packages also belong to that separate chain.

`LICENSE:13-14` says, "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software." Lines 16-22 disclaim warranty and liability. Preserve the full notice and TJ Holowaychuk copyright when distributing copied or bundled substantial portions. `package-support.json:2-15` declares a supported Node target, time-permitting response, and npm funding backing. It is not a runtime service integration.

### Runtime and platform constraints

`package.json:78-80` states `"node": ">=20"`. `Readme.md:1150` says, "The current version of Commander is fully supported on Long Term Support versions of Node.js, and requires at least v20." This is an engine/support contract, not a check enforced by `Command` construction.

The official `orch.ts:1` launcher is `#!/usr/bin/env bun`. `orch.ts:20-27` runs `ensureDependenciesInstalled()` before a dynamic Commander import. The watch-pr CLI statically imports Commander at `cli.ts:2-7`; its bootstrap launcher belongs to the parent's existing source-tools partition. Bun compatibility with the listed Node builtins, streams, exit behavior, and ESM/CommonJS bridge remains a runtime constraint. Node's engine declaration alone does not prove Bun behavior.

`command.js:1198-1345` implements executable subcommands with filesystem search, realpath resolution, inherited stdio, source extensions `.js`, `.ts`, `.tsx`, `.mjs`, `.cjs`, platform-specific process launch, signal forwarding, inspector-port adjustment, and process termination. Windows uses `process.execPath` and checks executable existence. Other platforms may launch the executable directly or `process.argv[0]`. Neither inspected pstack consumer selects executable-command mode. Both supply descriptions through `.description()`, not the second string parameter to `.command()`. Therefore this is distributed Commander capability, not evidence that pstack's leaf actions spawn through Commander.

`Readme.md:1065` notes Windows does not support the illustrated Node shebang pattern. That documentation is not a declaration that these Bun helpers support Windows. Actual helper platform support remains open.

## How it works

### Parser and action path

`Command` is an `EventEmitter` with ordered commands, options, arguments, values, value sources, parent links, and hooks. `command.js:27-28` initializes `this._allowUnknownOption = false;` and `this._allowExcessArguments = false;`. Lines 1551-1641 parse options, apply environment and implied values, dispatch subcommands, process help, check required/conflicting options, validate arguments, invoke actions, and chain lifecycle hooks.

`command.js:557-573` passes declared processed positional arguments, local `this.opts()`, and the command object to the action handler. Root globals are not silently merged into the leaf options. `optsWithGlobals()` at lines 1925-1931 is separate and lets ancestor values overwrite local values. Orch explicitly reads root globals from `program.opts<GlobalOptions>()` in its store operations.

`command.js:1749-1890` accepts options around operands, long `--name=value`, short combined flags, and `--` as the end-of-options marker. A required option argument consumes the next token even when it looks like an option. Missing means `undefined`, not an empty string. Repeated ordinary options overwrite their prior value. Optional numeric-looking negative values and leaf negative-number operands have special handling. Option attribute names become camelCase in `option.js:216-221,315-319`.

`command.js:1001-1066` distinguishes Node, Electron, user, and internal eval argv layouts. Both consumers use `{ from: "user" }`, so every passed token is user input. Orch then passes `process.argv.slice(2)` only at its direct entry point. `parseAsync()` at lines 1120-1126 awaits action results. `parse()` at lines 1093-1099 does not await them. Repeated parsing saves/restores shallow option state at lines 1129-1179; both consumers create a fresh Command per call.

`command.js:1967-1994` applies environment values only over undefined values or values sourced from default/config/env. CLI values win. Boolean env options depend on variable presence, not its string value. Orch uses value-taking environment options `ORCH_STORE` and `ORCH_REPO`. Watch-pr declares no Commander environment-backed options.

`command.js:600-610` catches errors with code `commander.invalidArgument`, adds the option/argument context, and calls the configured error handler. Other parser exceptions propagate. `error.js:30-35` gives `InvalidArgumentError` exit code 1 and code `commander.invalidArgument`. Declaration types are not validation. `typings/index.d.ts:374` defines `OptionValues = Record<string, any>`, and the generic `.opts<T>()` return at line 878 does not check the caller's chosen interface at runtime.

### Output and exits

`command.js:63-75` defaults stdout/stderr writes to process streams. Width comes from TTY columns when available. `help.js:29-30` falls back to width 80. Help lists retain registration order by default, with implicit `-h, --help` and conditional `help [command]`. The default styles return plain text. `help.js:650-688` controls two-space item indentation, two-space description separation, and wrapping. `help.js:740-743` strips SGR sequences only. Display width is stripped string length, not a grapheme or terminal-cell width.

`command.js:2753-2774` checks `NO_COLOR`, `FORCE_COLOR`, and `CLICOLOR_FORCE`; comments explicitly say it does not check `NODE_DISABLE_COLORS`. Record width, TTY, locale, and color environment when capturing literal help or suggestion outputs.

`command.js:1941-1958` writes `${message}\n` to stderr, optionally follows with help, then exits with `config.exitCode || 1` and code `config.code || 'commander.error'`. `exitOverride()` at lines 506-520 throws a `CommanderError` by default after output. `_exit()` at lines 534-540 still calls `process.exit(exitCode)` if the override returns. The consumers use the throwing override.

Exact diagnostic templates include `"error: missing required argument '${name}'"` at lines 2035-2038, `"error: option '${option.flags}' argument missing"` at lines 2047-2050, `"error: required option '${option.flags}' not specified"` at lines 2059-2062, and `"error: too many arguments${forSubcommand}. Expected ${expected} argument${s} but got ${receivedArgs.length}."` at lines 2147-2155. Unknown options and commands add suggestions by default. `suggestSimilar.js:1-101` uses optimal string alignment distance, maximum distance 3, similarity greater than 0.4, deduplication, and locale sorting. Output forms are `\n(Did you mean ${similar[0]}?)` and `\n(Did you mean one of ${similar.join(', ')}?)`.

`command.js:2688-2694` renders requested help and throws code `commander.helpDisplayed` with exit 0. `.help()` at lines 2622-2634 preserves an existing process exit code or selects 1 for error help. `.outputHelp()` does not exit. Neither consumer defines a version option, so do not invent a supported `--version` path.

### Orch consumer proposals

`orch.ts:254-268` configures name `orch`, description `Plain-file orchestrate bookkeeping`, usage `[--store <dir>] [--json] [--force] <command>`, custom output, throwing exit override, help after errors, strict excess arguments, `ORCH_STORE`, and false defaults for JSON and force. The inherited output/error settings are copied when nested commands are created by `.command()` in `command.js:90-111,171-182`.

Propose individually unverified requirements for each declared leaf and option at `orch.ts:270-533`. The leaves are init; unit add/set/get/list/counts; ledger record/check/summary; inbox push/drain/count; gate park/list/resolve; frontier set/show; status; standing show/add. Required options are track, state, evidence, question, options, default, and answer on their corresponding leaves. The command names and placeholders are literal source requirements, not replacements with a generic store command.

`orch.ts:91-105` rejects integer spellings outside `/^[1-9]\d*$/` and unsafe integer values with "must be a positive integer". PR lists split on comma, reject empty components with "requires a comma-separated PR list", and do not trim components. Do not substitute watch-pr's looser numeric conversion. `parseVerdict` is imported from store.ts, so its allowed values and failure types require that separate source trace.

`orch.ts:202-215` rejects missing or whitespace-only store/repo values with "set --store <dir> or ORCH_STORE" and "set --repo <dir> or ORCH_REPO". Parser help exits before store creation. Parent/root actions call `requireSubcommand()` at lines 249-252, which checks the store directory first and then throws "a valid command is required". A missing command is therefore not interchangeable with Commander's generic missing-subcommand behavior.

`orch.ts:539-578` maps Commander success exits to 0 and all nonzero Commander exits to 1. NotFoundError maps to 2, possibly emitting a result instead of an error line. Other errors print `error: ${message(error)}\n`; UsageError also prints root help. Actions run through `runStore()` at lines 217-239 and close the store in `finally`. Parsing failure must not execute the store operation. This does not claim the bootstrap itself has no side effects, because it runs before parsing.

### Watch-pr consumer proposals

`watch-pr/cli.ts:82-158` configures name `watch-pr`, literal multiline description, custom writes, throwing exit override, and no help-after-error setting. Default values are interval 60 seconds, sweep interval 300 seconds, timeout 0, max query errors 5, and false for stack, queued-stack, status-only, allow-draft, and pretty. Owner, repo, and PR become null when absent. `--stack` conflicts with `queuedStack`; `--stack-prs` without queued mode calls `program.error("error: --stack-prs requires --queued-stack")` after parsing.

`cli.ts:34-66` accepts finite positive numbers for intervals, finite nonnegative timeout, and positive integer query budget using `Number()`. PR parsing strips a leading `#` then delegates to `parsePrNumber`. Stack lists trim each component and reject duplicate PRs with "contains a duplicate PR". This is intentionally different from orch's spelling and safe-integer validator. The PR upper bound and branded-type validation remain delegated to types.ts, not proved here.

`cli.ts:172-184` catches only CommanderError around parsing, maps help to 0 and nonzero parser outcomes to 64. Unexpected exceptions propagate. No GitHub context resolution happens after a caught parser failure. `cli.ts:185-223` selects pretty versus JSON renderers, resolves context, chooses explicit queue or discovered stack, reports WatcherQueryError as a rendered verdict, invokes queued policy only when queued and not status-only, and returns the verdict exit code. Those operations belong to github.ts, policy.ts, render.ts, and types.ts, not Commander.

## Where things live

The complete 14-file read inventory and hashes are in `read-inventory.json`. Its two consumer records bind source-level proposals to pstack revision `ccb5507cec1546dc88135c1139c811e6c59115ba`. The authoritative dependency ledger and lock fragment remain unchanged in the parent checkout.

Propose adding the two consumer edges to `npm:commander@14.0.0`, with separate runtime builtin edges for Node compatibility. Propose recording zero third-party distributed runtime dependencies for this exact tarball, while keeping package development metadata in its own role. Propose marking this reader partition complete without changing `closureAudited`, acceptance status, or Pi resolution to passed. This task does not own those ledger mutations.

## Gotchas and unresolved constraints

- Registry SHA-512 matching establishes content integrity against the supplied registry record, not signature authentication. The exact next provenance action is an authorized independent verification of the registry signature against the applicable trusted key and signed package message.
- No runtime path ran. The acceptance owner must capture literal help, parse errors, stream selection, numeric boundaries, argument ordering, globals/environment precedence, and exit mappings through the locked Bun launchers. These captures must precede freezing comparison rules.
- The exact Bun version and platform matrix remain unresolved in the source-tools ledger. The next runtime-prerequisite action is to bind the reference launcher environment to its actual Bun version and test its Commander interop and Node compatibility.
- This partition does not read store.ts, github.ts, policy.ts, render.ts, or types.ts. The next source action is for their owners to trace parseVerdict, parsePrNumber, downstream error classes, rendering, and action side effects. Caller behavior beyond the shown delegation remains open.
- Bootstrap installs/restarts before orch parsing. Help and invalid input cannot be claimed globally side-effect-free based on Commander alone. The bootstrap owner must bind that first-use behavior to source and later reference evidence.
- README links to docs, examples, a Chinese README, optional extra-typings, ts-node, Node documentation, npm run-script documentation, and enterprise support. These resources are not in the 14-file tarball. Preserve them as external documentation references for the parent closure owner to classify and pin if a requirement relies on them. They are not demonstrated imports or mandatory runtime dependencies.
- Source reading is complete for the requested 14 package files and two consumers. Recursive repository/dependency closure, independent review, frozen acceptance, Pi implementation bindings, clean installed journeys, and live GitHub behavior remain outside this task's evidence.

The exact next integration action is for the parent dependency owner to review these proposals against the supplied hashes, add the consumer/runtime-role edges without a passing acceptance status, and assign the Bun and downstream-consumer constraints to their existing source partitions.
