# Team-kit runtime review

## Scope and independence

A GPT agent reviewed src/personas.ts, the workers.ts changes, the index.ts prompt hook, and their tests. This reviewer implemented the resource generator changes but did not implement this runtime. This is an independent implementation review within one model family. It does not satisfy cross-family review requirements.

The review read the bundled Comment Sicko instructions and the local no-comments skill. Application code was not edited.

## Verdict

No blocking defect was established in the reviewed runtime changes. The tests passed against the actual Pi SDK. The remaining host gaps are explicit in the prompt contract.

## Findings and evidence

1. Model precedence preserves caller intent. workers.ts chooses the explicit Task model, then the persisted model on resume, then the persona default. ci-watcher requests fast only when neither override exists. The real child test proves that an unavailable fast selector fails, an explicit configured model succeeds, and its resumed task keeps the selected model. No arbitrary provider substitution is present.
2. Source persona fidelity is preserved. readPersona returns complete source files. Poteto retains its complete mode body and both Comment Sicko spellings resolve to the same file. The thermo persona also receives its complete rubric despite the rubric's disable-model-invocation frontmatter. Unit tests compare the complete persona content with the preserved files. The child provider captures the actual system messages and sees both the thermo persona and its approval bar.
3. The alwaysApply rules reach the root independently of sticky mode. index.ts uses before_agent_start and systemPromptOptions.sections. The real SDK integration test observes the rules before entering Poteto mode and after turning it off.
4. Normal children receive the rules through the loaded extension hook. The child provider's captured system messages contain both rule bodies. Readonly children receive them through DefaultResourceLoader appendSystemPrompt because their extensions are disabled. The readonly test observes the actual loader's appended instructions before the expected provider credential failure. This proves the configured prompt inputs, but not a successful readonly provider request.
5. Existing lifecycle paths are unchanged by the runtime diff. The real child suite still covers foreground and background completion, provider failure, resume after reopening, cancellation, nested child cleanup, and startup cancellation. All passed in the independent rerun.
6. Unsupported Cursor shell and explore roles fail explicitly. The host contract identifies these gaps. It does not claim that the team-kit bundle supplies Cursor's unpublished built-in persona behavior.

## Comment audit

No comments or TypeScript/lint suppressions occur in the changed runtime or scoped test code. The text search matched only an HTTPS fixture URL. There were zero deletions, zero restored comments, zero MUST KILL findings, zero reruns, and no constraint encoding proposals. No application fix or architect sketch was required.

## Commands run

From extensions/pi-pstack:

```sh
node --import tsx --test test/personas.test.ts test/workers.test.ts
npm run typecheck
node --import tsx --test test/integration.test.ts
```

The first command passed 10 tests. The integration command passed 10 tests. TypeScript passed. No external model inference, GitHub operation, browser installation, or cloud task was performed.

## Official source checked

The official Pi source was read at commit 2b0a123de98318c2ff8069661721ce0c3794c34e, version 0.87.1.

- packages/coding-agent/docs/extensions.md documents before_agent_start mutations to structured system prompt sections.
- packages/coding-agent/src/core/resource-loader.ts resolves appendSystemPrompt inputs and returns them through getAppendSystemPrompt.
- packages/coding-agent/src/core/agent-session.ts consumes those appended instructions in _rebuildSystemPrompt and prepares structured prompt options before model calls.
- packages/coding-agent/docs/skills.md defines explicit native skill invocation and disable-model-invocation behavior.

## Limits

These checks establish resource loading, instruction delivery, model selection, and local task lifecycle behavior. They do not establish that a model follows every supplied instruction. The readonly provider request remains untested because the deterministic provider is itself an extension and readonly workers intentionally disable extensions. Actual Cursor cloud agents, hosted automation, unpublished shell/explore personas, and Cursor's fast model routing remain unavailable. The source bundle adds no /loop or /goal runtime. Full behavior parity is not established.
