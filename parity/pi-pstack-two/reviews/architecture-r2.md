# pi-pstack-two round 2 review: architecture and maintainability

I checked every Pi API the extension uses against the installed 1.1.0 `.d.ts` files and `dist/` code. None of the APIs are invented, and all are used as documented:

- **Prompt sections:** `before_agent_start` changes `systemPromptOptions.sections` in place, which `types.d.ts:716` documents as allowed.
- **Settle and completion:** `agent_before_settle` returns `{entries, continue}`. `agent_settled` uses `aborted`.
- **Tool registration:** `exposure: 'model-only'`, `executionMode`, `defaultActive`, `promptSnippet`, `promptGuidelines` and `annotations` all match the declared types.
- **Messages and commands:** the `sendMessage` and `sendUserMessage` options match, and so do `getCommands().sourceInfo`, `setActiveTools` and `getActiveTools`.
- **Autocomplete:** `addAutocompleteProvider` is reset both on `/reload` and on session replacement (`interactive-mode.js:367,1898-1916`).
- **Stale context:** session replacement rebuilds the runtime (`agent-session-runtime.js` `createRuntime`), so the `retired` flag, the loop and the watchdog state do not carry into the new session.

`tsc` is clean, and `npx vitest run` passed: 23 files, 218 tests.

## Confirmed defects

**1. The README, `decisions.md` and the ledger say background usage is in "the notification details". It is not. (medium)**
- **Where the claim is made:** `README.md:62`, `parity/pi-pstack-two/decisions.md:91`, `ledger.json:286,288`.
- **What the code does:** `NotificationFields` (`src/task/format.ts:32-38`) holds only `status`, `agentId`, `title`, `toolCallId` and `detail`. `backgroundNotice.detailFor` (`src/task/tool.ts:151-155`) returns only status and detail. `registry.ts:43` delivers exactly those fields.
- **Effect:** background usage is collected (`runner.ts:186`) and then thrown away. It reaches neither the totals nor the notification. The only fallback named for TASK-017 does not exist.

**2. Foreground Task usage leaves out the child's nested usage, so TASK-014's VERIFIED overstates the accounting. (medium)**
- **Where:** `src/task/runner.ts:103` keeps only `message_end` events whose role is `assistant`.
- **What gets dropped:** a depth-1 child has Task active (`tool.ts:182`). When it runs a foreground grandchild, that usage sits on the child's `toolResult` message, which is the same mechanism TASK-014 relies on. `getSessionStats` counts `toolResult.usage` (`agent-session.js:3404-3408`), but the parent never adds it. The same goes for:
  - codemode or any other extension tool in the child that reports nested usage;
  - the child's own compaction and branch-summary usage.
- **Rule broken:** `extensions/AGENTS.md` says "If a tool makes nested model calls, include their usage."
- **Not caught:** no test covers nested usage.

**3. The child's stdin has no `'error'` listener, so an EPIPE crashes the parent Pi. (low)**
- **Where:** `runner.ts:194` (`child.stdin.end(options.prompt)`), with no `child.stdin.on('error')`.
- **Reproduced in Node 24:** spawning a child that exits without reading stdin and writing a 2 MB prompt gives `Unhandled 'error' event … EPIPE`, and the process exits.
- **When it can happen:** a prompt larger than the pipe buffer (about 64 KB) plus a child that exits before reading stdin. Pi reads stdin before most of its validation (`main.js:724-726`), so most startup errors are safe; I confirmed that an invalid model or `-e` path does not trigger it. Pi still exits before reading stdin on argument and session errors (`main.js:241-325`, `563-571`).
- **Severity:** the trigger is narrow, but the result is a crash of the user's whole Pi session, not one failed Task.

**4. Skill discovery is still split two ways, and the two answers disagree. (low)**
- **Two sources:** `index.ts:74` builds `sortedSkillNames` by scanning the directory (`shippedSkillNames`). The aliases use `pi.getCommands()` (`index.ts:79,81`).
- **Where the scan is used:** it feeds the `pstack_host` line "Installed skills (N): …" (`sections.ts:33`), the `/mode` fallback (`mode.ts:83`) and the `/mode` completions (`mode.ts:111`).
- **Effect:** a skill the user's settings filter out gets no alias, as D2 intends. It is still listed to the model as installed, and it can still back `/mode`, even though it never loaded.
- **Partly undoes a recheck fix:** the round-1 fix (architecture 6) was meant to leave one discovery path.

