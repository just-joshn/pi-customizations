# Changelog

## [0.1.3]

- On macOS, `/login` can import the Antigravity CLI keychain credential (`gemini`/`antigravity`) into Pi `auth.json`, then fill `projectId` via `loadCodeAssist`. No `agy` binary is required at runtime.
- Call Cloud Code `onboardUser` during login when `loadCodeAssist` names no project, instead of telling the user to run the Antigravity CLI.
- Fix Cloud Code Assist rejecting every request with `400 Invalid JSON payload`. Tool schemas with `type` unions or `exclusiveMinimum`/`exclusiveMaximum` are now reduced to the OpenAPI subset the API accepts.
- Validate stored access tokens against Google tokeninfo v3 on refresh or import rejection.

## [0.1.2]

- Add repository, homepage, and bugs metadata and a changelog to the npm package.
