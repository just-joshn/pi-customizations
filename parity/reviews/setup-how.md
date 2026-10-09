## Overview

The Pi implementation turns official setup-pstack’s **instruction-driven rule-writing workflow into executable, confirmation-gated extension code**. Its overall shape matches: discover models, load roles, choose budget, repair invalid choices, review, validate, replace the configuration, and offer verification.

It is **not exact parity with the locked official skill**. The largest concrete differences are unlimited-budget semantics, default model identities and panel sizes, and how model availability maps to Pi’s physical/virtual model catalogue.

**Evidence scope:** read-only source comparison; no tests or live Pi sessions were run. The official locked `parity/reference/cursor-plugins/pstack/skills/setup-pstack/SKILL.md` was read completely. Test assertions below describe coverage, not demonstrated runtime behavior.

## Key concepts and ownership

| Concern | Owner and locator |
|---|---|
| Official behavioral contract | `parity/reference/cursor-plugins/pstack/skills/setup-pstack/SKILL.md`, steps 1–7 |
| Role defaults, budget mapping, parsing, validation, persistence | `extensions/pi-pstack/src/models.ts`: `defaults`, `budgets`, `readTable`, `resolveModel`, `setupModels` |
| Model-callable entry point | `extensions/pi-pstack/src/setup-tool.ts`: `registerSetupTool` |
| Slash commands and optional verification continuation | `extensions/pi-pstack/src/commands.ts`: `registerCommands`, `registerNativeInput`, `setupPstack` |
| Always-applied behavior | `extensions/pi-pstack/src/index.ts`: `before_agent_start`; `src/host.ts`: `hostInstructions` |
| Verification-offer memory | `extensions/pi-pstack/src/state.ts`: `State.verificationOffered`, `createState` |
| Worker model selection | `extensions/pi-pstack/src/worker-support.ts`: `prepareWorkerSession`, `openWorkerSession` |

The saved `.mdc` is **pstack-owned external state**, not a native Pi rule resource. `alwaysApply: true` is descriptive here: the extension implements application by reading the file and injecting its contents into `systemPromptOptions.sections.pstack_host` before each agent run.

Role dispatch remains partly **model-mediated**: the host presents role overrides as instructions; `prepareWorkerSession` resolves the model reference supplied to Task, a resumed reference, or a persona default. It does not independently look up a workflow role in the rule.

## How it works

1. `/setup-pstack` calls `setupPstack`; owned `/skill:setup-pstack` input is intercepted and routed to the same handler. Natural-language setup can invoke the `model-only`, sequential `pstack_setup` tool.
2. `setupModels` requires `ctx.hasUI`. It reads the **user rule**, seeds all 17 roles from defaults, preserves recognized saved role values, and collects retired lines.
3. It asks for a budget, transforms real references, shows the table and dropped lines, and forces unresolved roles through editing.
4. After “Accept as-is,” it emits family warnings, asks explicit write confirmation, validates again, then atomically replaces the user file using a private temporary file and `rename`.
5. Success schedules a model follow-up to inspect project verification capability and offer creation if absent.

These integration choices fit locked Pi v1.1.0 declarations:

- `ExtensionUIContext.select/confirm/input`: `parity/reference/pi-v1.1.0/packages/coding-agent/src/core/extensions/types.ts`, interface beginning at line 158.
- `ExtensionContext.mode`, `hasUI`, `modelRegistry`, `scopedModels`, `thinkingLevel`, `isProjectTrusted`: same file, lines 325–350.
- `docs/extensions.md`, “Tool exposure,” “State,” and “UI and modes”: model-only tools, external storage, TUI/RPC distinctions.
- `docs/rpc-extension-ui.md`, “Requests from Pi”: RPC dialogs require client responses; notifications can be ignored.

## Concrete divergences and smallest testable repairs

