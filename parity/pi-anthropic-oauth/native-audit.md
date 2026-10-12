# Pi-native architecture grounding: pi-anthropic-oauth

Date: 2026-10-12. Target: installed Pi **1.1.0**. This is architecture/source grounding, **not a final independent review** or a claim of Claude parity.

## Scope and clean-room boundary

Inspected repository TypeScript, synthetic tests, `extensions/AGENTS.md`, and the installed public Pi documentation/declarations. No proprietary Claude executable, bundle, source, network capture, or captured Claude JSON fixture was inspected. Existing comments asserting Claude provenance are not evidence for this audit. The native proof script was inspected but **not executed**, because it reads a captured Claude fixture. No implementation or test files were changed by this audit. Other work modified identity/parity documentation, scripts, and tests concurrently during the run; those changes were not authored or reverted here. Findings concern the inspected context/provider architecture, not a frozen final branch review.

Installed reference root (`$PI` below):

```sh
PI=/Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works
```

Documentation read completely for this grounding includes coding-agent README and `docs/extensions.md`, `custom-provider.md`, `providers.md`, `compaction.md`, `sessions.md`, `settings.md`, and `models.md`. Relevant public declaration evidence includes `dist/index.d.ts`, extension context/event/provider contracts, session projection, compaction, and Pi AI provider/auth/stream contracts. Installed implementation is supplementary evidence, not permission to depend on private imports.

## Current ownership map

- `src/index.ts:150-172` registers a complete provider via public `createProvider`/`registerProvider`, reuses the built-in Anthropic catalog, and delegates both streaming entry points. This is a **native adapter**, not a copied SSE implementation or second agent loop.
- `src/auth.ts:13-53` uses native provider authentication resolution and delegates OAuth login/refresh. Pi remains credential-storage/refresh authority.
- `src/index.ts:76-93` decorates headers/cache retention and the native `onPayload` hook; terminal usage observation is attached to the original stream's `result()` (`114-147`).
- `src/context/guard.ts` owns a second token estimate, mutable calibration, custom threshold decision, callback-based pre-prompt compaction wait, and wire-fit telemetry.
- `src/context/fit.ts:111-170` independently removes conversation prefixes or truncates summary input. Canonical session projection is not modified, so what the endpoint sees can differ from what Pi records as context.

## Confirmed findings

### N1 — Custom request fitting duplicates Pi-owned context management and loses context outside its persisted projection (high architectural concern)

Evidence: `src/context/fit.ts:136-146` discards the complete prefix before a selected user message; `111-129` truncates a summary's serialized input head/tail. `src/index.ts:86` applies this on every request, including summary/branch-summary requests routed through this provider. `guard.ts:16` explicitly announces that session history remains unchanged. The tests intentionally prove prefix loss and summary truncation (`test/context-fit.test.ts:45-77,102-120`).

Pi already owns threshold checks before prompts, between tool turns, overflow/length recovery, branch-aware projected context, persisted compaction entries, and summary generation (`docs/compaction.md`, sections “When It Triggers”, “Overflow and Length Recovery Ordering”, “CompactionEntry Structure”). Its native extension seam is `session_before_compact`, with usage and an abort signal, not an unrecorded provider-level pruning pipeline. `extensions/AGENTS.md`, “Compaction” and “Hard bans”, expressly reject custom truncation absent a documented native gap.

Consequence: successful requests can silently forget old instructions/history without a Pi compaction/context-edit boundary. Summary generation can permanently summarize only the surviving head/tail while Pi persists the resulting summary as covering the selected span. This does not delete raw transcript entries, but it does undermine the correspondence between canonical projection and the context actually answered/summarized. The marker is disclosure to the model, not a persisted description of exactly which entries were omitted.

Native direction: retain Pi compaction/recovery authority; tune model-specific native compaction settings. If an indispensable summary-input gap exists, document it and customize through the compaction hook, preserving boundaries, signal, usage, and branch semantics. Do not treat existing parity comments as that gap documentation.

