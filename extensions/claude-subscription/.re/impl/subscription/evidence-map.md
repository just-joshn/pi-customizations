Behavior: bearer auth, no x-api-key, anthropic-version 2023-06-01, Claude Code user-agent
compat: request.test.ts subscription request identifies as Claude Code
implementation: src/request.ts buildMessagesRequest
unit test: test/request.test.ts
process test: test/stream.test.ts the built stream posts Claude Code headers
reference evidence: anthropic-sdk-re report/behavior.md C-01 and C-02. Identity overlay is Pi 0.87.1 anthropic-messages.js OAuth path, not the SDK user-agent.

Behavior: null header deletes an inherited header
compat: request.test.ts a null caller header deletes the Claude Code user agent
implementation: src/request.ts mergeHeaders
unit test: test/request.test.ts
reference evidence: C-21

Behavior: missing credentials fail at request time
compat: stream.test.ts missing subscription token throws
implementation: src/stream.ts streamSubscription
process test: scripts/prove-pi.ts
reference evidence: C-11

Behavior: overflow text preserved, abort is distinct
compat: stream.test.ts overflow and abort stay distinct
implementation: src/stream.ts emitSetupError
process test: test/stream.test.ts
reference evidence: Pi overflow helper recognizes "prompt is too long"

Behavior: Pi registers the provider
compat: load.test.ts
implementation: src/index.ts
process test: scripts/prove-pi.ts against pi 0.87.1
