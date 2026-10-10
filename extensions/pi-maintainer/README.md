# pi-maintainer

Aider-parity edit, git, map, and lint for [Pi](https://pi.dev) 1.1.0.

## Install

From the `pi-customizations` repository root:

```sh
bun install
pi install ./extensions/pi-maintainer
```

Pi loads this package from the checkout and does not install its npm dependencies. After `git pull`, run `bun install` again so `yaml`, `ignore`, and `diff-match-patch` resolve before you start Pi. A missing dependency fails at load with `Cannot find module 'yaml'` (or another runtime package name).

## Verify

```sh
bun install
bun run --filter pi-maintainer test
node extensions/pi-maintainer/scripts/check-parity.mjs
```
