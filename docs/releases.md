# npm Package Releases and Publishing

This file governs agents working at this repository root and in its npm packages. Its purpose is to make release preparation reproducible, publication secure, and results verifiable. Follow the repository's actual `package.json`, lockfile, CI configuration, and any more-specific `AGENTS.md`; do not invent a package name, release system, registry, or workflow.

**Documentation baseline:** official npm documentation reviewed **2026-11-21**; npm CLI **v12.2.3** was listed as latest. Check the linked npm documentation again before modifying publishing infrastructure, because authentication and publishing rules change. Commands below use npm's documented syntax; explanations and agent policy are project instructions, not copied npm documentation.

**Authority boundary:** You may inspect files, prepare changes, and run local checks. **Do not** publish or stage a package, approve/reject a staged version, move a dist-tag, push a release tag, modify npm account/package settings, rotate/revoke credentials, or delete/unpublish a release without explicit authorization for that action. A successful dry run is not authorization. Never claim a release succeeded without registry evidence.

## This repository

- `.github/workflows/release.yml` publishes non-private `extensions/*/package.json` and `extensions/no-ceilings/*/package.json` packages via OIDC-only direct `npm publish` on a push to `main` that touches `extensions/**` or the workflow file, and on `workflow_dispatch`.
- Configure each package's **Trusted Publisher** on npmjs.com with GitHub Actions, owner `just-joshn`, repository `pi-customizations`, workflow filename `release.yml`, no environment, and **direct publish** permission enabled.
- Scoped `@justjoshn/*` packages must set `"publishConfig": { "access": "public" }` in `package.json`, because `release.yml` runs `npm publish` without `--access`.
- New packages are skipped by `release.yml` until bootstrapped: complete an authorized initial interactive publish on npm, configure the Trusted Publisher, then merge future version bumps to `main`.

## Releases

### 1. Establish release scope

1. Identify the intended package directory, package name, current version, target registry, visibility, and whether the project uses Bun/npm workspaces. The repository root may be private even when individual workspace packages are published.
2. Inspect the relevant `package.json` (`name`, `version`, `private`, `scripts`, `repository`, `files`, `publishConfig`), `bun.lock`, `.npmrc` without disclosing credentials, and any existing release automation. Respect `publishConfig.registry`, `publishConfig.access`, and `publishConfig.tag` where configured.
3. Check the working tree and toolchain:

   ```sh
   git status --short
   bun --version
   node --version
   npm --version
   npm config get registry --workspaces=false
   npm pkg get name version private scripts repository publishConfig
   ```

4. Confirm the desired next semantic version and channel. Do not assume that a Git tag is an npm release. Each `name@version` can be published only once; a staged version also reserves that version.

### 2. Validate the release candidate

Install dependencies from the **workspace root** using `bun.lock`, then run validation in the **package root**:

```sh
bun install --frozen-lockfile   # at workspace root, matching bun.lock
bun run --if-present typecheck
bun run --if-present build
bun run test                    # only when package.json defines "test" (bun run --if-present test falls back to /bin/test)
npm pack --dry-run
```

- For a new package or workspace without a lockfile, use `bun install` to establish and commit `bun.lock` before relying on `bun install --frozen-lockfile`.
- Inspect lifecycle scripts before running pack, publish dry runs, or version commands; these commands may execute project scripts with side effects.
- Review the resulting pack list for expected entry points, generated output, license/README, accidental secrets, and unnecessary files. Stop if tests, build, version, registry, or packed contents are wrong. Do not treat a missing test script as a passing test.
- Check that the proposed version is not already published or staged. For existing versions, inspect the registry with `npm view` and any pending stages with an appropriately authenticated `npm stage list`.

### 3. Prepare version and release metadata

- Use the repository's existing release tooling if present; otherwise pass `--no-workspaces-update` with npm's version commands, for example `npm version patch --no-workspaces-update`, `npm version minor --no-workspaces-update`, `npm version major --no-workspaces-update`, or `npm version prerelease --preid=beta --no-workspaces-update`, **only after the release type is authorized**. (`--no-workspaces-update` avoids npm Arborist crashing on `node_modules/.bun/` symlinks in Bun workspaces.)
- `npm version` updates the package version; in Git repositories it normally creates a commit and tag and runs any `preversion`, `version`, and `postversion` scripts. Inspect these first: a `postversion` script can push remotely. Do not run a version script that would perform an unauthorized external action.
- Keep changelogs, documentation, package contents, lockfile, version commit, and release tag consistent with the project's established process.
- The default distribution tag is `latest`. For a prerelease use an explicit non-`latest` tag, such as `--tag next` or `--tag beta`, and confirm the chosen tag before staging or publishing.
- After bumping to the unpublished candidate version, run `npm publish --dry-run` in the package root to verify the candidate against the registry before staging or publishing.

