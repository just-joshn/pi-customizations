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

Publishing uses npm's trusted publishing (OIDC) flow from
<https://docs.npmjs.com/trusted-publishers>: the workflow grants
`id-token: write`, and `npm publish` authenticates with the runner's
short-lived OIDC identity. No long-lived token exists to leak or rotate.
Provenance attestations are generated automatically
(<https://docs.npmjs.com/generating-provenance-statements>).

## One-time setup per package

For each package that already exists on npmjs.com
(`pi-anthropic-oauth`, `pi-antigravity-oauth`, `pi-pstack`, `pi-rea`,
`pi-xai-oauth`):

1. Open the package page on npmjs.com and go to Settings.
2. Find the "Trusted Publisher" section and choose the GitHub Actions button.
3. Fill in:
   - Repository: `just-joshn/pi-customizations`
   - Workflow filename: `release.yml`
   - Environment: leave empty (the workflow does not use one)
4. Save.

`@justjoshn/pi-maintainer` has never been published. Publish it once by hand
(`cd extensions/pi-maintainer && npm publish --access public`), then add its
trusted publisher as above. After that the workflow owns its releases.

Until the trusted publisher is configured for a package, `npm publish` from
the workflow fails with an authentication error by design. Nothing publishes
halfway: the tag is created only after a successful publish.

## Token fallback

If you would rather use a token, create a repository secret named
`NPM_TOKEN` (classic automation token or granular publish token). The
workflow then uses npm's documented token path,
`npm publish --provenance --access public`
(<https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages>).
Trusted publishing is still the recommended end state: tokens expire, leak,
and need rotation; the OIDC identity is workflow-bound and short-lived.

## Actions pinning

Third-party actions are pinned to full-length commit SHAs per GitHub's
security hardening guidance
(<https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>).
`release.yml` pins `actions/checkout` and `actions/setup-node` to their `v6`
tags and reuses the `oven-sh/setup-bun` SHA already audited in
`.github/workflows/pi-pstack.yml`.