### N2 — Guard ignores native configured token budgets; disabling auto-compaction does not disable wire truncation

Evidence: `src/context/tokens.ts:83-86` hard-codes reserve `min(maxTokens, 20000)`, then subtracts 13000/3000. `guard.ts:81-84` uses those thresholds; `138` checks only `compaction.enabled`. The independent `fit` path (`176-189`) never checks that setting or native reserve/keep-recent/model overrides. `index.ts:86` invokes it unconditionally.

Native contract: `docs/settings.md`, “Compaction”, and `docs/compaction.md`, “Per-model overrides”, support exact `provider/modelId` overrides, independently resolved reserve/keep-recent values, and model-sensitive checks. Users can therefore configure Pi's compaction timing yet still get an earlier custom compaction or an invisible wire cut. This is confirmed ownership/settings divergence, not proof that a particular real Anthropic context size will overflow.

### N3 — Calibration ratio is inverted for correcting underestimated context

Evidence: `guard.ts:112-121` returns `clamp(estimated / measured, 1, 2)`; both `83` and `180` **multiply** estimates by this bias. If the payload estimator says 100000 and usage says 200000, calibration becomes 1, preserving the underestimate. If it overestimates by two, calibration becomes 2, increasing the overestimate. `test/context-guard.test.ts:190-193` explicitly locks in the current ratio rather than testing calibration against true usage.

This is a confirmed mathematical mismatch with calibration toward endpoint usage, not an assertion about proprietary token counting. If the intended quantity is instead an intentionally conservative unrelated multiplier, it should not be described as correcting measured estimation error.

### N4 — Summary detection can truncate an ordinary oversized prompt

Evidence: `fit.ts:151-155` classifies a request solely by whether system text contains `summarization assistant`; `165-168` then enables head/tail truncation of its sole user message. This contradicts the stated protection at `103-109` that a user's own oversized first prompt is never silently truncated. An ordinary system prompt quoting that phrase is enough. Existing detection tests cover only a positive native-shaped phrase and a simple negative (`test/context-fit.test.ts:146-150`), not accidental inclusion.

Reproduced locally with a synthetic non-summary system prompt containing “Not a summary job. Mention: summarization assistant”: `fitPayload(...) !== original` is `true`. Native compaction lifecycle carries the actual operation identity; prose substring detection is not an authoritative operation discriminator.

### N5 — Prefix fitting discards native inline tool/prompt transitions without rebuilding a checkpoint

Evidence: `fit.ts:144` keeps only the selected user and subsequent messages while preserving top-level `tools` unchanged. A native inline `system` message carrying tool additions/removals or prompt changes immediately before that user is lost. `index.ts:69-73` disables native inline tool changes only for case collisions; ordinary transitions remain enabled. `test/tool-transitions.test.ts:104-110` verifies that the native wire has a fixed initial tool prefix and later `tool_addition` blocks. Those tests use small contexts and do not combine transitions with fitting.

Confirmed with a synthetic wire payload: initial top-level `Read`, oversized old user, assistant, inline system `tool_addition` of `Task`, then user “Use Task now”. Fitting removes the addition and leaves only `Read` in top-level tools. This is stronger than generic history loss: the provider destroys Pi's declaration transition while Pi still considers the added tool active. The same slicing also removes inline prompt changes. Pi's native conversion/checkpoint logic handles this state; pruning after conversion does not.

Exact reproduction:

```sh
cd /Users/josh-desktop/src/personal/pi-customizations/extensions/pi-anthropic-oauth
node --experimental-strip-types --input-type=module <<'JS'
import { fitPayload } from './src/context/fit.ts';
import { payloadTokens } from './src/context/tokens.ts';
const payload = { tools: [{ name: 'Read', input_schema: { type: 'object' } }], messages: [
  { role: 'user', content: 'a'.repeat(5000) },
  { role: 'assistant', content: 'ok' },
  { role: 'system', content: [{ type: 'tool_addition', tool: { type: 'tool_definition', definition: { name: 'Task', input_schema: { type: 'object' } } } }] },
  { role: 'user', content: 'Use Task now' },
] };
const fit = fitPayload(payload, { bytesPerToken: 3, compactAt: 1000, blockAt: 1200 }, p => payloadTokens(p, 3));
console.log('tool addition before kept user survives:', JSON.stringify(fit).includes('tool_addition'));
console.log('tools:', JSON.stringify(fit.tools));
JS
```