### 4. Choose one authorized publication path

**Preferred: staged publishing, with maintainer approval** (requires npm CLI `>=11.15.0`, Node.js `>=22.14.0`):

```sh
npm stage publish                         # package root; mutates npm registry
npm stage publish --tag next              # example prerelease channel
npm stage publish --access public         # explicit first scoped public release
```

After staging, a **human maintainer** reviews the actual staged package via npmjs.com or an interactive npm session:

```sh
npm stage list '<package-name>'
npm stage view '<stage-id>'
npm stage download '<stage-id>'
npm stage approve '<stage-id>'              # publishes to registry; requires 2FA
```

- Staging is **not** a completed release. Approval requires an interactive 2FA challenge; CI OIDC credentials cannot approve stages. Rejection also requires approval/authorization from the responsible maintainer.
- Do not stage from the monorepo root accidentally. The `npm stage` command's CLI documentation says it is unaware of workspaces; operate from the intended package directory.
- Staging a new package may create a publicly visible `0.0.0-stage` placeholder, even though the actual staged contents are not yet public. Obtain authorization before creating that placeholder.

**Alternative: direct publish**, only when explicitly approved and permitted by the package's publishing access policy:

```sh
npm publish                               # package root; mutates npm registry
npm publish --access public               # explicit first scoped public release
npm publish --tag next                    # example prerelease channel
```

Do not run both publication paths for the same version. Do not bypass failed checks with `--force`, change package visibility silently, or use `npm unpublish` as a routine rollback.

### 5. Verify and report

After **direct publication or staged approval** (not merely staging), verify the exact version and distribution tags:

```sh
npm view '<package-name>@<version>' version
npm dist-tag ls '<package-name>'
```

Report package, version, registry, dist-tag, verification result, CI run or source commit if known, and provenance status if applicable. Dist-tag changes (`npm dist-tag add/rm`) are separate registry mutations and require authorization; under OIDC they require independently enabled dist-tag permission.

## Publish Authentication

### Preferred: OIDC trusted publishing

- Favor **trusted publishing** over long-lived npm publishing tokens. Supported providers in npm's documentation are GitHub Actions on GitHub-hosted runners, GitLab.com shared runners, and CircleCI cloud. Self-hosted runners are not supported. Trusted publishing requires npm CLI `>=11.5.1` and Node.js `>=22.14.0`.
- Configure the package's **Trusted Publisher** in its settings on npmjs.com, matching the provider's project identity and workflow precisely. For GitHub Actions, enter the **filename only** (for example, `publish.yml`, not `.github/workflows/publish.yml`); the workflow itself must exist in `.github/workflows/`. If a GitHub environment is configured, its name must also match. `repository.url` in `package.json` must match the GitHub repository.
- For GitHub Actions, the documented critical permission is `id-token: write`; also use `contents: read`. In the release workflow use a supported Node/npm and Bun toolchain, `actions/setup-node` **without** `registry-url` (setting `registry-url` causes `actions/setup-node` to write `_authToken=${NODE_AUTH_TOKEN}` into `.npmrc`, which makes npm skip OIDC and fail with HTTP 404 when no token is set), and **disable package-manager caching for release builds** (`package-manager-cache: false`). Install with `bun install --frozen-lockfile`, run `bun run --if-present typecheck`, `bun run --if-present build`, and `bun run test` (when `package.json` defines `"test"`), then call the approved `npm stage publish` or `npm publish`. Never add a write token merely to make OIDC publishing work.
- For GitLab CI/CD, configure `id_tokens` with npm audience **`npm:registry.npmjs.org`** and use a GitLab.com shared runner. For CircleCI, supply `NPM_ID_TOKEN` from CircleCI's OIDC mechanism; CircleCI provenance is not supported.
- A newly created trusted publisher must complete its **first successful publish within 2 days** to validate the configuration; if it expires, delete the expired connection and create a new one. These settings are not verified on save.
- Trusted-publisher permissions are independent: `npm stage publish` is allowed, while direct `npm publish` and `npm dist-tag` require their respective permissions. For dist-tags over OIDC, npm requires CLI `>=12.2.0` or `>=11.21.0` (on those respective major lines). This repository's `release.yml` uses direct `npm publish`, so its trust entries enable **publish**; for automation outside this repository, prefer **stage-only**.
- OIDC authenticates supported publish/stage and authorized dist-tag operations. It does **not** authenticate `npm install`, `npm view`, `npm access`, or interactive staged approvals. **`npm whoami` does not test OIDC publishing authorization.**
- For public packages published from public repositories via GitHub Actions or GitLab CI/CD trusted publishing, npm automatically generates provenance; `--provenance` is unnecessary. Do not promise provenance for private source repositories or CircleCI.

