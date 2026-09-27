# Independent parity findings

This is a read-only implementation audit, except for this report. Findings describe the starting implementation and are not a claim that later fixes remain absent. Paths are relative to the repository unless absolute. Reference observations belong to the pinned Cursor versions investigated by the supplied reverse-engineering work. They do not establish other Cursor versions or IDE behavior.

Follow-up authorization assigned this reviewer the CI watcher default correction. The changed persona test failed with actual `fast` versus expected `undefined`, then all six persona tests passed after removing that default. Only `src/personas.ts` and `test/personas.test.ts` were edited for this correction. The root coordinator owns combined worker-level verification and documentation changes.

## Scope and positive evidence

- Read the pstack RE host model, model precedence contract, team-kit report, Cursor agent Task findings, and Cursor agent architecture summary.
- Inspected resource generation, manifests, current parity and mechanism reports, personas, parent host instructions, worker construction, and representative transcript, setup, orchestration, and team-kit skills.
- Read installed official Pi 0.87.1 skill, prompt-template, and extension documentation. Root owns online freshness verification. This report does not assert that the installed version is the latest remotely published version.
- Ran `node extensions/pi-pstack/scripts/resources.mjs`. It passed for 187 upstream files and 205 generated resources.
- Compared `extensions/pi-pstack/upstream` with `/Users/josh-desktop/src/experiments/plugins/pstack`. No content differences appeared. Only the external source checkout had `.DS_Store` files.
- Compared `extensions/pi-pstack/upstream-team-kit` with `/Users/josh-desktop/src/experiments/plugins/cursor-team-kit`. No differences appeared.
- Ran the external source repository diff between `78f46dacbafc71fd7d937bfc2c26da914f1bc09b` and `ecc249f1e306fc64ddf83c7bed16cacf7c2239db` for `pstack`. It was empty. The older pstack RE pin and bundled provenance pin therefore have matching pstack content.
- The 47 pstack skill sources, 23 playbooks, two personas, 18 additional kit skills, two additional personas, kit rules, canvas assets, helper scripts, and dormant Benny pack are preserved. Manifest discovery excludes the archives and dormant automation skills. Active frontmatter removes Cursor-only mode, icon, color, reminder, and paths fields. Active names use legal Pi slugs.

## P1. CI watcher default contradicts observed plugin behavior

`extensions/pi-pstack/src/personas.ts` gives `ci-watcher` the default model `fast`. `src/workers.ts` uses this default when the caller omits a model. `src/index.ts` tells the model that this behavior is the source contract.

The supplied `/Users/josh-desktop/Documents/RE/re-cursor-team-kit/re/REPORT.md:42` observes that plugin agents lose both the `fast` model and background flag and inherit the parent. The same agent installed as a workspace agent retains those fields. This is a differential observation, supported by inspected loader source. `/Users/josh-desktop/Documents/RE/re-cursor-agent/re/50_source/task/FINDINGS.md`, model step 3 and Gotchas, independently describes plugin model/tool stripping.

The current behavior preserves author intent rather than the observed plugin contract. It can make an otherwise valid omitted-model Task fail when `fast` is not configured.

Smallest correction is to remove the `fast` runtime default, keep the original archived frontmatter, and document parent inheritance for plugin personas. Prefer stripping agent frontmatter before constructing executable instructions so the model does not see conflicting host metadata. Keep explicit caller model overrides working.

Regression test should start `ci-watcher` without a model against a deterministic provider that exposes only the parent model and assert that the child actually uses that model. A second invocation with an explicit available model should select it.

## P2. Automatic kit rules contradict observed plugin behavior

`src/index.ts` injects both kit rules on every parent turn. `src/workers.ts` appends them for readonly children, while writable children receive the extension. `src/personas.ts` loads their bodies. These actions intentionally implement the rules' declared `alwaysApply` intent.

The supplied team-kit `REPORT.md:43` observes zero plugin rules delivered to the model, including startup-loaded plugins and delayed observations. Workspace rules were delivered as a control. The report identifies the source cause in rules-service composition. `REPORT.md:67` onward explicitly distinguishes author intent from actual CLI behavior.

Smallest correction for the requested RE behavior baseline is to stop automatic injection of the archived plugin rules and correct host-contract text and parity claims. Preserve the rule files as source artifacts. Do not introduce a new configuration system solely for this correction. If source intent is selected instead, report this as a deliberate parity difference rather than claiming observed host parity.

Regression tests should inspect actual parent and writable/readonly child provider requests and assert the two archived rule bodies are absent by default. Verify unrelated project instructions still load normally.

