# Releases

Version bumps merged to `main` publish themselves. This page documents the
release flow and the one-time setup each package needs.

## How it works

`.github/workflows/release.yml` runs on every push to `main` that touches
`extensions/**` (and on `workflow_dispatch` for manual runs):

1. For each `extensions/*/package.json` it reads `name` and `version`, skips
   private packages, and compares against the release tag `<package>-v<version>`.
2. Packages without a matching tag run their own `typecheck` and `test`
   scripts, then publish, then get the tag. A package that already has its
   tag is never republished, so failed or partial runs resume cleanly on the
   next push.
3. Packages are released independently. One red package does not block the
   others; the run exits non-zero listing whatever failed.
4. The statechart suite stays in the pi-pstack CI workflow because it needs
   Java and a downloaded `tla2tools.jar`; release gates run each package's
   own `test` script.

Release gates run on the ARM `macos-15` runner. The tests need no Apple
tools. The workflow cross-compiles the ignored Go Mach-O fixtures, builds the
crash fixture, and then runs the tests.
`release-checks.yml` runs the same package gates on pull requests without
publishing or accessing npm credentials. Linux sandbox verification remains
in the separate pi-pstack workflow.

Publishing uses npm's trusted publishing (OIDC) flow from
<https://docs.npmjs.com/trusted-publishers>: the workflow grants
`id-token: write`, and `npm publish` authenticates with the runner's
short-lived OIDC identity. No long-lived token exists to leak or rotate.
Provenance attestations are generated automatically
(<https://docs.npmjs.com/generating-provenance-statements>).

The workflow deliberately configures setup-node without `registry-url`.
When setup-node receives a registry, it writes an `.npmrc` whose auth token
is read from `NODE_AUTH_TOKEN` and exports that variable as a literal
placeholder when it is unset, and npm then authenticates with the
placeholder instead of attempting OIDC. That interaction produced six
silent publish failures in release run 41527084422; see Troubleshooting.

## One-time setup per package

`pi-anthropic-oauth`, `pi-antigravity-oauth`, `pi-maintainer`, `pi-pstack`,
and `pi-rea` already exist on npmjs.com. `@justjoshn/pi-x-subscription-oauth`
is the rename of `@justjoshn/pi-xai-oauth`. A rename is a new npm package.
The Trusted Publisher on `pi-xai-oauth` does not cover the new name. Release
runs after that rename fail with `ENEEDAUTH` until the new package exists and
has its own Trusted Publisher (or until `NPM_TOKEN` is set for a bootstrap
publish).

### Bootstrap a new package name

1. Create a repository secret `NPM_TOKEN` from an npm **granular access
   token** with **Bypass two-factor authentication** checked and **Read and
   write (publish and stage)** on the `@justjoshn` scope (or the new
   package). Classic "Automation" tokens were removed in November 2025. A
   token without Bypass 2FA fails CI with `EOTP`. See Token fallback below.
2. Re-run `release.yml` on `main` (`workflow_dispatch`, or re-run the failed
   job). The current `package.json` version publishes and gets its git tag.
   Intermediate versions that never got a tag are skipped.
3. On the new package's npm Settings page, add a GitHub Actions Trusted
   Publisher for `just-joshn/pi-customizations` / `release.yml`.
4. Remove `NPM_TOKEN` once Trusted Publishing works, so later releases stay
   on OIDC.

### Trusted Publisher for a package that already exists

1. Open the package page on npmjs.com and go to Settings.
2. Find the "Trusted Publisher" section and choose the GitHub Actions button.
3. Fill in:
   - Repository: `just-joshn/pi-customizations`
   - Workflow filename: `release.yml`
   - Environment: leave empty (the workflow does not use one)
4. Save.

Until a package's trusted publisher is configured (and the package exists),
its publish fails with an authentication error by design. Nothing publishes
halfway: the tag is created only after a successful publish, and the run
lists the failures.

## Token fallback

If you would rather use a token, create a repository secret named
`NPM_TOKEN` from a granular access token with Bypass 2FA enabled
(<https://docs.npmjs.com/creating-and-viewing-access-tokens/>). The workflow
then appends the documented auth line to the npm userconfig and publishes
with `npm publish --provenance --access public`
(<https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages>).
A token that still demands a one-time password fails the runner with
`EOTP`. Trusted publishing is still the recommended end state: tokens
expire, leak, and need rotation; the OIDC identity is workflow-bound and
short-lived.

## Troubleshooting

**`npm error ENEEDAUTH` / `need auth`** on a package that typecheck and tests
already passed means the runner had no publishing identity. Common causes:

1. The package does not exist on npmjs.com yet (a rename creates this state).
   Use the bootstrap path above with `NPM_TOKEN`, then attach Trusted
   Publishing.
2. The package exists but has no Trusted Publisher for `release.yml`, and
   `NPM_TOKEN` is unset.
3. An `.npmrc` auth token is preempting OIDC. setup-node's `registry-url`
   input exports a placeholder `NODE_AUTH_TOKEN` that npm treats as a real
   token. This release workflow no longer sets `registry-url` for exactly
   this reason; do not add it back, and check any local `.npmrc` you might
   copy into CI.

**`npm error EOTP` / `requires a one-time password`** means `NPM_TOKEN` was
present but cannot publish non-interactively. Replace it with a granular
token that has **Bypass two-factor authentication** checked (or finish
Trusted Publishing and delete the secret so the workflow uses OIDC).
Re-running with the same 2FA-bound token fails the same way.

**`npm error 404 Not Found - PUT https://registry.npmjs.org/...`** is the
same class of failure when the registry rejects the publish as unauthorized.
Treat it like `ENEEDAUTH` and walk the list above.

**A run is green but versions did not change on npm.** This happened in
release run 41527084422: a bash `set -e` inside a subshell used as an `if`
condition is ignored, so failed publishes fell through to tag creation.
The current workflow runs each package in a plain subshell and checks the
exit code, so a failed publish can no longer reach the tag step. If you
ever see release tags for versions that are missing on npmjs.com, delete
the tags; they are false release markers.

## Actions pinning

Third-party actions are pinned to full-length commit SHAs per GitHub's
security hardening guidance
(<https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>).
`release.yml` pins `actions/checkout` and `actions/setup-node` to full SHAs
with a `# v6` comment, and reuses the `oven-sh/setup-bun` SHA already audited in
`.github/workflows/pi-pstack.yml`.
