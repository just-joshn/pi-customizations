# Official Bun runtime version pin

Local bun --version: `1.4.2` (capture sha256=`8175ac22d3a200ea0c6b04e240ba440308532413d1c9f38b5603471128ce9747`).
Lock bun-types: `bun-types`.

Lock resolves bun-types; local bun --version is 1.4.2. bun-types is not an official Bun runtime pin.

Wave-005 re-probed tools scripts for engines/packageManager/volta/.bun-version/bunfig.toml and re-fetched official Bun docs including the bun-version guide. No official Bun binary pin exists in the tools subtree. Do not invent a pin from local version or bun-types.

pinStatus: unresolved
