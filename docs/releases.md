# Releases

Merging a version bump to `main` publishes the package.

## How it works

`.github/workflows/release.yml` runs on every push to `main` that touches `extensions/**`, and on manual dispatch.

1. For each `extensions/*/package.json` that is not `private`, it looks for the tag `<package>-v<version>`, such as `pi-google-oauth-v2-v0.1.1`.
2. Each package without that tag runs its own `typecheck` and `test` scripts, publishes to npm, and then gets the tag.
3. Packages release independently. A failed package does not block the others, gets no tag, and retries on the next run.

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers). The workflow has `id-token: write`, and npm generates [provenance](https://docs.npmjs.com/generating-provenance-statements) automatically. If the repository secret `NPM_TOKEN` is set, the workflow publishes with that token instead.

`setup-node` is configured without `registry-url` on purpose. With a registry set, it writes an `.npmrc` that reads `NODE_AUTH_TOKEN`, and npm then sends that placeholder token instead of using OIDC. The registry answers with a 404 on the publish.

## Set up a new package

A new package name does not exist on npm yet, so trusted publishing cannot cover its first publish.

1. Set the repository secret `NPM_TOKEN` to a granular access token. It needs **Read and write** on the `@justjoshn` scope and **Bypass two-factor authentication**. Without the bypass, the publish fails with `EOTP`.
2. Merge the package, or rerun `release.yml`. The package publishes with the token.
3. On the package's npm settings page, add a trusted publisher. Use GitHub Actions, repository `just-joshn/pi-customizations`, workflow `release.yml`, and no environment.
4. Delete `NPM_TOKEN` once every package has a trusted publisher.

## Troubleshooting

- `ENEEDAUTH`, or a 404 on the publish `PUT`, means the run had no publishing identity. The package is new, has no trusted publisher, or an `.npmrc` token is overriding OIDC.
- `EOTP` means `NPM_TOKEN` cannot skip two-factor authentication. Replace it with a token that has the bypass.
- A release tag for a version that is missing on npm is a false marker. Delete the tag so the next run publishes that version.
