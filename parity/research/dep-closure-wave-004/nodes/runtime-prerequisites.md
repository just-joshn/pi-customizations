# Runtime / platform prerequisites

Tools scripts require a Bun binary on PATH for shebang execution and bootstrap Bun.spawnSync(`bun install --frozen-lockfile`). Official install docs cover host install of a specific version; the tools subtree does not declare engines or packageManager. Optional typescript native packages are platform-filtered in bun.lock (including literal cpu/os none). Commander Node-builtin needs are covered by prior nodejs-compat capture under local bun 1.4.2.

Evidence: `parity/research/dep-closure-wave-004/bun/official-capture.json`, `parity/research/dep-closure-wave-004/platform-matrix.json`.
