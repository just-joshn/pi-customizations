implementation mode: B Reimplement
target repository: /Users/josh-desktop/src/personal/pi-customizations
reference executable: node anthropic-sdk-scenario.mjs driving @anthropic-ai/sdk 0.128.0
reference version/hash: repo 1926adb4d292090975e6b5d19ebafe2274d2469e, dist sha256 727b7ac3abdfa82c766f8e97ec7f7b97dd7d6ef909bbfc35d6e5fed71c726649
target version/commit: pi 0.87.1, extension pi-claude-subscription 0.1.0
features in scope: Claude Pro/Max OAuth login and refresh, Messages streaming that identifies as Provider CLI, Pi provider registration
features out of scope: Anthropic SDK dependency, stainless retry loop, files/skills/beta agents, API-key billing
compatibility requirements: bearer auth when only a subscription token is set, anthropic-version 2023-06-01, accept and content-type application/json, Provider CLI identity headers instead of Anthropic/JS
