# Pi Reference-style UI extension implementation specification

> **Status:** implementation-ready
>
> **Reference baseline:** Pi `0.87.1`, released 2026-09-22
>
> **Specification date:** 2026-09-28
>
> **Visual reference from the originating session:** `reference-cli.mov`
>
> **Primary requirement:** change Pi Coding Agent's presentation to resemble the reference video as closely as the documented extension API permits, while adding no new agent capabilities and changing no existing Pi behavior.

---

## 1. Read this first

This document is the implementation contract.

The implementation MUST use only:

- current official Pi documentation,
- current public exports from official Pi packages, and
- current examples in the official `earendil-works/pi` repository.

The implementation MUST NOT depend on:

- undocumented internal APIs,
- deep imports from Pi's `src/` tree,
- monkey-patching,
- prototype replacement,
- direct terminal ownership outside Pi's TUI component system,
- a second terminal renderer,
- modifications to Pi core,
- changes to the model prompt or conversation context,
- new tools, commands, modes, or agent features created only to mimic the reference video.

If this specification conflicts with newer official Pi documentation at implementation time, the newer official documentation wins. Record the conflict and adapt the implementation without weakening the behavior-preservation requirements.

---

## 2. Goal

Create one Pi package that contains:

1. one TUI-focused extension, and
2. one Pi theme.

The package should make Pi look like the reference video wherever Pi exposes a documented presentation hook.

The package should preserve stock Pi semantics.

### Required invariant

Running the same user workflow with and without this package MUST preserve:

- user input meaning,
- model selection,
- thinking level,
- system prompt,
- active tools,
- tool schemas,
- tool arguments,
- tool execution,
- tool result content,
- steering behavior,
- follow-up behavior,
- cancellation behavior,
- slash-command behavior,
- `@` file behavior,
- `!` and `!!` shell behavior,
- session tree behavior,
- compaction behavior,
- model-facing conversation context,
- provider behavior.

Only presentation may change.

---

## 3. Normative language

The words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are requirements in this document.

### Fidelity labels

- **Exact**: Pi exposes a documented extension mechanism that can reproduce the visual or interaction shape without changing semantics.
- **Approximate**: Pi exposes enough presentation control to get close, but Pi retains part of the rendering or the video uses semantics Pi does not have.
- **Not possible**: reproducing the item would require changing Pi core, owning terminal behavior outside Pi, or adding a capability that stock Pi does not provide.

---

## 4. Source authority

Use sources in this order:

1. `https://pi.dev/docs/latest/...`
2. public exports from `@earendil-works/pi-*`
3. examples under the official `earendil-works/pi` repository
4. official Pi source only to confirm public API behavior

Do not use third-party Pi extension examples as API authority.

### Current official references

- Extensions: https://pi.dev/docs/latest/extensions
- Terminal UI: https://pi.dev/docs/latest/tui
- Themes: https://pi.dev/docs/latest/themes
- Packages: https://pi.dev/docs/latest/packages
- Settings: https://pi.dev/docs/latest/settings
- Keybindings: https://pi.dev/docs/latest/keybindings
- Usage: https://pi.dev/docs/latest/usage
- Session file format: https://pi.dev/docs/latest/session-format
- Changelog: https://pi.dev/changelog
- Official extension examples:
  - https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions
- Built-in tool renderer example:
  - https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/built-in-tool-renderer.ts
- Minimal mode example:
  - https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/minimal-mode.ts
- Custom footer example:
  - https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/custom-footer.ts
- Question example:
  - https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/question.ts
- Public extension types:
  - https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts
- Public package exports:
  - https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/index.ts

---

## 5. Official mechanisms selected for this implementation

| Need | Official Pi mechanism |
|---|---|
| Extension entry point | default-exported factory receiving `ExtensionAPI` |
| TUI-only guard | `ctx.mode === "tui"` |
| Header replacement | `ctx.ui.setHeader()` |
| Footer replacement | `ctx.ui.setFooter()` |
| Main editor replacement | `ctx.ui.setEditorComponent()` |
| Preserve editor/app keybindings | subclass `CustomEditor`; delegate unhandled input to `super.handleInput(data)` |
| Embed working status in editor | `CustomEditor` with `{ embedWorkingStatus: true }` |
| Terminal title | `ctx.ui.setTitle()` |
| Theme selection | `ctx.ui.setTheme()` |
| Persistent near-editor content | `ctx.ui.setWidget()` |
| Working message | `ctx.ui.setWorkingMessage()` |
| Working visibility | `ctx.ui.setWorkingVisible()` |
| Working spinner frames | `ctx.ui.setWorkingIndicator()` |
| Hidden thinking label | `ctx.ui.setHiddenThinkingLabel()` |
| Tool expansion state | Pi's normal expanded state, plus `getToolsExpanded()` / `setToolsExpanded()` only if needed |
| Tool rendering | same-name `pi.registerTool()` overrides with `renderCall()` and `renderResult()` |
| Preserve built-in tool behavior | delegate `execute()` to Pi's official built-in tool factory result |
| Model data | `ctx.model` |
| Thinking level | `ctx.thinkingLevel` |
| Context usage | `ctx.getContextUsage()` |
| Git branch in footer | `FooterDataProvider.getGitBranch()` |
| Branch-change redraw | `FooterDataProvider.onBranchChange()` |
| Lifecycle observation | `pi.on(...)` notification events |
| TUI width handling | `visibleWidth()`, `truncateToWidth()`, `sliceByColumn()`, `wrapTextWithAnsi()` |
| Theme colors | callback-provided `theme`, semantic theme roles |
| Built-in tool factories | package-root exports such as `createReadTool()`, `createBashTool()`, `createEditTool()`, and the other documented built-ins |

