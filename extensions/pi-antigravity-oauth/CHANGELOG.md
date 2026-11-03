# Changelog

## [0.1.5] - 2026-11-03

- Follow the repository Vitest rules in the test suite. Source changes are formatting and import order only.

## [0.1.4] - 2026-11-02

- Target Pi 1.5.0 development dependencies and import TypeBox directly in standalone tests.
- Refresh Pi's Google schema conversion and constrained-sampling helpers, preserving the documented strict-TypeScript adaptations.
- Revalidate the native transport gap against Pi 1.5.0. Live OAuth login and service inference remain unverified.

## [0.1.3]

- On macOS, `/login` can import the Antigravity CLI keychain credential (`gemini`/`antigravity`) into Pi `auth.json`, then fill `projectId` via `loadCodeAssist`. No `agy` binary is required at runtime.
- Call Cloud Code `onboardUser` during login when `loadCodeAssist` names no project, instead of telling the user to run the Antigravity CLI.
- Fix Cloud Code Assist rejecting every request with `400 Invalid JSON payload`. Tool schemas with `type` unions or `exclusiveMinimum`/`exclusiveMaximum` are now reduced to the OpenAPI subset the API accepts.
- Validate stored access tokens against Google tokeninfo v3 on refresh or import rejection.

## [0.1.2]

- Add repository, homepage, and bugs metadata and a changelog to the npm package.
