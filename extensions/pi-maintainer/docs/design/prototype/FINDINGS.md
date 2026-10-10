# Prototype: Aider-style reply-text loop on real Pi 1.1.0

Run: `PROTO_NO_TOOLS=1 pi --no-extensions -e proto.ts --provider proto --model scripted --no-session --no-skills --no-context-files --offline -p "make the edit"` in an empty dir. The extension registers a scripted provider that logs every request it receives (log.jsonl).

Observed (print mode):
1. `turn_end` fires for a reply with no tool calls: turnIndex 0, toolResults 0, outcome "completed", continue false, canContinue false.
2. Returning `{ entries: [{ type: 'custom_message', customType, content, display: true }], continue: true }` from `turn_end` makes Pi send one more provider request. The custom message reaches the provider as a `user` message after the assistant reply. It is retained in the in-memory conversation (the next `context` event lists `custom:aider-reflection`). Disk persistence and restart recovery were not tested because this run used `--no-session`. This is Aider's reflection: the reflected message as a new user turn.
3. `before_agent_start` fires once per run, not for the `turn_end` continuation. Prompt changes needed mid-run cannot come from it.
4. `systemPromptOptions.customPrompt` replaces Pi's preamble. The provider receives a system message with sections `{ preamble: <customPrompt>, cwd: "<cwd>...</cwd>" }` in this isolated run. Context files and skills were disabled, so their interaction was not tested.
5. `pi.setActiveTools([])` in `session_start` sends zero tools to the provider.
6. A `context` handler can prepend synthetic user and assistant messages; the provider receives them in order. They are request-local: the next `context` event does not contain them.
7. In print mode `ctx.hasUI` is false and `ctx.ui.confirm(...)` resolves false without blocking.

## Persistent-session follow-up

`persistence.sh` ran the same throwaway extension with Pi 1.1.0 in a newly initialized Git repository. The first process used a persistent session directory and made two provider requests. Its JSONL session contains one `aider-reflection` custom message. A second process reopened that session, accepted one new user prompt, and made one provider request containing that reflection as a user message.

Observed output is saved in `persistence-artifacts/observations.json`. Raw request logs and a session snapshot are in the same directory. The actual scratch run was `/tmp/pi-maintainer-persistence.7iEUrx`.

This demonstrates disk persistence and context reconstruction after reopening for this isolated print-mode case. It does not test crash recovery, branch navigation, compaction, RPC UI, or production pi-maintainer lifecycle behavior. The second request had explicit new user input. It does not demonstrate a durable continuation ticket or authorize replay of file mutations.
