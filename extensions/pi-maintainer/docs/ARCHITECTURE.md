# pi-maintainer architecture

pi-maintainer runs Aider's coder inside Pi. The model writes Aider's edit formats in its reply. The extension applies them, checkpoints and commits through Git, supplies a ranked repository map, and asks for lint and test repairs. The target is behavioral parity with Aider at commit `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`, as described by the four reconstructions pinned in `parity/sources.json`.

Behavior that Pi's public API cannot express is a ledger row with `gap: "native"` and an eight-answer entry in `docs/NATIVE-GAPS.md`; `node scripts/check-parity.mjs --final` stays red until those rows verify. `parity/options.json` disposes of every Aider long option as registered or explicitly nonclaimed.

This file is the contract every contributor and delegate builds against. `parity/PORTING.md` is the recipe for porting one Aider module. `parity/README.md` defines the ledger and the gate.

## Binding operator decisions

These were answered by the operator and are recorded in `docs/decisions.tsv`. Do not reopen them.

1. **Edit protocol.** Aider's reply-text formats (`diff`, `diff-fenced`, `whole`, `udiff`, `udiff-simple`, `patch`, the `editor-*` variants, `architect`, `ask`, `context`), applied through Pi hooks. While a maintainer coder is active, the model has no tools, exactly as Aider's model has none.
2. **Defects.** Every documented Aider defect is fixed, and the fix keeps the behavior Aider intended. A fix is a ledger `fix` row that cites the intent evidence.
3. **Names.** Every Aider-branded identifier comes from `src/branding.ts`.
4. **Chat files.** Aider's two sets, editable and read-only, with Aider's semantics, held as Pi session state.
5. **Order.** One SAR at a time: edit, then git, then map, then lint. A SAR starts only when the previous one passes its gate.

## Symmetric layout

The four SARs are four directories with the same shape. A reader who knows one knows all four.

```text
src/
  index.ts            default factory: installMaintainer(pi, [edit, git, map, lint])
  branding.ts         Pi names for Aider identifiers
  feature.ts          the Feature contract below
  settings/           one option registry and one resolver for all four SARs
  core/               the coder hub (Aider's base_coder) and the only Pi lifecycle adapter
  edit/  git/  map/  lint/
    feature.ts        export const <sar>Feature: Feature<Port>
    options.ts        every option the SAR documents, as OptionSpec values
    commands.ts       every slash command the SAR documents, as CommandSpec values
    <module>.ts       oracle-verified ports of the SAR's Aider modules; no Pi imports
  support/            Python semantics shared by ports (pystr, difflib, ...)
test/
  <sar>/              oracle tests, ported Aider tests, Pi integration tests
  support/
parity/
  oracle/ops/<sar>_<module>.py
  journeys/<sar>/     real-Pi journey scripts and their saved artifacts
```

Rules that keep the symmetry real:

- Only `src/core/` calls `pi.on`, `pi.registerCommand`, `pi.registerFlag`, `pi.registerVirtualModel`, `pi.appendEntry`, `pi.sendMessage`, `pi.sendUserMessage`, and `pi.setActiveTools`. A SAR declares options, commands, and its port. The core registers them. This keeps one Pi adapter, so Pi-native compliance is reviewed in one place.
- Ports never import Pi. They receive what they need (a `WorkingTree`, a `Host` with UI and process capabilities, resolved settings) as arguments.
- Every SAR registers through the same three lists: `options`, `commands`, and one port. No SAR has a private registration path.

## The Feature contract

```typescript
type SarName = 'edit' | 'git' | 'map' | 'lint';

interface Feature<Port> {
  readonly name: SarName;
  /** Every documented option of this SAR, with Aider's CLI default and help text. */
  readonly options: readonly OptionSpec[];
  /** Every documented slash command of this SAR. */
  readonly commands: readonly CommandSpec[];
  /** Builds this SAR's lifecycle port from resolved settings and host capabilities. */
  readonly create: (env: FeatureEnv) => Port;
}
```

The ports are the named extension points of the lifecycle base design (`docs/design/lifecycle-base/USAGE-AND-SHAPE.md`):

| SAR | Port | Aider owner |
| --- | --- | --- |
| edit | `EditFormats` registry and chat modes | `aider/coders/*_coder.py`, `aider/coders/__init__.py` |
| git | `GitPolicy` | `aider/repo.py`, Git parts of `base_coder.py` |
| map | `RepositoryContext` | `aider/repomap.py`, map parts of `base_coder.py` |
| lint | `Validation` | `aider/linter.py`, `aider/run_cmd.py`, lint and test parts of `base_coder.py` and `commands.py` |