### Interactive and fallback authentication

- For a maintainer-driven initial publish, use an interactive `npm login` with an npm account that has the required package permissions and 2FA. npm requires 2FA or qualifying authorized publishing credentials for package creation/publishing.
- If trusted publishing is unavailable, use the narrowest suitable **granular access token**, preferably **read-and-write (stage only)** for automated staging. A stage-only token cannot directly publish a version (`E_STAGE_REQUIRED`); a maintainer must approve the stage with 2FA.
- Use **read-only granular tokens** exclusively when CI must install private npm dependencies. Trusted publishing does not replace authentication for fetching private dependencies.
- Never log, paste, commit, hardcode, or print npm access tokens, OTPs, or credential-bearing `.npmrc` contents. Only use the platform's secret store when a token is unavoidable. Legacy tokens were removed in November 2025; npm documents that direct publishing of new versions via granular tokens will be removed in **January 2027**.
- After **verifying** trusted publishing works, recommend package-level **“Require two-factor authentication and disallow tokens”** and retirement of unnecessary write tokens; changing these settings or revoking credentials requires authorization.

## Set up a new package

1. Establish the owner/scope, package name, registry, intended visibility (public or restricted), repository URL, release owner, and whether this is a standalone package or a new npm workspace. Do not substitute example names for real values.
2. From the new package directory, initialize the metadata:

   ```sh
   npm init                              # unscoped package
   npm init --scope=@my-org              # scoped package; replace the example scope
   ```

   For a new package within an existing npm-workspaces project, the documented `npm init -w packages/<name>` can create the workspace and update the root `workspaces` property; inspect the actual workspace layout first.
3. Supply a useful `README`, appropriate `LICENSE` or license metadata, correct `name` and `version`, `repository`, entry points (`main`/`exports`/`bin` as applicable), dependencies, test/build scripts, and appropriate `files` selection. Ensure generated files exist **before** packing. Set `publishConfig` deliberately if the access, registry, or tag should be constrained.
4. Confirm `"private": true` is **not** set on a package meant for publication: npm refuses to publish a package with that field. Preserve it on any root/workspace that must remain unpublished. A **restricted registry package** is different from `"private": true` in `package.json`.
5. Run `bun install` if establishing dependencies and `bun.lock`, test installation of the local package as applicable, and run `npm pack --dry-run`. Review file selection and secrets before doing anything registry-mutating.
6. For a **new public scoped** package, explicitly publish with `npm publish --access public` or stage with `npm stage publish --access public`, only when authorized. For a restricted package, verify the registry/account supports that access and specify its policy deliberately. Unscoped packages cannot be restricted.
7. A package must exist on npm before its trusted-publisher relationship can be configured. Complete the approved initial publish or stage/approval workflow, then configure OIDC for subsequent releases. Do not trigger CI publishing until its trusted-publisher mapping is verified.

## How it works

- **Version:** `npm version` updates package metadata and may create a Git commit/tag and run lifecycle scripts. A Git tag is source control state, not proof of a registry publication.
- **Pack:** npm builds the publishable tarball from `package.json` and file-selection rules. `npm pack --dry-run` shows what would be included. The `files` field controls inclusion; `.npmignore` is used in preference to `.gitignore` when both exist; some files are always included or excluded. A successful build does not guarantee correct tarball contents.
- **Publish:** `npm publish` makes a new `name@version` available in the configured registry and assigns a dist-tag (`latest` unless explicitly set). Published `name@version` pairs cannot be reused, even after unpublishing.
- **Stage:** `npm stage publish` submits a version for inspection instead of making that version available for installation. A separately authorized maintainer uses 2FA to approve it; the approval is what makes that version live. A staged version reserves its version number.
- **Trusted identity:** OIDC lets npm verify a registered CI workflow and issue short-lived publishing credentials rather than relying on a persistent secret. Its permissions govern staging, direct publication, and dist-tag management separately.
- **Provenance:** On supported public-source/public-package trusted-publishing paths, npm links the package to its CI source/build through attestations; provenance is evidence of origin, **not** a guarantee that code is safe.
- **Release evidence:** A green CI run, successful dry run, staged submission, live package version, correct dist-tag, and provenance attestation are distinct states. Report only those you actually checked.