Observed: addition survives `false`; tools contain only `Read`.

## Lifecycle and concurrency grounding

The public `ExtensionContext.compact(options): void` is documented as triggering compaction without awaiting completion (`dist/core/extensions/types.d.ts:204-208,249-250`). The adapter intentionally wraps callbacks in a promise (`guard.ts:87-102`). Installed `AgentSession` binds this to its manual compaction operation and calls `onComplete` or `onError` (`dist/core/agent-session.js:2769-2780`); the manual operation itself first aborts current work and emits reason `manual` (`2167-2207`). Thus guard-triggered “automatic” compactions are **reported to other extensions as manual, willRetry:false**, not native threshold compactions. This is a confirmed semantic divergence for telemetry and policy hooks.

Do **not** infer a deadlock merely from awaiting the callback: the public callback bridge exists and the guard checks `isIdle()`. Likewise native streaming abort support remains delegated; this is not a custom fetch implementation dropping a signal.

Potential generation/concurrency hazards require targeted host reproduction before being promoted to confirmed live defects: `guard.ts:156-174` resets shared flags/bias while callbacks or direct provider requests may still be pending; `index.ts:132-147` observes completed streams without a session-generation check. `guard.ts:192-198` has no branch/model-select reset and one provider-wide calibration value. A late old-session/direct-call observation can affect subsequent estimates if it resolves after reset; model switches also share calibration. The current guard unit rig supplies synchronous success/error callbacks and has no actual abort/reload/branch overlap test. Native session disposal and operation ordering must be considered before claiming a normal CLI race.

## Verification performed

From the repository root:

```sh
cd extensions/pi-anthropic-oauth
bun run test -- test/context-fit.test.ts test/context-guard.test.ts test/context-tokens.test.ts
bun run typecheck
bun run test -- test/request-hooks.test.ts test/stream-failures.test.ts test/auth-boundaries.test.ts test/oauth-credentials.test.ts test/tool-transitions.test.ts test/unicode-stream.test.ts
```

Results: **72 tests passed** across the first three files; typecheck passed; **58 tests passed** across the additional six files. These are synthetic/network-guarded tests, not live subscription verification. Passing tests do not resolve N1–N4: several assert the disputed behavior directly.

Exact clean-room reproduction of N3/N4:

```sh
cd /Users/josh-desktop/src/personal/pi-customizations/extensions/pi-anthropic-oauth
node --experimental-strip-types --input-type=module <<'JS'
import { calibratedBias } from './src/context/guard.ts';
import { fitPayload } from './src/context/fit.ts';
import { payloadTokens } from './src/context/tokens.ts';
const p = { model: 'claude-opus-5-5', messages: [{ role: 'user', content: 'a'.repeat(300000) }] };
console.log('estimate 100000, measured 200000 => bias', calibratedBias(p, 200000, undefined));
const b = { bytesPerToken: 3, compactAt: 1000, blockAt: 1200 };
const q = { system: [{ type: 'text', text: 'Not a summary job. Mention: summarization assistant' }], messages: [{ role: 'user', content: 'a'.repeat(5000) }] };
console.log('ordinary prompt truncated by substring:', fitPayload(q, b, x => payloadTokens(x, 3)) !== q);
JS
```

Observed output: bias `1`; ordinary prompt truncated `true`.

## Review boundary

This grounding distinguishes a native streaming/auth adapter from the non-native context subsystem. It does not establish live service cache TTLs, fingerprint correctness, subscription authorization policy, or equivalence to Claude. Those require separately authorized public/service evidence. Do not run `prove:native`, captured-parity tests, or capture tooling as a clean-room verification command.
