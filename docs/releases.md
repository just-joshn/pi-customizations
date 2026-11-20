# Releases

Merging a version bump to `main` publishes the package.

## How it works

`.github/workflows/release.yml` runs on a push to `main` that changes `extensions/**` or `.github/workflows/release.yml`. It also runs on manual `workflow_dispatch`. The job runs on `macos-latest` with Node 26.13.0 and Bun 1.4.5.

1. For each `extensions/*/package.json` that is not `private`, the workflow looks for the tag `<package>-v<version>`. An example is `pi-google-oauth-v2-v0.1.5`. The tag omits the `@justjoshn/` scope.
2. If `extensions/pi-pstack-v2` has no tag, the workflow runs `brew install tmux`, because its tests need `tmux`.
3. If any package has no tag, the workflow runs `bun install --frozen-lockfile` at the workspace root.
4. For each package without a tag, the workflow runs `bun run typecheck` and `bun run test` in the package directory. It skips a script that the package's `package.json` does not define.
5. The workflow then publishes the package to npm and pushes the tag.
6. Packages release independently. A failed package does not block the others, gets no tag, and retries on the next run.

`release.yml` does not run `bun run ci`. Pull request checks run the lint and the audits.

## Publish authentication

The default path uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers). The workflow has `id-token: write`, and `npm publish` authenticates through OIDC. npm generates [provenance](https://docs.npmjs.com/generating-provenance-statements) automatically.

If the repository secret `NPM_TOKEN` is set, the workflow publishes with that token instead. It runs `npm publish --provenance --access public`, so this path also generates provenance.

The workflow does not pass `registry-url` to `setup-node`. With a registry set, `setup-node` writes an `.npmrc` that reads `NODE_AUTH_TOKEN`. npm then sends that placeholder token and skips OIDC, and the registry answers the publish with a 404.

## Set up a new package

A new package name does not exist on npm, so trusted publishing cannot cover its first publish.

1. In the package's `package.json`, set `"publishConfig": { "access": "public" }`. The OIDC publish does not pass `--access`, so a scoped package needs this setting.
2. Set the repository secret `NPM_TOKEN` to a granular access token. The token needs **Read and write** on the `@justjoshn` scope and **Bypass two-factor authentication**. Without the bypass, the publish fails with `EOTP`.
3. Merge the package, or rerun `release.yml`. The workflow publishes the package with the token.
4. On the package's npm settings page, add a trusted publisher. Use GitHub Actions, repository `just-joshn/pi-customizations`, workflow `release.yml`, and no environment.
5. Delete `NPM_TOKEN` after every package has a trusted publisher.

## Troubleshooting

- `ENEEDAUTH`, or a 404 on the publish `PUT`, means npm received no valid credentials. The package is new, the package has no trusted publisher, or an `.npmrc` token overrides OIDC.
- `EOTP` means `NPM_TOKEN` cannot skip two-factor authentication. Replace it with a token that has the bypass.
- A release tag can exist for a version that npm does not have. Delete the tag, and the next run publishes that version.
