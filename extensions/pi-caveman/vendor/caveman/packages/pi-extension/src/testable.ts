// Vendored from JuliusBrussee/caveman 99aafe151a1be72be783e662858e8a0955add59f packages/pi-extension/src/testable.ts (Apache-2.0) by scripts/vendor-runtime.mjs. Do not edit.
// Test-only surface: re-exports internals so the node --test suite can exercise
// them from the built dist without reaching into TS sources.
export * from "./protocol.ts";
export { HookBridge, promptDigest, resolveHookInvocations, taskContinuation, taskTerms, taskType } from "./lifecycle.ts";
export { RecoveryClient, resolveMcpBinary } from "./recovery.ts";
export { ProviderRouter } from "./provider.ts";
export { shrinkToolResult } from "./tool-output.ts";
