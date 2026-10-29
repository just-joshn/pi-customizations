# Native API gaps

This package fills two Pi public-API gaps. `bun run check:native-gap` fails when this record drifts from the adapters on disk. `bun run check:vendor` separately fails when `src/pi-ai/` drifts from the pi-ai sources of the version the installed Pi loads. `bun run vendor` regenerates those copies.

```native-gap-files
src/stream.ts
src/cloudcode.ts
src/openapi-parameters.ts
src/oauth.ts
src/pi-ai/constrained-sampling.ts
src/pi-ai/estimate.ts
src/pi-ai/genai.ts
src/pi-ai/google-shared.ts
src/pi-ai/headers.ts
src/pi-ai/provider-retry.ts
src/pi-ai/sanitize-unicode.ts
src/pi-ai/simple-options.ts
src/pi-ai/transform-messages.ts
```

## Gap: cloud-code-stream

### 1. Exact required behavior

Send Antigravity Cloud Code Assist agent requests (`v1internal:streamGenerateContent`) with the CLI envelope (`project`, `requestId`, `request`, `model`, `userAgent`, `requestType`), read the SSE response into Pi's assistant-message event stream, and honor abort, usage, tools, and thinking.

### 2. Pi mechanism evaluated

`models.json`, native `google-generative-ai` provider streaming, and `pi.registerProvider()` with a stock Pi API implementation.

### 3. Why the public API cannot express the requirement

Pi's `google-generative-ai` path rejects a custom `fetch` and does not emit the Cloud Code envelope. No public Pi API maps to `v1internal` agent requests.

### 4. Why omitting the feature is unacceptable

Without the envelope and stream reader, an Antigravity subscription cannot answer in Pi. That is the package's purpose.

### 5. The smallest adapter that fills only the gap

`src/stream.ts` builds the envelope and reduces SSE into Pi events. `src/cloudcode.ts` owns headers, open/retry transport, and key parsing. `src/openapi-parameters.ts` only adjusts tool schemas for the CLI wire. OAuth login lives in `src/oauth.ts` because Pi has no Antigravity auth provider.

### 6. Which Pi-owned state remains authoritative

Pi owns the transcript, session tree, tool registry and execution, compaction, cost types, and credential store (`auth.json`). This adapter is request-local.

### 7. Verification

`test/stream.test.ts`, `test/cloudcode.test.ts`, `test/oauth.test.ts`, and `test/command.test.ts` cover text, tools, usage, aborts, empty-stream retries, and login boundaries. Cancellation uses `options.signal`.

### 8. Delete when

Pi exposes a public API that can send the Cloud Code Assist agent envelope (or an equivalent Antigravity wire) with custom transport, and a stock stream path that preserves abort, tools, thinking, and usage.

## Gap: vendored-google-helpers

### 1. Exact required behavior

Convert Pi transcripts and tools into Google content/parts the Cloud Code `request` field accepts, including stop-reason mapping and thinking-signature retention.

### 2. Pi mechanism evaluated

Importing conversion helpers from `@earendil-works/pi-ai` public entry points.

### 3. Why the public API cannot express the requirement

Pi's extension loader aliases only `@earendil-works/pi-ai`, `/compat`, `/models`, `/oauth`, and `/providers/all`, and applies each alias as a prefix rewrite (`pi-coding-agent/dist/core/extensions/loader.js`). The package itself also exports `./api/*` and `./utils/*`, but `@earendil-works/pi-ai/api/google-shared` resolves to `dist/compat.js/api/google-shared` and fails, so the Google conversion modules are unreachable from an extension. `docs/packages.md` adds that a physical copy of a host package can bypass Pi's module mapping and create duplicate registries.

### 4. Why omitting the feature is unacceptable

Reimplementing conversion would fork Pi's Google semantics. Omitting conversion leaves no valid Cloud Code `request` body.

### 5. The smallest adapter that fills only the gap

Verbatim copies under `src/pi-ai/` from the source maps of the `@earendil-works/pi-ai` version the installed Pi loads, plus a tiny `genai.ts` enum/type shim. `scripts/vendor-pi-ai.mjs` regenerates them; `check:vendor` compares, and rejects a devDependency that differs from that version.

### 6. Which Pi-owned state remains authoritative

Pi still owns transcript helpers, cost accounting, and model types imported from the public `@earendil-works/pi-ai` entry. Vendored files are conversion only.

### 7. Verification

`bun run check:vendor` against the `@earendil-works/pi-ai` version the installed Pi loads. Unit tests under `test/google-shared.test.ts`, `test/transform-messages.test.ts`, and related files exercise the copies through the stream path.

### 8. Delete when

Pi exports the Google conversion modules (or equivalent) from a supported extension entry point at the same semantics the stream needs.