**5. Old agent records stop working for resume after the resync, and nothing says so. (low)**
- **Where:** `planResume` (`tool.ts:94`) calls `findAgent(agents, record.type)`.
- **Effect:** a record written under 0.15.17 with `type: "Comment Sicko"` now fails with `Unknown subagent_type "Comment Sicko"`. That message is confusing for a resume call.
- **Related:** `readRecord` (`records.ts:26`) parses JSON without validation, so a corrupt record shows up as a raw `SyntaxError`. The repo's input-validation rule applies here.

**6. The native-gap table in `decisions.md` does not fully meet the `extensions/AGENTS.md` gate. (low)**
- **Missing item:** there is no "smallest adapter" answer.
- **Incomplete verification:** the Task row's verification column does not cover two of the required axes:
  - Accounting: TASK-017 and defect 2 above.
  - Permissions: children run headless, in JSON mode with no UI, so any permission extension that relies on `ctx.ui.confirm` cannot ask the user. The README does not mention this either.
- **Undeclared copies of Pi-owned logic, which will drift silently:**
  - `workspaceSlug` (`paths.ts:21`) copies the private `getDefaultSessionDirPath` (`session-manager.js:293`). `worktree-audit.sh` copies it a second time (`pi_slug`).
  - `resolveToolPath` (`rule.ts:26`) copies the private `resolveToCwd`.
  - `modeSection` (`mode.ts:44-56`) copies the skill-block format.
  - `bounded` (`task/format.ts:6`) writes its own truncation, although Pi exports `truncateHead` and `DEFAULT_MAX_BYTES`. This one is a plain native-first miss: unlike Pi's convention it has no line cap.
- The other copies have comments in the code, but none appears in the gate table.

## Suspicions and questions

- **Is TASK-017 NOT VERIFIED right?** The verdict holds, but the reasoning is incomplete. A public channel exists that D4 never considers:
  - **The channel:** `ToolResultEventResult.usage` (`types.d.ts:1090-1096`) lets a `tool_result` handler set usage on any tool result. `runner.js:930` applies it, and `getSessionStats` counts it over all entries.
  - **How it could be used:** the extension could carry pending background usage and attach it to the parent's next tool result.
  - **Why it only partly works:**
    - It needs a later tool call, which a notification turn may not make.
    - It charges the usage to an unrelated call.
    - The print-mode settle continuation may end with no tool call at all.
  - **Ruled out:** `message_end` replacement would distort `getContextUsage`, so it is not suitable. A `CompactionEntryDraft` actually compacts the session.
  - **Conclusion:** there is no complete public mechanism, so NOT VERIFIED stands. D4 and the ledger should still record this channel and why it was rejected. The current wording, "no public way … outside a tool result", already half-concedes it.
- **Readonly children lose `TodoWrite`.** `--tools read,grep,find,ls` is an allowlist that covers extension tools (`docs/cli.md:120`). That is correct for `Task`, but a readonly reviewer told to keep a todo list will fail. This is not documented.
- **The root chat can resume a grandchild.** Agent IDs are scoped to the workspace, not the depth. If the root chat resumes an agent created at depth 2, it runs at depth 1 with Task active, which gets around TASK-011. I have not exercised this.
- **The settle hold ignores the run's outcome.** `registry.beforeSettle` (`registry.ts:50-55`) ignores `event.outcome` and `context.canContinue`. After an `error` or `aborted` outcome in print or JSON mode, it still waits and returns `continue: true`. I did not check what Pi does with that.
- **Per-keystroke cost.** Every keystroke in the `/` menu, and every `input` event, rebuilds `aliasTable` with about 55 `realpathSync` calls (`aliases.ts:17-25`). Caching per `session_start` would be simpler.
- **`loop.lastCtx` (`loop.ts:39,57`).** It is kept between settles and only read while a loop is active. It is safe today, but it holds on to a context object.

## Overall assessment

The architecture is mostly sound and Pi-native. Each Cursor host feature maps to the least powerful Pi mechanism that does the job:
- Skill aliases use an `input` transform.
- `/mode`, the model rule, the host map and `/loop` state use prompt sections.
- The todo list uses branch-aware tool-result details.
- Tool availability uses `defaultActive` and `setActiveTools`.
- The one-shot hold uses `agent_before_settle`.

The custom harness, meaning the child processes, the run lock and the parent-pid watchdog, is justified by real API gaps. It respects the factory/session-lifetime rule, and I found no invented or stale-context API use. The weak spot is accounting:
- The documented fallback for background usage does not exist.
- Foreground usage leaves out nested child usage.
- The TASK-017 gap analysis misses the `tool_result` usage channel.

These should be fixed, or at least documented honestly, before the ledger's VERIFIED claims for TASK-014 can be trusted. The rest are maintainability items: copies of private Pi logic that are not declared in the gate table, an incomplete gate table, and a second skill-discovery path. The stdin EPIPE crash is the one robustness bug.
