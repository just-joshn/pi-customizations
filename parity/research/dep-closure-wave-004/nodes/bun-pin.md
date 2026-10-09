# Official Bun runtime version pin

Local bun --version: `1.4.2` (capture sha256=`b99b4c7cdf236f59bc9f65d963deaecae3b16a7dad87939cacb9057f7664daee`).
Lock bun-types: `bun-types@1.3.14`.

Lock resolves bun-types to bun-types@1.3.14; local bun --version is 1.4.2. bun-types is not an official Bun runtime pin.

Official install docs describe host install of a specific Bun version via the install script. The tools subtree has no engines, packageManager, .bun-version, or lock entry that pins the Bun binary. Keep official pin unresolved. Do not invent a pin from local 1.4.2 or bun-types@1.3.14.

pinStatus: unresolved