Every edit format implements one `EditFormat` interface, mirroring Aider's coder methods: `getEdits(reply, ctx)`, `applyEditsDryRun(edits, ctx)`, `applyEdits(edits, ctx)`, and its prompts. Each format keeps its own edit tuple type, as Aider does. Before a SAR lands, the core uses that SAR's explicit disabled port, which claims no parity.

## One settings mechanism

`OptionSpec` carries Aider's long option name (`auto-commits`, `lint-cmd`, `map-tokens`), its kind (`boolean`, `string`, `int`, `float`, `list`, or `tristate`), Aider's CLI default, Aider's help text, and the owning SAR. The resolver applies Aider's configargparse precedence for every SAR identically:

1. The Pi CLI flag of the same name, registered with `pi.registerFlag`.
2. The environment variable `PI_MAINTAINER_<NAME>`, the Pi spelling of `AIDER_<NAME>`.
3. The YAML config files `.pi-maintainer.conf.yml` in the home directory, the Git root, and the working directory, later files winning, as Aider reads `.aider.conf.yml`.
4. Aider's default.

`.env` files are read in Aider's order (home, Git root, working directory, override). They feed option resolution and the environment of commands pi-maintainer runs, including Git, `/git`, attribution commits, lint, test, and shell suggestions, through `Host.exec`. They never change Pi's own process environment, because provider credentials are Pi-owned. Where `pi.registerFlag` cannot express an Aider option kind (repeatable or negated flags), the gap and its adapter go in `docs/NATIVE-GAPS.md`.

## Lifecycle mapping

The lifecycle base design is candidate 2 of the lifecycle arena, an exchange controller whose `completeReply` mirrors `send_message`, with the grafts listed in `docs/design/lifecycle-arena-synthesis.md`. `docs/design/lifecycle-base/PI-WIRING.md` holds the hook plan and its evidence.

| Aider | Pi mechanism |
| --- | --- |
| User input and slash commands | Pi input, `pi.registerCommand` |
| `send_message` reply processing | `turn_end`, calling `ExchangeController.completeReply` |
| Reflection, mentions, editor input | `turn_end` returns `[...event.entries, custom_message]` and `continue: true`, guarded by the reflection budget |
| `format_messages` and `ChatChunks` | `context_with_system`, a documented gap because Pi has no mid-run structured prompt setter |
| Main, editor, and weak models | `pi.registerVirtualModel` routing to physical models from `ctx.modelRegistry` |
| Provider transport, streaming, retries, cost | Pi-owned |
| Done-history summarization | `ctx.compact()` at `--max-chat-history-tokens`, summarized through `session_before_compact` with Aider's prompt and the weak model (`docs/NATIVE-GAPS.md`) |
| Chat file sets, mode, assistant commit hashes | `pi.appendEntry` snapshots, restored from `ctx.sessionManager.getBranch()` on `session_start` and `session_tree` |
| Confirmations | `ctx.ui.confirm` and `ctx.ui.select` through the core `Host`, with Aider's non-interactive answers when `ctx.hasUI` is false |
| Shell, lint, test, and Git commands | `pi.exec`, or the documented `Host.exec` environment adapter; a documented gap where Aider needs an interactive PTY |
| Commit messages | `ctx.modelRegistry.complete`, Aider's commit prompt, weak model first then main, main model name in the Co-authored-by trailer |
| Console output (`tool_output`, `tool_warning`, `tool_error`) | `ctx.ui.notify` with a UI, stderr in print and JSON, always a session notice entry (`docs/NATIVE-GAPS.md`) |
| No tools for the model | `pi.setActiveTools([])` while a maintainer coder is active, and `tool_call` blocks a stray call |
| File writes | `WorkingTree`, inside `withFileMutationQueue` |

## Native gaps

`docs/NATIVE-GAPS.md` lists every custom adapter with the eight native-gap answers that file defines. A custom adapter without an entry fails review.

## Test layers

1. **Oracle ports.** Each ported function matches Aider's own Python on recorded goldens, per `parity/PORTING.md`.
2. **Pi integration.** Vitest drives the real Pi SDK in process (an `AgentSession` over `SessionManager.inMemory()` with a scripted provider), so hooks, entries, continuation, and branch restore are exercised, not mocked.
3. **Journeys.** `parity/journeys/<sar>/` scripts run the real `pi` binary in print and RPC modes with a scripted provider, load the shipped factory from `src/index.ts`, and save their artifacts. `bun run journey:edit` proves edit, Git checkpointing, commit-message generation, and console output end to end.

## Code rules

The code rules in `parity/PORTING.md` apply to every file, including the core.
