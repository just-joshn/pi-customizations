# Cursor CLI host source discovery

## Scope and evidence

Source discovery only on branch `parity/host-contracts`. Writes are confined to `parity/research/cursor-host/cli/`. No installation, service activation, model journey, settings change, commit, publication or acceptance claim occurred.

The full parent contract was read in two chunks. Parent progress and source lock were read. All nine supplied CLI Markdown files were read completely. The changelog required a continuation after the read tool's byte limit. Owned copies preserve their full bytes. Original retrieval start/end times are unknown. The old job start is not substituted for per-file time. Mtime is labeled observation only.

New HTTP retrievals preserve full bodies, response headers and curl response JSON, including requested/effective URL, HTTP status and actual start/end times. Each metadata record contains the full-body SHA-256. Retrieved Markdown was read completely, including pool lines 706 through EOF after truncation. The index was read in full. Incorrect guessed paths returned Page not found. These bodies are preserved, not represented as working documentation.

`proposals.json` contains section-level source edges with exact heading locators, inclusive spans, full-file hashes and verbatim quotes. Section edges are discovery proposals, not independently falsifiable frozen acceptance definitions. Every supported optional branch in the read sources remains present in those quotes. Normative, illustrative and conditional classifications are provisional. Example sections are not promoted to mandatory vendor choices. Nested examples inside broader sections need classification refinement by the coordinator. `queue.json` preserves discovered official links and open contract conflicts. Its duplicates across source locations are intentional discovery provenance, not a unique dependency count.

## Discovery and modes

The changelog documents discovery through `.cursor`, `.claude`, `.agents` and `.codex` skill directories, nested project resources, symlink following and skipping hidden directories. Plugin reload and `/add-dir` refresh command discovery. Model-only skills remain available to the model but are hidden from slash invocation when `user-invocable: false`. The using document distinguishes Enter's one-message attachment from Option+Enter's sticky Custom Mode. Agent, Plan, Ask and Debug remain separate entry points. The ACP contract explicitly describes Plan and Ask as read-only. The shell user mode is not the shell subagent.

Closed-source curated builtins remain required discovery work. The CLI changelog establishes that curated built-in skills exist but does not enumerate their complete subordinate contracts. This absence is not permission to omit goal, loop, skill authoring or automation builtin dependencies from the plugin graph.

## Workers, state and permissions

The March changelog says local parallel subagents inherit credentials, rules and approval policy. Max mode and custom-key setups propagate. Later entries require persisted subagent checkpoints, complete ordered transcripts and clear unavailable-resume failures. Explore model configuration supports default, disabled, parent inheritance and explicit model selection. Single-turn/headless runs drain subagents and background work. ACP clients advertising subagents get linked child sessions, streamed activity, terminal states, cancellation and reload history. Legacy clients keep `cursor/task` notifications.

Self-hosted pools execute tools on worker infrastructure while orchestration and inference stay in Cursor's cloud. A checkout alone is not that machine contract. The pool document covers named/default pools, repo-backed and any-repo routing, multi-root registration, opt-in cloning and safe reuse, hibernation, reconnect windows, service-account and per-claim tokens, computer use, secret sync, GitHub token minting, identity sockets, hooks, artifacts, controller claim/warm modes, monitoring and failures. All remain unverified optional branches. Command MCP executes on the worker; HTTP/SSE MCP connects from Cursor's backend.

Permission tokens include Shell, Read, Write, WebFetch and MCP with deny precedence. Team/admin gates remain additional constraints. ACP permission requests block until the client responds. ACP supports project/user MCP but explicitly excludes team-level dashboard MCP. The example client automatically approving once is illustrative, not the normative policy.

## Goals, loops and persistence

The August changelog describes durable `/goal` with active/paused status, continuation across idle/headless runs and Ctrl+C pause, explicitly rolling out and gated. September says asking to stop permits marking it complete. Persistent sessions use `agent persist`, `/detach`, attach/list/stop and resume. January records stop hooks with follow-up loops. No general scheduling cadence or autonomous subscription contract was found in these CLI documents. Goal rollout gates and loop/builtin missing details stay open, not disabled out of the denominator.

## Output and control

Print mode has text, JSON and NDJSON. Text outputs only the final assistant message. JSON aggregates text and emits one successful result followed by newline. Failure exits nonzero to stderr without a well-formed JSON result. Stream failure can end before a terminal result. Partial streaming has new-text deltas and duplicate buffered/final flushes that consumers must distinguish. Thinking is suppressed in print formats. Unknown future fields must be tolerated. Non-TTY stdout or piped stdin can infer print mode.

ACP uses stdio JSON-RPC 2.0 with newline framing. Authentication, session creation/load, prompt, streaming updates, permission decisions and cancellation are distinct steps. Blocking question/plan extensions differ from notification todo/task/image methods. Public type examples include response shapes even for notification methods; do not infer client response obligations from those examples.

Shell Mode runs independent login-shell commands in the CLI workspace/environment with a fixed 30-second timeout. It does not support interactive prompts or servers. `cd` does not persist. Empty-input Escape, Backspace/Delete or Ctrl+C exits. Ctrl+O expands truncated output. Terminal setup documents native Shift+Enter terminals, Option+Enter configuration, universal Ctrl+J/backslash-newline, Vim editing and theme detection/overrides. Multiplexer interception is a supported platform case, not an exemption.

## Conflicts and limits

The headless page says writes without force are proposed only; using/parameters/permissions say print can write and run shells with permission controls. Parameters restrict trust to headless, while the July changelog says interactive trust works. Parameters give idle default zero and older boolean pool syntax; pool docs and changelog say 3600 and optional named pool syntax. These are unresolved source conflicts requiring locked-reference observations.

A Page not found body is missing public documentation at that requested URL. It is not evidence that the product feature is absent. The parent's recorded account usage limit is missing successful working-service evidence. Legitimate denial, unavailable authentication, artifact-upload failure or invalid pool option are their own required negative paths. None closes the working branch.

No runtime tool observations were used to authenticate physical provider/model identity. Environment metadata cannot authenticate a physical provider. No behavioral verification, closure, acceptance freeze or pass claim is made.

## Exact next action

The coordinator should first inspect `proposals.json` conflict edges for force/write, interactive trust and pool idle defaults, then authorize and record locked Cursor non-model control scenarios with literal inputs and timestamps. In independent source discovery, retrieve and read `https://cursor.com/docs/cloud-agent/self-hosted.md`, then the pool-linked API, My Machines, computer-use, identity and service-account contracts with the same retrieval envelope. Reconcile customization links with the other explorer. Extract individual requirements only after conflict triage and independent acceptance ownership.
