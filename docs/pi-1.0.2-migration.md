# Pi 1.0.2 migration

## Scope

The migration covers all six packages under `extensions/`. Every Pi development dependency pins `1.0.2`. Executable extensions retain wildcard host peers. The theme-only package has no runtime imports or host peers.

The installed Pi 1.0.2 changelog records one release addition, `samplingParamsByThinkingLevel`. The audit also checks existing integrations against `extensions/AGENTS.md`, rather than treating a version bump as sufficient evidence.

Historical migration reports, captured provider measurements, and source provenance keep their original version labels. Live development-target documentation names 1.0.2.

## Release applicability

| Package | Relevant Pi 1.0.2 behavior | Ownership |
| --- | --- | --- |
| `pi-xai-oauth` | Per-thinking-level sampling applies to its OpenAI Responses models. Physical models and virtual effort aliases need request-capture verification. | Pi merges model defaults, the clamped thinking level's overrides, and request overrides. The provider delegates native streaming. |
| `pi-pstack` | Workers must preserve registry model configuration, including the new sampling metadata. | Pi owns model selection, request construction, virtual routing, tool execution, and settlement. Pstack does not add a sampling merge or role setting. |
| `pi-anthropic-oauth` | The sampling addition does not apply to Anthropic Messages. Existing provider adapters need revalidation. | Native Anthropic streaming, OAuth, cancellation, and accounting remain authoritative. |
| `pi-antigravity-oauth` | Regenerate the required Google helper subset from Pi AI 1.0.2. Its shared options helper now resolves sampling metadata. | The Cloud Code protocol does not consume OpenAI sampling fields. Generated helpers remain source-identical except for import rewriting and provenance. |
| `pi-tui-skin` | No sampling behavior applies. Final-idle display must follow Pi settlement rather than an intermediate agent end. | Native Pi rendering and lifecycle events remain authoritative. |
| `pi-one-dark-pro-theme` | No sampling behavior or theme format migration applies. | Native theme discovery and rendering remain authoritative. |

## Verification sequence

1. Capture the pre-change frozen install and full `make verify` baseline.
2. Fail the six-package version regression, update manifests and the lockfile, and pass the regression.
3. Fail the vendor drift check, regenerate Antigravity helpers, and check types and provider coverage.
4. Capture native Grok sampling through Pi's model configuration and virtual routing.
5. Reproduce and correct confirmed structured-result, RPC prompt-disposition, and final-settlement defects.
6. Revalidate retained native gaps against installed public contracts.
7. Run full verification and existing real CLI, TUI, and RPC checks.
8. Review the diff and audit each requirement against the final artifacts.

The [decision trail](pi-1.0.2-decisions.tsv) records the migration choices and evidence. Baseline, regression, coverage, request, and runtime captures stay locally under `.audit/pi-1.0.2/`.

## Requirement audit

| Requirement | Evidence on the migrated source |
| --- | --- |
| All six packages target Pi 1.0.2 | Exact development pins, regenerated `bun.lock`, the six-package version regression, and frozen installation. Wildcard host peers remain unchanged. |
| Adopt relevant release behavior through native APIs | `pi-xai-oauth/scripts/prove-sampling.ts` captures physical and virtual model requests with `models.json` overrides. Native stream tests cover default, level, and explicit request precedence. The same proof fails on Pi 1.0.1 with `top_k` 40 instead of 20. |
| Keep unsupported protocols narrowly adapted | Regenerated Antigravity helpers pass vendor identity checks. Its request regression excludes OpenAI sampling fields from Cloud Code. Anthropic request captures verify agent-loop, compaction, and virtual-route billing transforms. |
| Preserve native final completion | Skin uses `agent_settled`. Child RPC accepts handled prompts without waiting for a nonexistent run. Timer recovery requires a matching native settlement receipt and does not infer completion from stopped assistants or abandoned branches. |
| Preserve cancellation and trust | Durable client cancellation, blocking worker waits, provider aborts, and declined project trust have regression coverage. Anthropic's real RPC proof reports an aborted result. Remote launch preserves the parent's effective native trust decision. |
| Preserve branches and session replacement | Worker, deferred-wake, goal, workflow, and activity suites exercise branch restoration and interruption. Anthropic's real RPC proof covers fork, reload, and new-session replacement. |
| Preserve shared-state concurrency | Worker and shell control tools use native sequential execution. Timer and routine tools explicitly serialize their shared service state. Their registration regressions failed before the corrections and pass afterward. |
| Publish valid data contracts and bounded previews | Worker listing and durable tools provide matching output schemas and structured results. Aggregate TaskList, Unicode, and multiline regressions prove native byte and line bounds while retaining complete structured records. Truncation notices distinguish model-facing text from programmatic data. |
| Group related tools through native metadata | Worker, shell, timer, routine, goal, and workflow families publish native namespace names, descriptions, and usage instructions. Native resource-loader and tool-definition regressions verify the metadata. Existing subagent namespaces remain unchanged. |
| Support native runtime surfaces | Fresh captures cover pstack CLI discovery and progress, provider print/JSON/RPC behavior, skin prompt parity, and theme discovery/rendering. The skin cancellation capture shows the stop hint during streaming and the idle placeholder after abort. |
| Retain only documented native gaps | `extensions/pi-pstack/docs/subagents-native-gaps.md` and `durable-host-native-gaps.md` identify evaluated public mechanisms, ownership boundaries, adapter scope, verification, and removal conditions. |
| Pass final repository checks and independent review | Independent audits identified namespace and output-preview corrections, reproduced and fixed with regression evidence. Final `make verify` exited 0 after all corrections. All six package coverage suites passed their thresholds, with 4,451 passing tests across those suites. The final pstack CLI drive also passed. |

## Verification limits

Loopback provider fixtures prove request construction and normalization, not production service acceptance. No separately configured VM was exercised. Remote placement and declined-trust behavior are covered by local fixtures, not represented as VM evidence. Remote workers inherit the launching parent's effective project trust for the committed mirror. That inheritance is not guest-specific resource approval or OS isolation.

The skin smoke command exits successfully but skips some visual invariants, including overflow and several header/footer alignment checks. Those assertions are not counted as verified. The relevant streaming-to-idle composer behavior was separately checked against its fresh captured terminal frames. Prompt parity is independently checked against native Pi.

The migration does not require real provider credentials, deploy services, or modify user data. Readonly workers have restricted tools, not an operating-system sandbox.

## Audit status

The migration audit passed against the final source. All six packages target Pi 1.0.2. Independent review findings are resolved, targeted regressions pass, and final `make verify` exited 0. Fresh native runtime evidence covers the relevant CLI, TUI, print, JSON, RPC, cancellation, branching, replacement, and concurrency paths.

The evidence limits above remain explicit. Passing the migration audit does not establish production subscription acceptance, real-VM placement, or the skipped visual layout invariants.
