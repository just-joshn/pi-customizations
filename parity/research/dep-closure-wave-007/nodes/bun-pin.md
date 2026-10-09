# source-bun-runtime Bun pin (wave-007)

pinStatus: `unresolved`
localBunStdout: `1.4.2`
capture: `parity/research/dep-closure-wave-007/bun/official-capture.json` sha256=`88728e9945ba7093bfea877fef5b24a46603b703acadeed569eb5237525aceca`

Wave-007 re-probed tools scripts and poteto-mode tree for pin files, recorded shebang usage and host mise-latest path, and re-fetched official Bun docs. No official Bun binary pin exists. Do not invent a pin from local version, mise latest, or bun-types.

Closure criteria:
- Exact Bun binary version declared in tools subtree via engines.bun, packageManager, volta, .bun-version, bunfig, or equivalent lock binding
- Declaration must be in source custody under poteto-mode/scripts or a documented official pin path for this package