Pi explicitly says not to create a second terminal renderer inside an extension.

---

## 6. Hard behavioral boundaries

### The extension MAY own

- theme colors,
- header rendering,
- footer rendering,
- editor rendering,
- editor borders,
- editor placeholder text,
- terminal title,
- working-indicator appearance,
- working-message text,
- presentation-only activity widgets,
- tool-call rendering,
- tool-result rendering,
- spacing,
- truncation,
- durations calculated only for display.

### Pi MUST continue to own

- the model,
- the system prompt,
- thinking semantics,
- user input semantics,
- application keybindings,
- slash commands,
- file autocomplete,
- shell prefixes,
- queue behavior,
- steering,
- follow-ups,
- cancellation,
- active tool selection,
- tool schemas,
- tool arguments,
- tool execution,
- tool results,
- tool concurrency,
- session persistence,
- session tree,
- compaction,
- model context,
- provider requests.

### Strict skin rule

The extension MUST NOT call these APIs as part of normal visual operation:

- `pi.sendMessage()`
- `pi.sendUserMessage()`
- `pi.appendEntry()`
- `pi.setActiveTools()`
- `pi.setModel()`
- `pi.setThinkingLevel()`
- `ctx.abort()`
- context-transforming lifecycle hooks
- prompt-changing lifecycle hooks
- tool-blocking lifecycle hooks

Those APIs are documented, but they change behavior or session data. This project is a skin.

---

## 7. Video-to-Pi mapping

### 7.1 Window and terminal chrome

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| macOS traffic-light buttons | none | Not possible | Leave to terminal/window manager. |
| Rounded window frame | none | Not possible | Leave to terminal/window manager. |
| Window/tab title `agent` | `ctx.ui.setTitle("agent")` | Exact within terminal support | Set title in TUI sessions. |
| Font family, font size, font smoothing | none | Not possible | Do not attempt to control terminal font. |
| Near-black terminal canvas | theme plus terminal background | Approximate | Theme Pi-owned cells; document that blank terminal background remains terminal-owned. |

### 7.2 Global palette and layout

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| Gray, white, green, and purple palette | Pi theme JSON | Exact for Pi-owned cells | Define semantic theme roles, not raw ANSI in components. |
| Fullscreen transcript with fixed composer/footer | Pi fullscreen TUI mode | Exact when user runs fullscreen mode | Do not implement a second viewport. |
| Scrollbar | Pi fullscreen scrollbar settings and theme roles | Exact | Skin `scrollbarTrack` and `scrollbarThumb`. |
| Narrow transcript margins | Pi layout settings where available plus component padding | Exact or near-exact | Do not reflow core transcript outside documented controls. |

### 7.3 Startup/header area

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| `> agent` startup line | `ctx.ui.setHeader()` | Exact | Render in custom header. |
| Product/agent identity line | `ctx.ui.setHeader()` | Exact visually | Identify the product truthfully as Pi. |
| Current directory | `ctx.cwd` | Exact | Shorten home directory to `~` for display. |
| Git branch | footer provider or another documented source | Exact when available | Prefer footer provider ownership for branch state. |
| Startup block above transcript | `setHeader()` | Exact | Let Pi own scroll behavior. |

### 7.4 Composer/editor

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| Large bordered input | `setEditorComponent()` + `CustomEditor` | Exact | Replace main editor through documented factory. |
| Green idle border | custom editor render + theme | Exact | Use semantic theme color. |
| Alternate border color for real Pi state | custom editor render + theme | Exact visually | Bind only to real Pi state. |
| Text reference/input contents | inherited `CustomEditor` behavior | Exact | Do not reimplement editing. |
| Idle placeholder | custom editor presentation | Exact visually | Presentation only. |
| Running placeholder | custom editor presentation | Exact visually | Must not change submit behavior. |
| `esc to stop` hint | custom editor + existing Pi cancellation keybinding | Exact | Display existing behavior only. |
| User types while agent works | stock Pi queue behavior | Exact behavior | Do not intercept or reinterpret. |
| Follow-up hint | existing Pi steering/follow-up semantics | Approximate wording | Label must not imply semantics Pi does not have. |
| `&` cloud prefix | none matching stock semantics | Not possible under constraint | Do not implement. |

### 7.5 Thinking/status line

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| State dot | editor/footer/widget | Exact visually | Bind to real Pi state. |
| `Plan (shift+tab to cycle)` | `ctx.thinkingLevel` plus Pi's thinking-cycle keybinding | Approximate | Display the real thinking level instead of "Plan". |
| Reference Plan mode | none in stock Pi | Not possible | Do not create plan mode. |
| Model name | `ctx.model` | Exact | Display current model. |
| Thinking level | `ctx.thinkingLevel` | Exact | Display current value. |
| Context percentage | `ctx.getContextUsage()` | Exact | Display only when known. |
| Reference-specific `Fast` classification | no generic equivalent | Not possible or omit | Do not invent. |
| Files edited count | observed successful `edit`/`write` calls | Approximate | Count conservatively; do not infer shell edits. |