| Area | Finding | Smallest repair / focused test |
|---|---|---|
| **Budget labels and unlimited** | Official step 3 requires `unlimited — max reasoning` and applies target `max` to every real slug. `models.ts` uses `unlimited — keep max` → `undefined`, leaving existing effort unchanged while writing `# budget: unlimited (max)`. No-rule UI also omits official guidance that `large` matches defaults. | Make unlimited target `max`, fix its exact label and first-run guidance. Test a saved `:medium` reference upgrading to max or the highest supported level below it. |
| **Defaults and panel counts** | Official step 5 uses Opus **xhigh**, Grok for `reflect tooling`, and **two** entries in all four list roles. Native `defaults` uses Opus **max**, GPT for tooling, and **three** entries including GPT. The bundled setup skill documents these different defaults too. | Align `defaults` and bundled documentation to the locked table. Test values and ordered lists, not merely role-name equality. First-run three-seat runner panels imply different instructed fan-out; cross-judge pool size is not judge count. |
| **Available model identity** | `resolveModel` validates catalogue references against `getAvailable()`, preferring exact matches before interpreting `:thinking`. Qualified `provider/id` disambiguates duplicate IDs. This is useful Pi adaptation, but the registry returns an availability **snapshot**, not proof of successful service access or physical identity. | Test duplicate IDs, stale availability and virtual models explicitly. Define whether explicit role choices must be physical; if so, exclude virtual identities while keeping parent aliases usable. |
| **Effort/family fallback** | Official step 3 rewrites effort-bearing slugs and searches detected same-family slugs. `applyBudget` instead preserves one Pi model identity and chooses supported thinking levels. It cannot translate unavailable official defaults into available physical Pi IDs. | Add a narrowly defined, detected-catalogue translation for known default identities; never guess an undetected ID. Test fast/effort slugs, absent families, and below-target fallback. |
| **Rerun preservation** | `readTable` preserves **every** recognized saved value, then rebudgets it; it cannot distinguish user family/list/alias changes from historical defaults. It reads no project override during setup. | Add rerun tests covering unchanged defaults versus customized families, ordered duplicate lists, and aliases before choosing migration semantics. At minimum, expose effective project overrides in review. |
| **Aliases** | `auto` and `inherit-parent` remain unchanged and resolve to the parent model/thinking. Duplicate entries survive. However, `familyWarnings` resolves aliases and can fail when no parent model exists, despite aliases passing setup validation. | Test alias-only panels with no selected parent; skip unavailable family analysis rather than blocking valid alias configuration. |
| **Retired roles** | Recognized implementation: unknown role lines are reported and omitted from the replacement. But blank/malformed non-role lines are silently discarded. | Existing retired-role tests cover the main contract. Add malformed-input reporting only if needed; do not expand the format spec unnecessarily. |
| **Confirmation** | Writes occur only after explicit confirmation. However, RPC review depends on a fire-and-forget notification; the selection contains role names only, and final confirmation contains budget/path—not the complete table. | Include the reviewed table in a response-bearing RPC dialog. Test a client that ignores notifications and verify cancellation leaves the old file intact. |
| **Activation notice** | Official step 6 says new sessions; native success says **next prompt**, consistent with rereading in `before_agent_start`. | Treat as an intentional host adaptation; verify next-prompt and new-session application with real Pi. |
| **Optional verification** | `setupPstack` implements this through a model follow-up, not deterministic discovery/consent code. `verificationOffered` is marked **before** inspection or an actual offer, and persisted per session branch—not per project. | Test repeated setup, branch restoration, existing harness, interrupted follow-up and decline. Track completed inspection/offer separately if “once” must survive interruption reliably. |

**Physical-model caveat:** locked `core/model-registry.ts:getAvailable` delegates to `ModelRuntime.getAvailableSnapshot`. Locked `core/model-runtime.ts:registerVirtualModel` and `getPhysicalModel` explicitly distinguish virtual and physical models. The native setup code makes no such distinction; its family heuristic is the first alphabetic token of the model ID, not an authoritative routed-model family. `ctx.scopedModels` is also not consulted—whether that should restrict Task requires an explicit policy, since the declaration describes session scoping rather than proving a Task restriction.

## Gotchas: trust and persistence boundaries

- **Project overrides outrank user choices:** `readModelRule(cwd)` merges `.pi/pstack/models.mdc` role lines over the user file; `setupModels` calls it **without cwd** and writes only the user file. Setup can therefore successfully save a choice that does not become the effective project choice.
- **Project content enters system context without a local trust check:** `index.ts:before_agent_start` reads the project rule regardless of `ctx.isProjectTrusted()`. `roleLines` accepts arbitrary colon-bearing lines, including unknown roles, which are injected into the host section. This is a prompt-trust boundary, not merely model configuration. A minimal repair is trust-gated project loading plus recognized-role/value validation; test untrusted and malformed project files.
- **Atomic replacement is not concurrency control:** unique temporary files prevent partial replacement, but there is no complete read–modify–write queue or conflict detection. Separate sessions can overwrite each other’s choices. Locked `docs/extensions.md`, “Tools,” recommends `withFileMutationQueue()` for file mutations; cross-session protection needs more than sequential tool execution.
- **Consent depends on the UI client:** RPC confirmation is a protocol response, not independently authenticated human consent. Tool annotations are hints, not enforcement; the actual write gate is `ctx.ui.confirm`.

## What the tests establish—and do not

Read relevant tests:

- `extensions/pi-pstack/test/models.test.ts`: aliases, ambiguity, thinking support/flooring, confirmation, cancellation, retired roles, duplicate panels, scripted TUI rendering.
- `test/model-errors.test.ts`: failed writes/renames, cleanup, invalid selections, retired-line reporting.
- `test/parity-runtime-models.test.ts`: mocked-context family warnings; despite its name, not live runtime parity.
- `test/setup-tool.test.ts`: unattended setup rejection and tool registration.
- `test/setup-tool-behavior.test.ts`: mocks `setupModels`; proves result formatting and follow-up scheduling only.

Some tests **encode the divergence**, notably “setup offers the four documented reasoning budgets” and “setupModels with unlimited budget preserves existing model strings without target.” They are not locked-official acceptance evidence.

**Unread dependencies / remaining uncertainty:** the full locked declarations file was not read—only relevant declaration sections/search results. Full model-runtime availability/auth-refresh internals, thinking-helper implementations, `picker.ts`, panel workflow consumers, worker provider/trust loading, command-integration tests, verification-skill implementation, and linked Pi docs/examples beyond `extensions.md` and `rpc-extension-ui.md` were not read. Actual model entitlement, physical routed identity, Task fan-out, RPC review visibility, next-prompt activation, and optional-offer completion remain unverified.