# source-bun-runtime

Previously incomplete: True

## Disposition

Source declaration of Bun shebang and Bun.spawnSync install/restart contracts read. Official Bun runtime package contracts, version pin, and Node-builtin compatibility proof remain open.

proposeReadingComplete: True
proposeDependenciesEnumerated: False

## Sources

- `parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/watch-pr/watch-pr` sha256=`d955603be6cc0e8b8ffcec722f635192b2261410b1f2929abea94480e47eb5d4` bytes=211
  - lines 1-6:
```
#!/usr/bin/env bun
import { ensureDependenciesInstalled } from "../bootstrap.ts";

ensureDependenciesInstalled();
const { main } = await import("./cli.ts");
process.exitCode = await main(process.argv.slice(2));
```
- `parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bootstrap.ts` sha256=`ccd2ed08fd9da9d0d942e5f2491cfc74bb92d8a08fa51755e0da1ac8de287361` bytes=1737
  - Bun.spawnSync install lines 35-45:
```
  const result = Bun.spawnSync(
    [process.execPath, "install", "--frozen-lockfile"],
    { cwd: scriptsDirectory }
  );
  if (result.exitCode !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(
      `bun install --frozen-lockfile exited with status ${result.exitCode}`
    );
  }
```
  - Bun.spawnSync restart lines 54-61:
```
  const restarted = Bun.spawnSync([process.execPath, ...process.argv.slice(1)], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(restarted.exitCode ?? 1);
```