### 7.6 Footer shortcuts

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| `/ commands` | stock slash-command system | Exact | Render hint only. |
| `@ files` | stock Pi file autocomplete | Exact | Render hint only. |
| `! shell` | stock `!` shell behavior | Exact | Render hint only. |
| `!!` no-context shell behavior | stock Pi behavior | Exact | Preserve even if not shown in video. |

### 7.7 Working/activity presentation

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| Animated activity indicator | `setWorkingIndicator()` | Exact visually | Use custom frames. |
| Working text | `setWorkingMessage()` | Exact | Use truthful generic wording such as `Working`. |
| Live activity line above editor | `setWidget(..., { placement: "aboveEditor" })` | Exact layout | Derive only from observed events. |
| `Reading 2 files` style live summary | tool lifecycle events + widget | Approximate | Group only real tool activity. |
| Duration suffix | local display timer around lifecycle events | Exact | Presentation only. |
| Reference aggregate completed row | no core transcript aggregation replacement | Approximate | Prefer custom compact per-tool rows. Do not persist duplicate activity entries in strict mode. |
| `Thought 3s` | thinking presentation plus hidden-thinking label where useful | Approximate | Do not claim a semantic phase Pi did not expose. |
| `Planned 2s` | no stock phase | Not possible | Omit. |
| `Analyzing scope` | no authoritative Pi phase | Not possible as factual label | Use `Working` or `Thinking` only when supported. |

### 7.8 Tool rows

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| Compact `Read` row | same-name built-in override | Exact | Delegate execution unchanged. |
| Compact shell row | same-name `bash` / `powershell` override | Exact | Delegate execution unchanged. |
| Compact `Edit` row | same-name built-in override | Exact | Delegate execution unchanged. |
| Compact `Write` row | same-name built-in override | Exact | Delegate execution unchanged. |
| Compact `Grep` row | same-name built-in override | Exact | Delegate execution unchanged. |
| Compact `Find` row | same-name built-in override | Exact | Delegate execution unchanged. |
| Compact `Ls` row | same-name built-in override | Exact | Delegate execution unchanged. |
| Collapse/expand result details | Pi renderer `expanded` state | Exact | Preserve full information when expanded. |
| Remove default boxed shell | `renderShell: "self"` | Exact | Use only where custom renderer supplies complete framing. |

### 7.9 Question UI

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| Bordered question card | `ctx.ui.select()` or `ctx.ui.custom()` exists | Not allowed for this skin unless an existing Pi interaction already uses it | Do not add a model-callable question tool. |
| Checkbox-like options | custom TUI component is capable | Not allowed as new agent behavior | Do not create a new feature for visual parity. |
| Selection reference | Pi selection/custom component system | Exact visually when legitimately used | Use only for existing interactions. |
| Persistent question card in transcript | no global core assistant renderer replacement | Not possible | Do not fake it with context-changing messages. |

The official `question.ts` example demonstrates how an extension can add such a tool. That example proves the UI is possible, but adding the tool would violate this project's "no new features" rule.

### 7.10 Core transcript

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| User message box shape | core user renderer plus theme roles | Approximate | Theme it; do not replace the whole core transcript renderer. |
| Assistant message typography | theme and markdown roles | Approximate | Keep core message ownership in Pi. |
| Thinking block | theme plus hidden-thinking label | Approximate | Do not replace core thinking renderer with unsupported hooks. |
| Replace every built-in transcript component | no documented global replacement hook | Not possible in extension | Do not attempt. |

### 7.11 Reference-only agents/cloud behavior

| Visible element | Pi mechanism | Fidelity | Requirement |
|---|---|---:|---|
| `Spawning 3 agents` | stock Pi has no such built-in state | Not possible under constraint | Do not add subagents. |
| `Started 3 agents` | same | Not possible | Do not display. |
| Child-agent rows | requires subagent feature | Not possible | Do not display. |
| Per-agent state dots | requires subagent state | Not possible | Do not display. |
| Saving child-agent state | no stock equivalent | Not possible | Do not display. |
| Moving child agent to cloud | no stock equivalent | Not possible | Do not display. |
| `Move to cloud agent` | no stock equivalent | Not possible | Do not add. |
| Purple cloud state | no stock equivalent | Not possible semantically | Do not add. |

Pi's official repository contains subagent and plan-mode extension examples. Those examples are additional features. They are not mechanisms to use in this skin.

---

## 8. Package layout

Use this layout unless the target repository already has a stronger local convention.

```text
pi-tui-skin/
├── package.json
├── extensions/
│   └── tui-skin/
│       ├── index.ts
│       ├── state/
│       │   ├── presentation-state.ts
│       │   └── presentation-store.ts
│       ├── lifecycle/
│       │   └── register-lifecycle.ts
│       ├── ui/
│       │   ├── install-ui.ts
│       │   ├── editor.ts
│       │   ├── header.ts
│       │   ├── footer.ts
│       │   ├── activity-widget.ts
│       │   └── working-indicator.ts
│       ├── tools/
│       │   ├── builtins.ts
│       │   ├── register-tool-renderers.ts
│       │   ├── render-read.ts
│       │   ├── render-shell.ts
│       │   ├── render-edit.ts
│       │   ├── render-write.ts
│       │   ├── render-grep.ts
│       │   ├── render-find.ts
│       │   └── render-ls.ts
│       └── format/
│           ├── duration.ts
│           ├── path.ts
│           └── width.ts
└── themes/
    └── tui-skin.json
```

