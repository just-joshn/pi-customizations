# Changelog

## [Unreleased]

- Register the `cursor` provider beside `grok-build`. Model refresh calls Cursor `GetUsableModels`. Asks run through `cursor-agent` in ask mode.
- Keep a prompt that starts with `-` from being parsed as a `cursor-agent` flag, report a quiet non-zero exit as a process failure, and read camelCase usage from the CLI JSON.
- Refresh the catalog JWT by posting the keychain `cursor-api-key` to `/auth/exchange_user_api_key`. The stored refresh item is that same one-hour JWT, so a failed exchange asks for `/login` instead of reusing it.

## [0.1.6] - 2026-11-09

- Add `/usage`. It reads `GET /v1/billing?format=credits` and prints the weekly plan meter, the reset time, and the GrokBuild and Cursor product split when billing is unified.
- Name the Grok Build login "Grok Build (The X Subscription)". The provider still lists only Grok Build models.

## [0.1.5] - 2026-11-03

- Follow the repository Vitest rules in the test suite. Source changes are formatting and import order only.

## [0.1.4] - 2026-11-02

- Document the Pi 1.5.0 upgrade target and the native provider, authentication, model discovery, streaming, and virtual-model contracts it retains.
- Keep Grok Build subscription login, catalog, and request identity in this package. This documentation audit does not claim a live login, inference result, or complete Grok Build parity.
- Ship a versioned package-root changelog entry for Pi 1.5.0's extension update notices.

## [0.1.3]

- Send `x-grok-client-surface: ui` and `x-grok-client-version: 1.0.70` on device start and device poll requests.
- Add `referrer: grok-build` to the device start form.
- Pin request headers `X-XAI-Token-Auth: xai-grok-cli` and client version `1.0.70` on subscription inference proxy calls.
- Include `grok-4.7-build-fast` in the baseline catalog.

## [0.1.2]

- Add repository, homepage, and bugs metadata and a changelog to the npm package.