## P3. Readonly children miss the Pi host adaptation instructions

The parent `src/index.ts` supplies extensive instructions adapting transcript paths, model references, unsupported services, and workflow dependencies. Readonly workers disable extensions and receive only the persona, kit rules, and a short skill-directory/child-lifecycle string in `src/workers.ts`.

`skills/recall/SKILL.md:15` still explicitly directs readers to `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`. `skills/automate-me/SKILL.md:29` assumes the system prompt names a Cursor `agent-transcripts` directory. The root host contract corrects these assumptions. The readonly worker prompt does not. `pstack_context` is also unavailable there because readonly workers only receive read, grep, find, and ls.

The gap is verified from construction paths. A model following the wrong transcript instructions is a risk inferred from those prompts, not an observed live-model failure.

Smallest correction is a shared host adaptation text used by parent and both worker modes. Supply readonly workers explicit in-scope Pi transcript pointers or a readonly history facility; do not tell them to call unavailable `pstack_context`. State missing abilities directly. Preserve the restriction on other workspace histories.

Test real deterministic child requests for the Pi transcript adaptation and worker-specific available facilities. A readonly recall scenario should receive a known Pi session pointer and no instruction to discover another corpus.

## P4. Invocation semantics differ from the source host

Team-kit `REPORT.md:21-25` observes slash skills anywhere after whitespace, deduplication, unchanged user text, direct full-body attachment, and TUI `/subagent-...` composer expansion.

The port exposes leading-command Pi templates whose bodies ask the model to read a skill. Native `/skill:name` directly expands skills. This is supported Pi behavior, but inline `please run /deslop` has no equivalent guaranteed expansion, and alias invocation relies on a later model read. The current parity report already acknowledges the model-mediated-read difference. Subagent composer shortcuts are not provided.

These are host adaptation limits, not violations of Pi's documented template facility. A runtime input adapter could implement deterministic inline attachment, but it needs careful handling of quoted examples, resource shadowing, multiple commands, and native template argument parsing. Do not silently claim existing templates already reproduce these behaviors. No small safe implementation is proposed without a dedicated behavior contract and tests.

## P5. Task has a narrower interface than the inspected Cursor host

`src/workers.ts` exposes prompt, persona, model, cwd, environment, readonly, background, and resume. It rejects resume while the task is running and asks callers to use TaskMessage. Separate TaskOutput and TaskStop tools implement waiting and stopping.

Cursor agent Task `FINDINGS.md`, model steps 8-9, describes the special empty-prompt readonly foreground resume call as a background wait path. Its schemas also expose description, interrupt, attachments, and placement fields. The findings explicitly say that different wire schemas cannot be assumed to be a single canonical public tool schema and that interrupt mapping remains unknown.

The observed local await behavior could be implemented as a compatibility branch delegating to existing wait logic. Preserve the task workspace and policy checks. Test an in-flight background task followed by the empty-prompt readonly resume form. Do not infer unobserved interrupt or attachment semantics solely from schema field names.

## P6. Documentation misidentifies Cursor-owned mechanisms

`src/index.ts` and `docs/parity.md` describe `create-skill` as a Cursor built-in and describe `/loop` as a missing host scheduler.

`/Users/josh-desktop/Documents/RE/re-cursor-agent/re/70_model/architecture.md:34-38` and `re/50_source/loopgoal/FINDINGS.md` distinguish these mechanisms. `create-skill` and `loop` are server-synced skills. The client-native skill handler is `/skills`. Local looping uses background shell output notifications; cloud looping uses timer subscriptions. `/goal` has a separate active-goal continuation protocol. `/automate` has no local handler in the inspected CLI.

Smallest correction is precise wording. Required synced skill instructions and host facilities are absent; do not imply a native `/loop` scheduler was observed. These evidence corrections do not require inventing a scheduler or an undocumented service adapter.

## P7. Literal AGENTS constraints already conflict with preserved source

The active generated `skills/poteto-mode/scripts/orch/store.ts` has 1607 lines. `skills/poteto-mode/scripts/watch-pr/policy.ts` has 832. Their archived counterparts are identical. Both exceed the repository's 800-line maximum. Generated and archived helpers also use mutable state, as do the generator and runtime. `scripts/resources.mjs` and `scripts/verify-cli.mjs` use `console.log`, contrary to the explicit checklist.

The file-size observation is a direct measurement. It is not a reason to modify binary assets, JSON inventories, or lockfiles whose formatting line count does not describe source-module cohesion. Runtime and generator checks do not establish 80% coverage of every preserved/helper implementation.