### Ownership

- `index.ts`: registration and wiring only
- `state/`: presentation-only runtime state
- `lifecycle/`: translate Pi events into presentation state
- `ui/`: Pi TUI components
- `tools/`: built-in execution delegation and render-only overrides
- `format/`: pure formatting functions
- `themes/`: Pi theme JSON

---

## 9. Package manifest

Pi packages can expose conventional `extensions/` and `themes/` directories automatically. An explicit manifest is preferred here because the package has one intentional entry point.

Use host-provided Pi packages as peer dependencies with `"*"`.

```json
{
  "name": "pi-tui-skin",
  "version": "0.1.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": [
      "./extensions/tui-skin/index.ts"
    ],
    "themes": [
      "./themes/tui-skin.json"
    ]
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  }
}
```

### Dependency rules

MUST:

- use Pi package-root imports,
- put Pi host packages in `peerDependencies`,
- keep unrelated runtime dependencies out unless required.

MUST NOT:

- put Pi host packages in `dependencies`,
- bundle private copies of Pi host packages,
- deep-import `@earendil-works/pi-coding-agent/src/...`.

---

## 10. State model

State exists only to render the current UI.

Use discriminated unions. Avoid optional-field bags.

```ts
export type AgentPhase =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number };

export type RunningToolActivity = {
  kind: "running";
  toolCallId: string;
  toolName: string;
  startedAt: number;
  args: unknown;
};

export type PresentationState = {
  phase: AgentPhase;
  activeTools: ReadonlyMap<string, RunningToolActivity>;
  editedFiles: ReadonlySet<string>;
};
```

### Store contract

```ts
export interface PresentationStore {
  getSnapshot(): PresentationState;

  setAgentRunning(startedAt: number): void;
  setAgentIdle(): void;

  startTool(input: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    startedAt: number;
  }): void;

  finishTool(input: {
    toolCallId: string;
    toolName: string;
    isError: boolean;
    finishedAt: number;
  }): void;

  reset(): void;

  subscribe(listener: () => void): () => void;
}
```

### State rules

- Key active tools by `toolCallId`.
- Assume tool calls can overlap.
- Store only facts required for rendering.
- Treat event payloads that Pi types as `any` as untrusted at the local boundary.
- Narrow only the fields needed for presentation.
- Do not copy assistant messages or tool result bodies into this store.
- Do not persist this store to the Pi session.

---

## 11. Extension entry point

The extension factory should register static capabilities and lifecycle handlers.

Do not start long-lived timers, processes, sockets, or watchers in the factory.

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerLifecycle } from "./lifecycle/register-lifecycle.js";
import { createPresentationStore } from "./state/presentation-store.js";
import { registerToolRenderers } from "./tools/register-tool-renderers.js";
import { installUi, uninstallUi } from "./ui/install-ui.js";

export default function tuiSkin(pi: ExtensionAPI): void {
  const store = createPresentationStore();

  registerToolRenderers(pi);

  registerLifecycle(pi, {
    store,

    onSessionStart(ctx) {
      store.reset();

      if (ctx.mode !== "tui") {
        return;
      }

      installUi(ctx, store);
    },

    onSessionShutdown(ctx) {
      if (ctx.mode === "tui") {
        uninstallUi(ctx);
      }

      store.reset();
    },
  });
}
```

Pi documents `session_start` and idempotent `session_shutdown` as the correct lifecycle boundaries for session-scoped work.

---

## 12. UI installation

Centralize every Pi UI replacement.

```ts
export function installUi(
  ctx: ExtensionContext,
  store: PresentationStore,
): void {
  ctx.ui.setTitle("agent");

  const themeResult = ctx.ui.setTheme("tui-skin");
  // Handle a failed theme lookup as a presentation error only.
  // Do not stop Pi or alter agent behavior.

  ctx.ui.setHeader(createHeader(ctx));
  ctx.ui.setFooter(createFooter(ctx, store));

  ctx.ui.setEditorComponent(
    createEditorFactory(ctx, store),
  );

  installWorkingIndicator(ctx);
  installActivityWidget(ctx, store);
}
```

### Cleanup

Restore Pi defaults on shutdown or reload.

```ts
export function uninstallUi(ctx: ExtensionContext): void {
  ctx.ui.setWidget("tui-skin.activity", undefined);
  ctx.ui.setEditorComponent(undefined);
  ctx.ui.setFooter(undefined);
  ctx.ui.setHeader(undefined);
  ctx.ui.setWorkingMessage();
  ctx.ui.setWorkingIndicator();
  ctx.ui.setWorkingVisible(true);
}
```

Cleanup MUST be safe if called more than once.

---

## 13. Custom editor

Use `CustomEditor` from `@earendil-works/pi-coding-agent`.

Do not use the base editor as the main replacement.

Use `{ embedWorkingStatus: true }` so Pi can embed supported working, compaction, branch-summary, and retry status in the custom editor rather than forcing a separate status row.

```ts
import {
  CustomEditor,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  EditorTheme,
  TUI,
} from "@earendil-works/pi-tui";

