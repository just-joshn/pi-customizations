# Verification

## Verified source and host contracts

The resource checker verifies all 158 upstream hashes and all 122 generated skill resources, including executable bits. The official pi loader discovers 47 legal skill names with no skill diagnostics. Benny's three operational skills remain outside discovery.

The TypeScript compiler checks the implementation against pi SDK 0.87.1. Integration tests use the real resource loader, extension runner, session manager, and agent sessions with a deterministic local provider. They make no paid model calls.

The real installed pi CLI also passes `scripts/verify-cli.mjs`. That check starts an isolated RPC process, discovers commands, invokes status and mode-off commands, observes the custom status message, and verifies orderly shutdown.

The upstream helper suite passed 52 tests with 206 assertions across orchestration and PR watcher tests. It ran from a temporary copy with the original frozen Bun lockfile so the vendored tree remained unchanged.

The npm dry-run package inventory contains every upstream file. An initial check caught npm omitting `.gitignore`; the manifest now explicitly includes that file.

## Reproduce local checks

Run from `extensions/pi-pstack`:

```sh
npm install
npm run check:resources
npm run typecheck
npm test
npm run check:cli
npm pack --dry-run --json
```

To run the preserved helper tests without changing the snapshot, copy `upstream/skills/poteto-mode/scripts` to a temporary directory. In that copy, run `bun install --frozen-lockfile` and `bun test orch watch-pr`.

## Limits

No live multi-provider model comparison, paid provider inference, external service integration, interactive terminal dialog journey, cloud deployment, or Benny automation was run. Model setup dialogs have behavioral tests using scripted user answers. The same-family review is independent for the stated code scope but does not satisfy pstack's requested cross-family reviewer diversity.

The completion predicate for full runtime parity remains NOT VERIFIED because the [compatibility report](parity.md) lists unmet host contracts. Passing local tests does not remove those gaps or prove universal instruction adherence.

The final extension suite has 17 passing tests and zero failures. The real nested-worker test proves active descendants are cancelled on both terminal completion and TaskStop, with no later writes after their scheduled completion time. TypeScript, resource checks, the CLI check, and the final package inventory also pass. The decision trail records these outcomes.
