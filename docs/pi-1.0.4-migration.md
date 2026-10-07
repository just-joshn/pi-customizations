# Pi 1.0.4 development target

All eight extension packages pin their Pi development dependencies to `1.0.4`. Their wildcard host peer dependencies remain unchanged. The development pins match the installed Pi used by the user-perspective drives.

`extensions/pi-pstack/test/pi-version.test.ts` checks every package. It rejects a different development version or a bundled Pi host dependency. The regression failed for all eight packages before the pin change.

`bun.lock` records the aligned dependencies. The installation uses the local Bun cache. `bun install --offline` completes without downloading packages.

The [Pi 1.0.2 migration report](pi-1.0.2-migration.md) records the earlier migration. Vendored source hashes and source provenance retain their original version labels. Those labels describe the copied source, not the current development target.

The current audit captures are under `artifacts/user-perspective/f011-version/`. `full-verify-after-vendor.log` records the passing full repository gate. `schema-direct-drive.log` records the real Pi request to the local provider endpoint with no rejected schema keywords.