export class SkinStyleEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly store: PresentationStore,
  ) {
    super(
      tui,
      theme,
      keybindings,
      { embedWorkingStatus: true },
    );
  }

  render(width: number): string[] {
    const lines = super.render(width);
    const snapshot = this.store.getSnapshot();

    return renderCursorEditor({
      lines,
      width,
      snapshot,
    });
  }
}
```

### Input handling

Preferred implementation: do not override `handleInput()`.

If an override becomes necessary for presentation reasons:

```ts
handleInput(data: string): void {
  // Handle only the specific visual-only case.
  // For everything else:
  super.handleInput(data);
}
```

MUST preserve:

- Escape behavior,
- submit behavior,
- follow-up behavior,
- steering behavior,
- history,
- autocomplete,
- model shortcuts,
- thinking-cycle shortcuts,
- configured user keybindings.

### Editor labels

Allowed:

- `Working`
- current real thinking level
- `esc to stop`
- `/ commands`
- `@ files`
- `! shell`

Do not display:

- `Plan` as a Pi mode,
- cloud-agent state,
- subagent state,
- any label that claims a lifecycle phase Pi did not expose.

---

## 14. Header

Use `ctx.ui.setHeader()`.

The header should be stateless and cheap to render.

Suggested structure:

```text
> agent
  Pi Coding Agent
  ~/path/to/project
```

Use `ctx.cwd` for the directory.

Use theme callbacks supplied by Pi.

Do not run Git commands from `render()`.

---

## 15. Footer

Use `ctx.ui.setFooter()`.

Use:

- `ctx.model`
- `ctx.thinkingLevel`
- `ctx.getContextUsage()`
- `footerData.getGitBranch()`
- `footerData.onBranchChange()`

Conceptual output:

```text
● High · <model-id> · 8% · 2 files edited                  main
/ commands · @ files · ! shell
```

### Footer requirements

- Subscribe to `footerData.onBranchChange()`.
- Call `tui.requestRender()` when branch data changes.
- Dispose the subscription.
- Display context percentage only when Pi returns one.
- Display edited-file count only for observed successful `edit` and `write` tool calls with a validated path.
- Do not infer edits performed through shell commands.
- Fit every line within the supplied width.

---

## 16. Working indicator

Use only:

- `ctx.ui.setWorkingMessage()`
- `ctx.ui.setWorkingVisible()`
- `ctx.ui.setWorkingIndicator()`

Example:

```ts
export function installWorkingIndicator(
  ctx: ExtensionContext,
): void {
  const { theme } = ctx.ui;

  ctx.ui.setWorkingIndicator({
    frames: [
      theme.fg("dim", "·"),
      theme.fg("muted", "•"),
      theme.fg("success", "●"),
      theme.fg("muted", "•"),
    ],
    intervalMs: 120,
  });

  ctx.ui.setWorkingMessage("Working");
}
```

Do not invent a `setWorkingComponent()` API.

Do not replace Pi's entire working-loader implementation.

---

## 17. Activity widget

Use a widget for a compact live activity line near the editor.

```ts
ctx.ui.setWidget(
  "tui-skin.activity",
  (tui, theme) =>
    createActivityComponent({
      tui,
      theme,
      store,
    }),
  { placement: "aboveEditor" },
);
```

Allowed truthful examples:

```text
● Reading 2 files
● Searching
● Running bash
● Editing src/foo.ts
```

The widget may aggregate multiple currently active tool calls when the aggregation is directly derived from observed tool names.

Do not label inference as fact.

Forbidden examples:

```text
Analyzing scope
Planning architecture
Spawning agents
Saving agent state
Moving to cloud
```

### Strict persistence decision

Do not call `pi.appendEntry()` to create completed activity rows.

`CustomEntry` is officially model-context-free, but it still modifies persisted session structure. This project chooses a stricter visual-only boundary.

Use the built-in tool rows, custom tool rendering, and the live widget instead.

---

## 18. Lifecycle handlers

Use notification events to update presentation state.

Primary events:

- `session_start`
- `session_shutdown`
- `agent_start`
- `agent_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `model_select`
- `thinking_level_select`

Pi tool executions may overlap. Never model a single global "current tool".

Conceptual registration:

```ts
export function registerLifecycle(
  pi: ExtensionAPI,
  deps: LifecycleDependencies,
): void {
  pi.on("session_start", (_event, ctx) => {
    deps.onSessionStart(ctx);
  });

  pi.on("agent_start", () => {
    deps.store.setAgentRunning(Date.now());
  });

  pi.on("agent_end", () => {
    deps.store.setAgentIdle();
  });

  pi.on("tool_execution_start", (event) => {
    deps.store.startTool({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: event.args,
      startedAt: Date.now(),
    });
  });

  pi.on("tool_execution_end", (event) => {
    deps.store.finishTool({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      isError: event.isError,
      finishedAt: Date.now(),
    });
  });

  pi.on("model_select", () => {
    deps.store.notifyChanged();
  });

  pi.on("thinking_level_select", () => {
    deps.store.notifyChanged();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    deps.onSessionShutdown(ctx);
  });
}
```

### Lifecycle rule

