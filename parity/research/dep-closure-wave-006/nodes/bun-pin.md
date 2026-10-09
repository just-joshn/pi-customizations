# source-bun-runtime Bun pin (wave-006)

pinStatus: `unresolved`
localBunStdout: `1.4.2`
capture: `parity/research/dep-closure-wave-006/bun/official-capture.json` sha256=`4045c0cf536a1361b1e8e2cd7da4fbc06d2560c5465f79d6a935f3fda40c17e0`

Wave-006 re-probed tools scripts and poteto-mode tree for pin files, recorded shebang usage and host mise-latest path, and re-fetched official Bun docs. No official Bun binary pin exists. Do not invent a pin from local version, mise latest, or bun-types.

Closure criteria:
- Exact Bun binary version declared in tools subtree via engines.bun, packageManager, volta, .bun-version, bunfig, or equivalent lock binding
- Declaration must be in source custody under poteto-mode/scripts or a documented official pin path for this package