## Troubleshooting

| Symptom | Investigate before changing anything |
| --- | --- |
| `ENEEDAUTH` / “Unable to authenticate” in OIDC CI | Compare the npm trusted-publisher organization, repository, **exact case-sensitive workflow filename**, environment, and provider; check hosted runner and npm/Node minimum versions. For GitHub check `id-token: write` and matching `repository.url`. For `workflow_call`/`workflow_dispatch`, inspect the **calling** workflow identity and OIDC permissions in parent and child. For GitLab check `id_tokens` audience `npm:registry.npmjs.org`; for CircleCI check configured IDs and OIDC token. |
| Trusted publisher previously configured but now fails | Verify that a **first successful publish** validated it within 2 days. Expired trust relationships must be deleted and recreated by an authorized maintainer. |
| 403 / OTP / publish access denied | Confirm the authenticated account or workflow has package write access, 2FA requirements, correct package settings, and permission for the **specific** command. Do not downgrade package security or enable bypass-2FA to silence an error. |
| `E_STAGE_REQUIRED` | The token is **stage only**. Run the authorized `npm stage publish` path and obtain interactive maintainer approval; do not replace it with a more privileged token. |
| Cannot approve or inspect a staged version from CI | OIDC cannot perform the interactive stage-review/approval commands. Use an authenticated maintainer's CLI or npmjs.com, with 2FA for approval/rejection. |
| Version already exists or is staged | Check published versions and pending stages; prepare a **new** valid version. Do not republish or force-overwrite an existing `name@version`. |
| Prerelease has the wrong dist-tag | Check the explicit `--tag` and package `publishConfig.tag`. Staged tags cannot be changed in place; changing a staged version's tag requires authorized rejection and re-staging. Registry dist-tag edits require separate permission and approval. |
| `bun install --frozen-lockfile` fails | Check that `bun.lock` exists, matches `package.json`, and was updated with `bun install`. Commit the updated `bun.lock` intentionally; `--frozen-lockfile` will not rewrite it. |
| Wrong files in the release tarball | Re-run `npm pack --dry-run`; inspect `files`, root/nested `.npmignore`, `.gitignore`, build outputs, and lifecycle scripts. Never fix a packlist issue by publishing first. |
| Private dependency installation fails in CI | OIDC trusted publishing does **not** authenticate installs. Add only authorized, read-only granular access for the dependency-install step. |
| Provenance is missing | Confirm GitHub Actions or GitLab CI/CD trusted publishing, a **public repository**, a **public package**, and correct `repository` metadata. CircleCI and private-source repositories do not receive automatic provenance. |
| Published version is not where expected | Check `npm config get registry --workspaces=false`, scoped registry configuration, `publishConfig.registry`, `npm view '<package-name>@<version>' version`, and `npm dist-tag ls '<package-name>'` before taking corrective action. |

When blocked, report **what was checked, the actual command/output or safe excerpt, what remains unverified, and the smallest authorized next action**. Redact secrets. Do not present an attempted command, an unverified CI result, or a staged version as a successful public release.

## Official npm documentation

- [npm publish — CLI v12](https://docs.npmjs.com/cli/v12/commands/npm-publish/)
- [npm stage — CLI v12](https://docs.npmjs.com/cli/v12/commands/npm-stage/)
- [npm version — CLI v12](https://docs.npmjs.com/cli/v12/commands/npm-version/)
- [npm pack — CLI v12](https://docs.npmjs.com/cli/v12/commands/npm-pack/)
- [bun install](https://bun.com/docs/cli/install)
- [npm init — CLI v12](https://docs.npmjs.com/cli/v12/commands/npm-init/)
- [package.json — CLI v12](https://docs.npmjs.com/cli/v12/configuring-npm/package-json/)
- [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/)
- [Staged publishing for npm packages](https://docs.npmjs.com/staged-publishing/)
- [Creating and publishing scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
- [Creating and publishing unscoped public packages](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/)
- [Requiring 2FA for package publishing and settings modification](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)
- [About access tokens](https://docs.npmjs.com/about-access-tokens/)
- [Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements/)