These handlers MUST NOT:

- block tools,
- transform input,
- transform context,
- modify prompts,
- append messages,
- request continuation,
- cancel session actions,
- change model,
- change thinking level,
- change active tools.

---

## 19. Theme

Create:

```text
themes/tui-skin.json
```

Start from Pi's current built-in dark theme or the current official schema.

Do not hand-create an incomplete theme if the current schema requires additional roles.

Use:

- `name`
- `appearance: "dark"` where appropriate
- `vars`
- `colors`
- `$schema` when practical

### Important semantic roles

Use Pi's documented theme roles, including:

- `accent`
- `border*`
- `text`
- `muted`
- `dim`
- `success`
- `error`
- `warning`
- `selectedBg`
- `scrollbarTrack`
- `scrollbarThumb`
- `userMessage*`
- `customMessage*`
- `thinkingText`
- `toolPendingBg`
- `toolSuccessBg`
- `toolErrorBg`
- `toolTitle`
- `toolOutput`
- `md*`
- `toolDiff*`
- `syntax*`
- `thinking*`
- `bashMode`

### Theme rule

Components should consume semantic theme roles.

Do not scatter RGB literals or ANSI escape sequences through TypeScript renderers.

---

## 20. Built-in tool renderer overrides

Pi's documented built-ins are:

```text
read
bash
powershell
edit
write
grep
find
ls
```

The default enabled set is:

```text
read
bash
edit
write
```

Provide renderer coverage for all built-ins so users do not fall back to unrelated styling when they enable another built-in.

### Required pattern

Use same-name `pi.registerTool()` definitions.

Delegate execution to the corresponding official built-in implementation.

Override only presentation.

The official `built-in-tool-renderer.ts` example explicitly demonstrates this pattern.

### Public factories

Use package-root exports only, such as:

- `createReadTool`
- `createBashTool`
- `createPowerShellTool`
- `createEditTool`
- `createWriteTool`
- `createGrepTool`
- `createFindTool`
- `createLsTool`

The official package also exports the corresponding `create*ToolDefinition` factories. Either route is acceptable if the implementation preserves all behavior-affecting metadata and delegates execution exactly.

### Recommended wrapper shape

Prefer an implementation that minimizes manual copying of behavior-affecting fields.

If using an original tool definition:

```ts
const original = createReadToolDefinition(cwd);

pi.registerTool({
  ...original,
  renderShell: "self",

  async execute(
    toolCallId,
    params,
    signal,
    onUpdate,
    ctx,
  ) {
    const current = getBuiltins(ctx.cwd).read;

    return current.execute(
      toolCallId,
      params,
      signal,
      onUpdate,
    );
  },

  renderCall(args, theme, context) {
    return renderReadCall({
      args,
      theme,
      context,
    });
  },

  renderResult(result, options, theme, context) {
    return renderReadResult({
      result,
      options,
      theme,
      context,
    });
  },
});
```

If the factory type or current public API makes spreading the definition unsafe, copy the official example for the current Pi version and explicitly preserve every relevant public field.

### Current public `ToolDefinition` behavior-affecting fields

At the 0.87.1 baseline, public fields include:

- `name`
- `label`
- `description`
- `promptSnippet`
- `promptGuidelines`
- `parameters`
- `constrainedSampling`
- `renderShell`
- `prepareArguments`
- `executionMode`
- `execute`
- `renderCall`
- `renderResult`

The skin should change only renderer-related fields and delegate `execute()`.

### Tool cache

Tool implementations are cwd-sensitive.

Cache official tool instances by cwd if using the instance factories:

```ts
const toolCache = new Map<string, Builtins>();
```

Use `ctx.cwd` in execution.

Do not assume `process.cwd()` is always the correct runtime cwd.

### Render policy

Collapsed:

```text
◇ Read src/server.ts
◇ Search "ExtensionContext"
◇ Edit src/ui/editor.ts
◇ Bash npm test
```

Expanded:

```text
◇ Read src/server.ts
  <real Pi result>

◇ Bash npm test
  <real Pi output>
```

`renderResult()` may hide or summarize output in collapsed mode.

It MUST NOT alter the actual tool result returned from `execute()`.

Preserve Pi's expanded view so the user can inspect full results.

---

## 21. Core transcript boundary

The extension does not own the entire built-in transcript.

Pi supports extension renderers for extension-owned custom messages and custom entries. That is not a generic override for every core user or assistant message.

Therefore this project MUST NOT:

- replace `UserMessageComponent` globally through an undocumented hook,
- replace `AssistantMessageComponent` globally through an undocumented hook,
- replace every thinking block through an undocumented hook,
- shadow core messages with duplicate custom messages,
- create custom messages only to fake styling,
- create custom session entries only to fake built-in transcript rows,
- draw an independent terminal transcript over Pi.

Theme the core transcript where Pi exposes theme roles and accept remaining structural differences.

---

## 22. Non-TUI modes

Pi extensions load in:

- `tui`
- `rpc`
- `json`
- `print`

The extension MUST remain safe in all modes.

Install terminal components only when:

```ts
ctx.mode === "tui"
```

Do not assume `ctx.hasUI` means terminal rendering is available. RPC can expose dialog-capable UI semantics without being the terminal TUI.

Tool execution delegation must remain semantically identical in every mode.

---

