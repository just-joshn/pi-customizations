# Bun 1.4.2 migration best practices — cited digest

Binary: `/Users/josh-desktop/.local/share/mise/installs/bun/1.4.2/bin/bun`, `bun --version` → `1.4.2`, revision `744846f84`.
Docs snapshot: `/tmp/bun-llms-full.txt` (2,136,096 bytes, fetched from `https://bun.sh/llms-full.txt`, which serves the `bun.com` corpus).
Docs quotes carry the exact `Source:` URL the file prints. Binary quotes carry the exact command that printed them.
Local experiments ran in `/tmp/bunscratch`, `/tmp/buns2` … `/tmp/buns9`. No project files touched.

---

## A. WORKSPACES

**Definition and syntax.** `"Bun supports workspaces in package.json. With workspaces, you develop several independent packages in a single repository, a monorepo."` (https://bun.com/docs/pm/workspaces). Also `"In package.json, set "workspaces" to an array of relative paths."` (https://bun.com/docs/guides/install/from-npm-install-to-bun-install).

Array form: `{ "name": "my-project", "version": "1.0.0", "workspaces": ["packages/*"], "devDependencies": { "example-package-in-monorepo": "workspace:*" } }` (https://bun.com/docs/pm/workspaces).

**Glob support is explicit.** `"Glob support — Bun supports full glob syntax in "workspaces", including negative patterns such as !**/excluded/**."` Example from the same page: `{ "workspaces": ["packages/**", "!packages/**/test/**", "!packages/**/template/**"] }` (https://bun.com/docs/pm/workspaces).

**Object form for catalogs.** `"In your root-level package.json, add a catalog or catalogs field within the workspaces object"` — `{ "workspaces": { "packages": ["packages/*"], "catalog": {...}, "catalogs": {...} } }`, and `"catalog and catalogs also work at the top level of package.json."` (https://bun.com/docs/pm/catalogs).

**Run a script in one / several / all workspaces.**
- Single: `bun run --filter foo myscript`, and in a workspace `--filter` reaches anywhere: `"# in src/bar: runs myscript in src/foo, no need to cd! / bun run --filter foo myscript"` (https://bun.com/docs/pm/filter).
- Several: `bun --filter <pattern> <script>`, e.g. `"bun --filter '*' dev"`, `"bun --filter 'web...' build"`, `"bun --filter '*' --filter '!docs' lint"` (https://bun.com/docs/pm/filter).
- All: `bun run --sequential --workspaces build` (https://bun.com/docs/pm/filter). `bun run --help` prints `--workspaces  Run a script in all workspace packages (from the "workspaces" field in package.json)`.

**Two forms, and one that does NOT exist.** `bun --filter <pattern> <script>` and `bun run --filter <pattern> <script>` both work. `bun --filter <pattern> run <script>` FAILS. Verified: `bun --filter 'pkg-*' run hello` → `error: Script "run" not found in 2 packages matching "pkg-*"`. `bun run --filter 'pkg-*' hello` → `pkg-b hello: B-HELLO` then `pkg-a hello: A-HELLO`.

The docs warn about exactly this. `"For package-manager commands, put the flag after the subcommand (bun install --filter api), since bun --filter <pattern> <word> runs <word> as a script."` (https://bun.com/docs/pm/filter).

**`--cwd`.** Present in the binary, absent from docs (0 hits for `--cwd` in `/tmp/bun-llms-full.txt`). `bun run --help`: `--cwd=<val>  Absolute path to resolve files & entry points from. This just changes the process' cwd.` `bun install --help`: `--cwd=<val>  Set a specific cwd`. Verified working: `bun run --cwd packages/a hello` → `A-HELLO`.

**Alternative to `--prefix`? No.** `--prefix` is unsupported. Verified: `bun run --prefix packages/a hello` → `error: Script not found "packages/a"`. Docs never mention `--prefix` as an npm alias. The documented substitutes are `--cwd` (binary help only) and `--filter`.

**Workspace dependency resolution is a symlink, not a copy.** `"If package b depends on a, bun install installs your local packages/a directory into node_modules instead of downloading it from the npm registry."` (https://bun.com/docs/pm/workspaces). Verified: `bun install` in a fresh monorepo produced `packages/a/node_modules/pkg-b -> ../../b`.

**`workspace:` protocol is supported.** `"To reference another package in the monorepo, use a semver range or the workspace protocol (for example workspace:*)"` (https://bun.com/docs/pm/workspaces). On publish Bun rewrites it: `"workspace:*" -> "1.0.1"`, `"workspace:^" -> "^1.0.1"`, `"workspace:~" -> "~1.0.1"`, and `"workspace:1.0.2" -> "1.0.2" // Even if current version is 1.0.1` (https://bun.com/docs/pm/workspaces).

**One lockfile, at the root.** `"Writes a bun.lock lockfile to the project root."` (https://bun.com/docs/pm/cli/install). Both the workspaces page's file tree and the catalogs page show a single root `bun.lock`. Verified: `find . -name "bun.lock*" -not -path "*/node_modules/*"` in a 3-package monorepo returned only `./bun.lock`. Docs are silent on per-package lockfiles; no mechanism exists.

**Catalogs are current guidance.** `"When many packages need the same dependency versions, define those versions once in a catalog in the root package.json and reference them from your workspaces with the catalog: protocol."` (https://bun.com/docs/pm/workspaces). `"catalog: references work in dependencies, devDependencies, optionalDependencies, peerDependencies, and as the value of a root overrides rule."` Singular `catalog` is referenced as `catalog:`; plural named catalogs as `"catalog:testing"` (https://bun.com/docs/pm/catalogs). `bun install --help` exposes `--catalog=<val>  Add the resolved version to the root package.json catalog and depend on it as "catalog:" (use --catalog=NAME for a named catalog)`.

---

## B. LOCKFILE

**Filename.** `"bun install creates a lockfile called bun.lock."` (https://bun.com/docs/pm/lockfile).

**`bun.lockb` deprecation, exact remedy.** `"To migrate an existing binary bun.lockb, run bun install --save-text-lockfile --frozen-lockfile --lockfile-only and delete bun.lockb."` (https://bun.com/docs/pm/lockfile). `"Before Bun 1.2, the lockfile was binary and called bun.lockb."` and `"In 1.2.0+ it is the default format for new projects."` (https://bun.com/docs/pm/cli/install, https://bun.com/docs/guides/install/git-diff-bun-lockfile). Binary help still carries `--save-text-lockfile  Save a text-based lockfile` and bunfig default `saveTextLockfile = true`.

**Commit it. The answer is one word.** `"#### Should it be committed to git? / Yes"` (https://bun.com/docs/pm/lockfile).

**Frozen/CI install. `--frozen-lockfile` is still current — not renamed, not deprecated, no `--no-save` alias.** `bun install --help` prints `--frozen-lockfile  Disallow changes to lockfile` and separately `--no-save  Don't update package.json or save a lockfile`. Docs: `"For reproducible installs, use --frozen-lockfile. Bun installs the exact versions specified in the lockfile and does not update it. If your package.json disagrees with bun.lock, Bun exits with an error."` (https://bun.com/docs/pm/cli/install).

Also current: `"Bun does not enable --frozen-lockfile automatically in CI; pass the flag or use bun ci."` and `"bun ci is equivalent to bun install --frozen-lockfile."` (https://bun.com/docs/pm/cli/install). Verified: with `is-even` added to package.json but not the lockfile, `bun ci` → `error: lockfile had changes, but lockfile is frozen / note: try re-running without --frozen-lockfile and commit the updated lockfile`, exit 1; `bun install --frozen-lockfile` printed identical output. `bun ci` is NOT listed in `bun --help` top-level commands but works.

**`bun pm migrate`.** Docs give one sentence: `"To migrate another package manager's lockfile without installing anything: / bun pm migrate"` (https://bun.com/docs/pm/cli/pm). `bun pm migrate --help` prints the generic `bun pm` menu — the subcommand has no dedicated help.

- Scope exists for all three: `"When you run bun install in a project without a bun.lock, Bun automatically migrates existing lockfiles: yarn.lock (v1), package-lock.json (npm, lockfileVersion 2, 3 or 4), pnpm-lock.yaml (pnpm)"`. Exception: `"Bun does not migrate a package-lock.json from npm 6 or older (lockfileVersion 1); it prints a warning and resolves from package.json instead."` (https://bun.com/docs/pm/lockfile).
- **It does NOT delete the old lockfile.** `"Bun preserves the original lockfile. You can remove it manually after verification."` (https://bun.com/docs/pm/lockfile). Verified: after `bun pm migrate`, `package-lock.json` still present alongside the new `bun.lock`; no `node_modules` created.
- Verified behavior: first `bun pm migrate` → `[0.52ms] migrated lockfile from package-lock.json`. Second run → `error: bun.lock already exists / run with --force to overwrite`. `--force` is undocumented in both help and docs but works.
- pnpm migration is richer than the one-liner suggests: `"Converts pnpm-lock.yaml (lockfile versions 7–9, including pnpm 11's multi-document files) to bun.lock"`, `"Resolves pnpm named registries (name@registry:version) via namedRegistries in pnpm-workspace.yaml"`, and it moves `pnpm-workspace.yaml` `packages`/`catalog`/`catalogs` into root package.json `workspaces`. `"Migration only runs when bun.lock is absent. There is currently no opt-out flag for pnpm migration."` (https://bun.com/docs/pm/cli/install).

---

## C. INSTALL BEHAVIOR AND SECURITY

**Lifecycle scripts are OFF by default for dependencies.** `"Because running arbitrary code is a security risk, Bun does not execute arbitrary lifecycle scripts by default, unlike other npm clients."` (https://bun.com/docs/pm/lifecycle). The project's own scripts still run: `"**Runs** your project's {pre|post}install and {pre|post}prepare scripts at the appropriate time. For security reasons Bun does not execute lifecycle scripts of installed dependencies unless they are trusted."` (https://bun.com/docs/pm/cli/install).

**This DOES break packages that need postinstall, and Bun says so at install time.** Verified: installing `core-js@3.38.1` printed `Blocked 1 postinstall. Run bun pm untrusted for details.` `bun pm untrusted` showed `» [postinstall]: node -e "try{require('./postinstall')}catch(e){}"` and `"These dependencies had their lifecycle scripts blocked during install."`

**Mechanism.** `"To allow lifecycle scripts for a particular package, add its name to the trustedDependencies array in your package.json."` (https://bun.com/docs/pm/lifecycle). Critical nuance, quoted in full: `"Defining trustedDependencies in package.json replaces the default list rather than extending it."` Three modes —
| `package.json` | Packages allowed to run lifecycle scripts |
| --- | --- |
| `trustedDependencies` omitted | The packages in Bun's built-in list (npm sources only). |
| `trustedDependencies: ["pkg-a", ...]` | **Only** the listed packages. The default list is ignored. |
| `trustedDependencies: []` | **No** packages, including none from the default list. |
(https://bun.com/docs/pm/lifecycle)

A curated default allow list exists: `"A curated list of popular npm packages with lifecycle scripts is allowed by default."` Verified via `bun pm default-trusted` → `Default trusted dependencies (367):` (367 entries; `core-js` is not one of them). Also: `"The default trusted dependencies list only applies to packages installed from npm. For packages from other sources (such as file:, link:, git:, or github: dependencies), you must explicitly add them to trustedDependencies."` (https://bun.com/docs/pm/lifecycle).

Binaries: `--ignore-scripts  Skip lifecycle scripts in the project's package.json (dependency scripts are never run)`; `--trust  Add to trustedDependencies in the project's package.json and install the package(s)`; `--concurrent-scripts=<val>  Maximum number of concurrent jobs for lifecycle scripts (default: 2x CPU cores)` (all `bun install --help`).

**`engines` is ignored. Docs are SILENT; behavior is confirmed empirically.** The only `engines` hit in the whole 2.1 MB corpus is a third-party deploy guide: `"Railpack detects Bun from your bun.lock and installs the latest version of Bun unless you pin one with the engines.bun or packageManager field in package.json."` (https://bun.com/docs/guides/deployment/railway). No `engines` setting exists in `bunfig.toml` (`install.*` key list at https://bun.com/docs/runtime/bunfig contains none).

Verified: `{"engines": {"node": ">=99.0.0", "bun": ">=0.0.1"}}` → `bun install` succeeded, `2 packages installed [127.00ms]`, exit 0, no warning. Repeating with `engines.bun: ">=99.0.0"` plus `.npmrc` containing `engine-strict=true` → still exit 0, no warning. `bun pm pkg fix` left `engines` untouched. Bun has no `engine-strict` equivalent that is documented or effective here.

**peerDependencies behave like Yarn, not npm.** `"Bun handles peer dependencies like Yarn: bun install installs them automatically. If the dependency is marked optional in peerDependenciesMeta, Bun uses an existing dependency if possible."` (https://bun.com/docs/pm/cli/install). Reinforced: `"**Installs** all dependencies, devDependencies, and optionalDependencies. Bun installs peerDependencies by default."` Auto-install is also a runtime behavior: `"Under Bun-style module resolution, Bun auto-installs every imported package on the fly into a global module cache during execution."` (https://bun.com/docs/runtime/auto-install). Bunfig key `[install] peer = true # whether to install peerDependencies` (https://bun.com/docs/runtime/bunfig).

**`minimumReleaseAge` exists and is current.** `"To protect against supply chain attacks where malicious packages are quickly published, you can configure a minimum age requirement for npm packages. Bun filters out package versions published more recently than the specified threshold (in seconds) during installation."` (https://bun.com/docs/pm/cli/install). Exact keys:

```toml
[install]
minimumReleaseAge = 259200 # seconds
minimumReleaseAgeExcludes = ["@types/node", "typescript"]
```
Bunfig reference: `"### install.minimumReleaseAge"` / `"### install.minimumReleaseAgeExcludes"` — `"An array of package names that are exempt from the minimumReleaseAge check. Default []."` (https://bun.com/docs/runtime/bunfig). Semantics: `"It only affects new package resolution; existing packages in bun.lock remain unchanged"`, `"Bun filters all dependencies (direct and transitive) to meet the age requirement when resolving them"`, and a stability check that `"searches up to 7 days past the age gate"`. CLI form: `bun add @types/bun --minimum-release-age 259200 # seconds`. Binary flag: `--minimum-release-age=<val>  Only install packages published at least N seconds ago (security feature)`.

**`linker` — default is NOT unconditionally hoisted.** `bun install --help`: `--linker=<val>  Linker strategy (one of "isolated" or "hoisted")`. Docs: `"Isolated installs are the default for new workspace/monorepo projects (with configVersion = 1 in the lockfile). Existing projects continue using hoisted installs unless explicitly configured."` (https://bun.com/docs/pm/isolated-installs). Full default table:
| `configVersion` | Using workspaces? | Default Linker |
| --- | --- | --- |
| `1` | ✅ | `isolated` |
| `1` | ❌ | `hoisted` |
| `0` | ✅ | `hoisted` |
| `0` | ❌ | `hoisted` |
(https://bun.com/docs/pm/isolated-installs)

`"**Migrations from other package managers**: From pnpm: configVersion = 1 (using isolated installs in workspaces). From npm or yarn: configVersion = 0 (using hoisted installs)."` (https://bun.com/docs/pm/isolated-installs). Verified: a fresh `workspaces` monorepo got `"configVersion": 1` in `bun.lock`. Rationale: `"prevents phantom dependencies (packages importing dependencies they never declared)"`. Escape hatches: `[install] linker = "hoisted"` (bunfig), `--linker hoisted` (CLI), `node-linker=hoisted` / `install-strategy=hoisted` (`.npmrc`) (https://bun.com/docs/pm/npmrc).

**`overrides` and `resolutions` — both supported.** `"Bun supports npm's "overrides" and Yarn's "resolutions" in package.json."` (https://bun.com/docs/pm/overrides). Exact key is the top-level `"overrides"` (npm) or `"resolutions"` (Yarn): `{ "overrides": { "bar": "~4.4.0" } }`. Constraint: `"Bun only reads overrides from the root package.json, not from workspace packages. Overrides apply to peerDependencies as well."` (https://bun.com/docs/pm/overrides). Values accept any specifier: `"npm:"`, `"catalog:"`, or `"$name"` to reuse a declared range (https://bun.com/docs/pm/overrides).

---

## D. RUNNING SCRIPTS AND RUNTIME

**What executes a script.** `"Bun executes the script command in a subshell. On Linux & macOS, it checks for the following shells in order, using the first one it finds: bash, sh, zsh. On Windows, it uses the Bun Shell."` (https://bun.com/docs/runtime/index). Bun's own runtime executes the script only where a script invokes `bun`; bare `node` in a script string runs whatever `node` resolves to. `"You can also run scripts with the shorter command bun <script>. If a built-in bun command has the same name, the built-in command takes precedence; use the explicit bun run <script>."` (https://bun.com/docs/runtime/index).

**`--bun` semantics, exact quote.** `"If the package references node in the #!/usr/bin/env node shebang, bun run respects it by default and uses the system's node executable. To force it to use Bun instead, pass --bun to bun run."` and `"When you pass --bun, Bun creates a symlink to the locally-installed Bun executable named "node" in a temporary directory and adds it to your PATH for the duration of the script."` (https://bun.com/docs/guides/install/from-npm-install-to-bun-install). Second source: `"When you pass --bun, Bun prepends $PATH with a node symlink that points to the bun binary… A script that runs node runs bun instead, with no changes to the script. This works recursively… The alias also applies to shebangs that point to node."` (https://bun.com/docs/runtime/bunfig).

So yes, `--bun` rewrites `node` in script strings, but via a PATH symlink, not by editing the string.

**THE BIG ONE — the alias is on by default when `node` is absent.** `"By default, this is enabled if node is not already in your $PATH."` (https://bun.com/docs/runtime/bunfig). Bunfig key `[run] bun = true  # equivalent to bun --bun for all bun run commands`.

Verified on this machine (node IS in PATH at `/Users/josh-desktop/.local/share/mise/installs/node/24.20.0/bin/node`):
- `bun run bare` (script `node -e "console.log(process.isBun ? 'BUN' : 'NODE')"`) → `NODE`.
- `bun run whichnode` → `/Users/josh-desktop/.local/share/mise/installs/node/24.20.0/bin/node`.
- `bun --bun run bare` → `BUN`; `bun run --bun bare` → `BUN`.
- `bunx --bun which node` → `/private/tmp/bun-node-744846f84/node`.

Flag forms all valid per docs: `bun --bun run dev`, `bun --bun dev`, `bun run --bun dev` (https://bun.com/docs/runtime/bunfig). Binary help: `-b, --bun  Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)`.

**`bun run node somefile.mjs`.** Works unchanged with the system node (verified, `NODE`). With `--bun` it resolves through the PATH symlink and runs on Bun. Practical consequence: `bun run` alone is NOT a runtime migration.

**Scripts use bare commands, not `bun run` prefixes.** Docs example: `{ "scripts": { "clean": "rm -rf dist && echo 'Done.'", "dev": "bun server.ts" } }` (https://bun.com/docs/runtime/index). The `bun run` prefixes in framework guides are the separate `--bun` concern (e.g. `"dev": "bun --bun next dev"` from https://bun.com/docs/guides/ecosystem/nextjs).

**bunx.** `"Use bunx to auto-install and run packages from npm. It's Bun's equivalent of npx or yarn dlx."` and `"As with npx, bunx checks for a locally installed package first, then falls back to auto-installing it from npm."` (https://bun.com/docs/pm/bunx). `"bunx is an alias for bun x."` Flag ordering matters: `"The --bun flag must occur before the executable name… bunx --bun my-cli # good / bunx my-cli --bun # bad"`. Also `--package <pkg>` / `-p <pkg>` for a binary whose name differs from its package (https://bun.com/docs/pm/bunx). `bun --help` maps `npx <package>` → `bunx <package>` and `npm exec <bin>` → `bun <bin>`.

**`packageManager` field / corepack equivalent. UNCONFIRMED.** The corpus has exactly one `packageManager` hit, in a third-party Railway deploy guide (https://bun.com/docs/guides/deployment/railway). There is no corepack-equivalent anywhere in the docs, and the string `corepack` does not appear in `/tmp/bun-llms-full.txt`. Not tested against the binary. No evidence Bun reads or honors `packageManager` for self-versioning.

**Vitest under Bun. Amber/"silent".** There is NO official page on running vitest. The corpus has no `from-vitest` guide (only `docs/guides/test/migrate-from-jest` exists in the URL index). The two real mentions:
- `"For added compatibility with tests written for Vitest, Bun provides the vi object as an alias for parts of the Jest mocking API"` — available members are exactly `vi.fn`, `vi.spyOn`, `vi.mock`, `vi.restoreAllMocks`, `vi.resetAllMocks`, `vi.clearAllMocks` (https://bun.com/docs/test/mocks). This is `bun:test` compatibility, not vitest-under-Bun guidance.
- A benchmark table comparing `bun test` against `vitest run`, `vitest run --no-isolate`, `vitest run --no-isolate --no-file-parallelism` on 2 000 TypeScript files (https://bun.com/docs/test/parallel). That is a benchmark, not a support statement.
No caveats, required config, or known incompatibilities for vitest-under-Bun are documented. Mark UNCONFIRMED.

**Coverage and reporters.** `"Bun's test runner has built-in code coverage reporting. Use it to see how much of your codebase your tests cover"`, flags `bun test --coverage`, `--coverage-reporter=lcov`, `--coverage-dir`. `"To save a report for CI or other tools, pass --coverage-reporter=lcov on the command line or set coverageReporter in bunfig.toml."` Reporters table: `text` = `"Prints a text summary of the coverage to the console"`, `lcov` = `"Save coverage in lcov format"` (https://bun.com/docs/test/code-coverage). Binary (`bun test --help`) matches:
```
      --coverage                      Generate a coverage profile
      --coverage-reporter=<val>       Report coverage in 'text' and/or 'lcov'. Defaults to 'text'.
      --coverage-dir=<val>            Directory for coverage files. Defaults to 'coverage'.
```
Thresholds: `"coverageThreshold = { lines = 0.9, functions = 0.9, statements = 0.9 }"` / `"Setting any of these thresholds causes the test run to fail if coverage is below the threshold."` (https://bun.com/docs/test/code-coverage).

---

## E. CI

**Action and pin.** `"Use the official setup-bun GitHub Action to install bun in your GitHub Actions runner."` with `- uses: oven-sh/setup-bun@v2` (https://bun.com/docs/guides/install/cicd). The install guide uses the same: `"Use the official oven-sh/setup-bun action"` (https://bun.com/docs/pm/cli/install). Version pinning is opt-in: `with: # bun-version: "latest" # or "canary"`. `"See the setup-bun README"` for other values (https://bun.com/docs/guides/install/cicd). The docs do not recommend an exact semver pin; pinning `bun-version: 1.4.2` is what the docs' generic instruction implies, but no docs sentence prescribes a specific version number. UNCONFIRMED as a documented recommendation.

**Reproducible install command.** `"In your workflow, run bun ci instead of bun install"` (https://bun.com/docs/pm/cli/install). And `"To use bun ci or bun install --frozen-lockfile, you must commit bun.lock to version control."` (https://bun.com/docs/pm/cli/install). Either `bun ci` or `bun install --frozen-lockfile` is correct; both verified to behave identically. The CI guide itself still shows plain `bun install` in its first snippet and does not mention `bun ci` (https://bun.com/docs/guides/install/cicd) — the reproducible-install guidance lives in the install CLI page.

---

## F. GOTCHAS vs npm

1. **`.npmrc` is supported, partially.** `"Bun loads configuration options from .npmrc files, so you can reuse your existing registry and scope configuration."` (https://bun.com/docs/pm/npmrc). Precedence: `~/.npmrc` → `./.npmrc` → `bunfig.toml` (global then project) → `NPM_CONFIG_REGISTRY`/`NPM_CONFIG_TOKEN` → CLI flags. Documented keys: `registry`, `@<scope>:registry`, `_authToken`, `username`, `_password`, `_auth`, `email`, `link-workspace-packages`, `save-exact`, `ignore-scripts`, `dry-run`, `cache`, `ca`, `cafile`, `omit`, `include`, `install-strategy`, `node-linker`, `public-hoist-pattern`, `hoist-pattern`, `hoist` (https://bun.com/docs/pm/npmrc). Bun also recommends leaving it: `"We recommend migrating your .npmrc file to Bun's bunfig.toml format, which supports more options"` (https://bun.com/docs/pm/npmrc). Docs are SILENT on a complete unsupported-key list; there is no `engine-strict` handling (verified ineffective).
2. **`npm_config_*` env vars are largely unsupported.** Only two are documented anywhere: `NPM_CONFIG_REGISTRY` and `NPM_CONFIG_TOKEN` (https://bun.com/docs/pm/npmrc). Lowercase `npm_config_<key>` forms appear zero times in the corpus. Treat any other `npm_config_*` as UNCONFIRMED/unsupported.
3. **`NODE_ENV`.** Not used to gate install behavior. `"Your bunfig.toml can reference environment variables. bun install automatically loads environment variables from .env.production.local, .env.local, .env.production, and .env, regardless of NODE_ENV. It does not read .env.development or .env.test."` (https://bun.com/docs/pm/cli/install, repeated at https://bun.com/docs/runtime/bunfig). `--production` is a separate flag, not `NODE_ENV`-driven. Separately, `NODE_ENV=production` changes the jsx transform choice in the bundler (https://bun.com/docs/bundler/esbuild).
4. **`--prefix` unsupported.** Verified error, see section A. Use `--cwd` or `--filter`.
5. **Workspace filter DOES run in dependency order.** `"Bun respects package dependency order when running scripts. Say you have a package foo that depends on another package bar in your workspace, and both have a build script. When you run bun --filter '*' build, foo only starts once bar is done."` (https://bun.com/docs/pm/filter). Also `"bun --filter 'web...' build # build web and everything it depends on, in dependency order"`. Verified: `pkg-b ... Exited with code 0` printed before `pkg-a noisy: LINE-1`. Caveat: siblings at the same graph level run in parallel (`"Both scripts run in parallel"`), and `--parallel`/`--sequential` override that.
6. **`bun run --help` and the bunfig docs CONTRADICT each other on `--elide-lines`.** Binary says `--elide-lines=<val>  Number of lines of script output shown when using --filter (default: 0, show all lines)`; bunfig says `"The number of lines of script output shown per script when using --filter. Default 10. Set to 0 to show all lines."` (https://bun.com/docs/runtime/bunfig). The binary is correct: verified a 15-line script under `--filter '*'` printed all 16 lines (15 + exit line). Trust `--help`.
7. **`bun ci` and `bun pm migrate --force` are undocumented-but-real.** Neither appears in `bun --help` or `bun pm --help`; both work (verified). `bun pm migrate` also refuses to run when `bun.lock` exists without `--force`.
8. **Peer deps and optional deps install by default.** npm's peer-dep warnings become silent auto-installs. Bunfig `[install] peer = true` default.
9. **`trustedDependencies` replaces, never extends, the default allow list.** A single added entry silently untrusts `sharp`, `esbuild`, and the other 366 defaults. Verified with the 367-entry default list.
10. **Scripts run through a subshell using `bash`/`sh`/`zsh` on macOS/Linux, Bun Shell on Windows.** Shell-specific npm script syntax differences on Windows are a real migration hazard.
11. **Isolated linking is the default for new monorepos.** Phantom imports that worked under npm fail under `configVersion = 1` + isolated. Migrating with `bun install` from npm yields `configVersion = 0` (hoisted), so a fresh clone of the same repo can behave differently from a migrated one.
12. **`bun install` auto-migrates on first run, and there is no opt-out for pnpm.** `"There is currently no opt-out flag for pnpm migration."` (https://bun.com/docs/pm/cli/install).

---

## UNCONFIRMED items and why

- **`engines` enforcement** — docs silent; empirically ignored, no warning, `engine-strict=true` ineffective. Not stated as a design decision anywhere.
- **`packageManager` field honored by Bun** — no docs mention except a third-party deploy guide; no corepack equivalent in the corpus.
- **Vitest under Bun** — no official guide. Only `vi.*` alias support inside `bun:test` and a benchmark table.
- **`.npmrc` unsupported-key list** — docs enumerate supported keys but never publish the complement.
- **`npm_config_*` lowercase env vars** — only `NPM_CONFIG_REGISTRY` and `NPM_CONFIG_TOKEN` documented; everything else unverified.
- **Exact `setup-bun` version pin** — docs show `@v2` and `bun-version: "latest" | "canary"`; no prescribed semver.
- **`bun pm pack` workspace behavior** — `bun pm --help` prints `create a tarball of the current workspace` and it accepts `--destination`/`--filename`/`--ignore-scripts`/`--gzip-level`/`--quiet`, but no docs page describes monorepo semantics; not exercised here.
