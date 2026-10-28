# pi-maintainer

Aider's edit, git, map, and lint features rebuilt on Pi's extension API for [Pi](https://pi.dev) 1.4.0. The target is behavioral parity with Aider at commit `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`, as described by the four reconstructions pinned in `parity/sources.json`.

Parity is measured, not asserted. `parity/ledger.json` holds one row per observable Aider behavior. `docs/NATIVE-GAPS.md` records every behavior Pi's public API cannot express, with the eight native-gap answers that file defines. `parity/options.json` disposes of every Aider long option as registered or explicitly nonclaimed. `node scripts/check-parity.mjs --final` stays red while a row is open, so a green `--feature <sar>` run means that feature's rows are verified and a red one names what is missing.

## Install

From the `pi-customizations` repository root:

```sh
bun install
pi install ./extensions/pi-maintainer
```

Pi loads this package from the checkout and does not install its npm dependencies. After `git pull`, run `bun install` again so `yaml`, `ignore`, and `diff-match-patch` resolve before you start Pi. A missing dependency fails at load with `Cannot find module 'yaml'` (or another runtime package name).

## Verify

From the extension directory:

```sh
bun run typecheck
bun run test
bun run test:coverage
bun run census
bun run check:parity
bun run check:parity --feature edit    # or git, map, lint
bun run check:parity:final
bun run journey:edit                   # real pi binary, print and RPC
node scripts/capture-aider-options.mjs # needs the pinned Aider checkout
```