## 23. Width and Unicode correctness

Every custom component receives an available terminal width.

Every rendered line MUST fit within it.

Use Pi TUI helpers:

- `visibleWidth()`
- `truncateToWidth()`
- `sliceByColumn()`
- `wrapTextWithAnsi()`

Do not use JavaScript string length as terminal column width.

Test:

- narrow terminal widths,
- wide terminals,
- emoji,
- CJK wide characters,
- combining characters,
- ANSI styling,
- resize events.

---

## 24. Render-path performance

Render methods run on Pi's interactive path.

Render methods MUST NOT:

- read files,
- spawn commands,
- run Git,
- perform network I/O,
- walk the full session tree on every frame,
- parse large outputs repeatedly,
- create timers.

Render methods SHOULD:

1. read a small snapshot,
2. format strings,
3. truncate or wrap to width,
4. return `string[]` or a small Pi component.

Cache expensive layout by content and width when needed.

Clear caches from `invalidate()`.

Call `tui.requestRender()` when state changes.

---

## 25. TypeScript rules

Follow these rules:

- use discriminated unions for state variants,
- use `unknown` at untyped event boundaries,
- narrow once at the boundary,
- avoid `any` in project-owned types,
- avoid `as` casts unless validation proves the claim,
- prefer `satisfies` where appropriate,
- use exhaustive switches for discriminated unions,
- derive types from official APIs when possible,
- keep pure formatting logic independent from Pi runtime objects.

Do not duplicate Pi's public type declarations.

Import official types from package roots.

---

## 26. Error handling

Presentation failures MUST NOT change agent behavior.

Examples:

- If the theme cannot be selected, keep Pi usable and report the presentation error through a documented UI notification if appropriate.
- If a renderer cannot parse optional display metadata, render a conservative fallback.
- If Git branch is unavailable, omit it.
- If context percentage is unavailable, omit it.
- If an event lacks enough data to count an edited file, do not count it.

Do not convert a display problem into a blocked tool or aborted agent run.

---

## 27. Recommended implementation order

Implement in this order.

### Phase 1: package and theme

1. Create `package.json`.
2. Create a complete valid `tui-skin.json`.
3. Verify Pi discovers both package resources.
4. Verify `/reload` succeeds without warnings.

### Phase 2: shell UI

1. Add `index.ts`.
2. Add TUI-mode guard.
3. Implement header.
4. Implement footer.
5. Implement terminal title.
6. Implement custom editor.
7. Implement working indicator.

Verify stock Pi behavior before adding tool renderers.

### Phase 3: presentation state

1. Add `PresentationStore`.
2. Subscribe to `agent_start` and `agent_end`.
3. Subscribe to tool lifecycle events.
4. Track active tool calls by `toolCallId`.
5. Track successful explicit `edit` and `write` paths.
6. Add the live activity widget.

### Phase 4: tool renderer overrides

Implement one built-in at a time:

1. `read`
2. `bash`
3. `powershell`
4. `edit`
5. `write`
6. `grep`
7. `find`
8. `ls`

After each override, verify the actual built-in execution result remains unchanged.

### Phase 5: polish

1. tune spacing,
2. tune colors,
3. tune compact labels,
4. test expansion,
5. test narrow widths,
6. test reload,
7. test non-TUI modes.

Do not add Reference-only behavior during polish.

---

## 28. Test strategy

### 28.1 Pure unit tests

Test pure functions for:

- path shortening,
- duration formatting,
- width truncation,
- activity grouping,
- edited-file counting,
- presentation-state transitions.

### 28.2 State tests

Prove:

- `agent_start` changes idle to running,
- `agent_end` returns to idle,
- multiple tool calls can be active simultaneously,
- finishing one tool does not clear unrelated active tools,
- failed edits do not increment edited-file count,
- repeated edits of one file count as one unique file if the UI says "files edited".

### 28.3 Renderer tests

For each renderer:

- collapsed call,
- collapsed success result,
- collapsed error result,
- expanded result,
- partial result when supported,
- narrow width,
- long path,
- wide characters.

### 28.4 Behavioral equivalence tests

The strongest check compares original and wrapped tool execution.

For representative valid inputs:

```text
original built-in execute(...)
wrapped built-in execute(...)
```

Assert equivalent:

- content,
- details,
- error behavior,
- abort behavior,
- streaming updates where practical.

Rendering may differ.

Execution must not.

### 28.5 Real TUI verification

Run Pi with the package and exercise:

- normal prompt,
- streaming response,
- Escape cancellation,
- steering,
- Alt+Enter follow-up,
- Shift+Tab thinking cycling,
- `/` commands,
- `@` completion,
- `!` shell,
- `!!` shell,
- read tool,
- edit tool,
- write tool,
- bash tool,
- grep/find/ls when enabled,
- PowerShell on a supported platform,
- tool expansion,
- session reload,
- Pi `/reload`,
- terminal resize,
- fullscreen mode,
- regular mode,
- theme change/reload.

Use `PI_TUI_WRITE_LOG` when diagnosing ANSI rendering issues, as recommended by Pi's TUI documentation.

---

## 29. Behavioral acceptance criteria

The implementation is accepted only when all statements below are true.

### Agent semantics

