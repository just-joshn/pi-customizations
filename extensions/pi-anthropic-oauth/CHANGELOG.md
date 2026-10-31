# Changelog

## [0.1.1]

- Replace the Pi builtin Anthropic OAuth wrap with a Pi-native Claude OAuth client (cai authorize, independent state, plugins login scope, Zxt refresh scope, copy-code).
- Stop accepting ambient `ANTHROPIC_OAUTH_TOKEN`. Keep `ANTHROPIC_AUTH_TOKEN` then `CLAUDE_CODE_OAUTH_TOKEN`.
- Add repository, homepage, and bugs metadata and a changelog to the npm package.
