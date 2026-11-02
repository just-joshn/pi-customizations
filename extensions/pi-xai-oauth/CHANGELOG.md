# Changelog

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