- No new LLM-callable tool exists.
- No new slash command exists solely for visual parity.
- No input transformation is installed.
- No context transformation is installed.
- No prompt modification is installed.
- No tool-blocking logic is installed.
- No model switching is performed by the extension.
- No thinking-level change is performed by the extension.
- No active-tool change is performed by the extension.
- No custom message is injected.
- No custom session entry is added for presentation.
- No provider request is changed.

### Editor semantics

- Escape still performs Pi's normal action.
- Enter still performs Pi's normal action.
- Alt+Enter still performs Pi's normal follow-up behavior.
- Shift+Tab still performs Pi's normal thinking-cycle behavior.
- User keybindings still work.
- Autocomplete still works.
- History still works.

### Tools

- Every overridden tool delegates execution to the official built-in implementation.
- Tool parameters stay identical.
- Tool prompt contributions stay identical.
- Tool execution mode stays identical.
- Tool result content stays identical.
- Only rendering changes.

### Session

- The extension does not add presentation-only entries to session history.
- The extension does not rewrite or filter model context.
- Resume and reload still work.

### UI

- Header resembles the reference video.
- Footer resembles the reference video.
- Editor resembles the reference video.
- Working indicator resembles the reference video.
- Tool rows use compact video-like rendering.
- Unsupported Reference-only features do not appear.
- Core transcript differences that Pi does not expose remain Pi-native.

---

## 30. Forbidden implementation shortcuts

Do not:

- fork Pi,
- patch Pi core,
- patch prototypes,
- intercept stdout to redraw the application,
- use raw terminal alternate-screen ownership to replace Pi,
- create a second terminal renderer,
- deep-import private source modules,
- use undocumented component replacement hooks,
- add a Plan mode,
- add a Question tool,
- add subagents,
- add cloud-agent behavior,
- add `&` command semantics,
- duplicate core transcript entries with custom messages,
- persist fake activity rows,
- change tool results to make them easier to render,
- use shell commands inside render methods,
- hard-code behavior that Pi already exposes through state.

---

## 31. Decisions that were considered and rejected

### Persisted `CustomEntry` activity rows

Pi documents `CustomEntry` as excluded from model context and supports `registerEntryRenderer()`.

Rejected for strict skin mode because `appendEntry()` still changes the session file.

Use live widgets and tool renderers instead.

### New Question tool

The official `question.ts` example proves this UI is possible.

Rejected because it adds an LLM-callable capability.

### Plan mode

The official examples include a plan-mode extension.

Rejected because it changes behavior and adds a mode.

### Subagents

The official examples include a subagent extension.

Rejected because it adds agent capabilities.

### Separate TUI host through SDK/RPC

A separate host could obtain more complete rendering control.

Rejected because the requirement is specifically a Pi extension.

### Second terminal renderer inside the extension

Rejected because Pi's official TUI documentation explicitly instructs extensions not to do this.

---

## 32. Expected visual result

The target should feel like the reference video while remaining visibly truthful to Pi.

Representative idle state:

```text
> agent
  Pi Coding Agent
  ~/src/project

┌──────────────────────────────────────────────────────────────┐
│ Ask, build, or change anything                              │
└──────────────────────────────────────────────────────────────┘
● High                                      shift+tab to cycle
GPT-6 Sol · 8% · 2 files edited                         main
/ commands · @ files · ! shell
```

Representative running state:

```text
◇ Read src/server.ts
◇ Search "ExtensionContext"
● Editing src/ui/editor.ts

┌──────────────────────────────────────────────────────────────┐
│ Add a follow-up                                  esc to stop │
└──────────────────────────────────────────────────────────────┘
● Working
GPT-6 Sol · 8% · 2 files edited                         main
/ commands · @ files · ! shell
```

The exact model label must come from Pi at runtime.

Do not hard-code the examples' model names.

---

## 33. Definition of done

The work is done only after:

1. the package loads without extension warnings,
2. the theme validates,
3. TypeScript type checking passes,
4. unit tests pass,
5. wrapped built-in tool execution is verified against original behavior,
6. normal TUI interaction is exercised manually or through the closest available real integration test,
7. reload is tested,
8. non-TUI modes are tested for safe loading,
9. narrow-width rendering is tested,
10. the final diff contains no undocumented Pi API usage,
11. the final diff contains no new agent feature added for video parity,
12. the final report states any remaining visual mismatch caused by Pi extension boundaries.

Do not declare success from compilation alone.

Inspect and run the real artifact.

---

## 34. Implementation summary for an AI agent

When implementing this specification:

1. Read the entire document before editing.
2. Inspect the target repository before choosing paths.
3. Check the currently installed Pi version.
4. Re-read the current official Pi docs for extension, TUI, package, theme, and tool-rendering APIs.
5. Use the current official examples as the implementation pattern.
6. Keep the extension factory thin.
7. Keep presentation state separate from Pi state.
8. Use `CustomEditor`, not a replacement editor implementation from scratch.
9. Use the callback-provided theme.
10. Use `FooterDataProvider` for git branch state.
11. Use lifecycle events only as observations.
12. Delegate built-in tool execution unchanged.
13. Do not add persisted presentation state.
14. Do not implement video features that Pi does not already have.
15. Build, run, inspect, and verify the finished package.

The governing principle is:

> If a change can affect what the model sees, what a tool does, what the session stores, or what a user command means, it is outside the scope of this skin.