Smallest local console correction is `process.stdout.write` with preserved newline output. Larger source compliance changes need behavior-preserving active-source transforms or an explicit source/archive classification. Existing resource validation requires archived byte identity and generated-copy identity. Refactoring only a generated file makes that check fail. Treating archives as evidence is a defensible scope distinction, but cannot honestly be described as literal zero exceptions across all files.

## P8. Pi structured prompt deltas require a mutation boundary

The installed official `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:101` says to prefer changing `systemPromptOptions` sections, tools, or guidelines so Pi can append a transcript delta. Returning `systemPrompt` or setting `forceSystemPrompt` replaces the prompt for that run while the transcript continues recording structured sections.

Installed `dist/core/extensions/types.d.ts:563` explicitly calls these mutable sections and states that later handlers observe earlier mutations. `dist/core/extensions/runner.js:1016-1059` creates one `currentOptions`, passes it to every handler, and only consumes returned `message` and `systemPrompt` fields. It does not consume a returned immutable section patch. Reassigning the event's `systemPromptOptions` also does not replace the runner's retained `currentOptions`.

Therefore immutable business-state construction is possible, but literal zero mutation while retaining the official structured-delta behavior is not possible through this API. Replacing `sections` with a newly constructed object still mutates the SDK-owned options object. Returning a full `systemPrompt` is supported but changes provider/transcript behavior and loses section-delta parity. A narrow host adapter with immutable internal values and one documented SDK mutation is the least intrusive compatible design, but remains an explicit exception to the literal wording.

## Preserved known renderer bugs

Team-kit `REPORT.md:54` and `re/80_tests/regress.py:149-155` characterize three renderer defects. Import filtering shifts subsequent line numbers. A removed `-- comment` is mistaken for a header. A no-newline marker becomes a numbered context row. The bundled renderer preserves them exactly. These are known source behaviors, not newly introduced parity failures. Correcting them changes parity and needs an explicit correctness rationale plus before/after fixtures; do not count their exact reproduction as accidental implementation drift.

## Limits that the audit cannot close locally

Cursor cloud worker lifecycle, credentials and connectors, unavailable model entitlements, server-synced skill text, reviewed Automations editor behavior, hosted wake mechanisms, and stochastic model compliance are not established by copying prompts or passing deterministic tests. The existing report correctly refuses a numeric 100% parity claim. Source-only model policy evidence must stay distinct from observed host dispatch. No paid-provider request, live Cursor agent run, cloud deployment, or external business-service action was performed by this audit.

## Follow-up doctor inventory inspection

`skills/doctor/scripts/inventory.py` has these independently inspected problems. This reviewer did not edit the script.

- `newest_prompt` falls back to all one-level workspace session directories if the requested workspace directory is absent. A temporary fixture for a foreign workspace returned its `foreign` prompt section when invoked for an unrelated requested cwd. Filter by validated session header cwd before reconstructing any prompt. No match should return no prompt.
- `scan_usage` filters raw lines using the exact compact JSON substring `"role":"user"`. Equivalent valid spaced JSON is skipped. Temporary fixtures produced empty usage for spaced JSON and one explicit `example` skill invocation for compact JSON. Parse JSON before inspecting validated message fields.
- `newest_prompt` raises on malformed JSON lines. A temporary malformed compact system record reproduced `JSONDecodeError`. Handle bad records without losing the entire inventory, and validate decoded object/message/section shapes before access. `scan_usage` also assumes decoded objects and valid content shapes after parsing.
- `scan_skills` uses `os.walk(..., followlinks=True)` without visited-directory tracking. Its seen set tracks only discovered skill files and cannot prune symlink directory cycles. Track visited directory identities and prune repeated directories. This is source evidence, not a timed hang reproduction.
- `package_dir` resolves all npm packages under the user agent directory. Official installed `dist/core/package-manager.js:1729` resolves project packages under `<cwd>/.pi/npm/node_modules`. Use the settings scope when estimating package locations. The existing doctor prose correctly calls estimates non-authoritative, but the deterministic project case can be accurate.
- Main ignores project `sessionDir` and leaves relative session roots dependent on the process cwd instead of the requested `--cwd`. Official installed `docs/settings.md:48` says relative sessionDir resolves from working directory and documents environment/CLI precedence. Resolve effective settings before scanning and anchor the path to the requested workspace.

Recommended fixtures cover foreign workspace exclusion, matching custom-session-root headers, malformed and non-object JSON, equivalent JSON formatting, symlink cycles, project npm installation roots, project-over-user sessionDir, environment/CLI overrides, and relative paths with `--cwd` different from process cwd.
