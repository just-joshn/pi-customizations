# JavaScript and Electron applications

```bash
node scripts/rea.mjs analyze-javascript-application /absolute/path/to/app --json
node scripts/rea.mjs analyze-javascript-application /absolute/path/to/app.asar --artifact-format asar --json
```

The analyzer reads an extracted tree or an ASAR, parses JavaScript and HTML as **inert text**, and
never executes, requires, or evaluates anything in the target. A declared ASAR member whose bytes
disagree with the header's integrity fails the call; use `--integrity-policy record-and-continue`
only when you want the inventory despite the contradiction.

## Read the summary, then the node you need

```bash
node scripts/rea.mjs inspect-analysis-view <evidence_id> --view summary --json
node scripts/rea.mjs inspect-analysis-view <evidence_id> --view section --selector ipc-handler --json
node scripts/rea.mjs inspect-analysis-view <evidence_id> --view item --selector <node_id> --json
```

`summary` reports `ipc` counters, BrowserWindow and context-bridge counts, native add-on bindings,
the electron role files, and `statistics`. Use it to answer "what is in here" before drilling in.

## Nodes the graph can contain

| Node kind | What it means |
| --- | --- |
| `package` | A `package.json` that parsed, with `name`, `version`, `main` and its parse status |
| `javascript-asset` | A file read as text, with its parse status and digest |
| `javascript-module` | A module reference: `resolved`, `external` (a built-in, `electron`, or a package that is not vendored here), or `unresolved` |
| `electron-main`, `electron-renderer`, `preload-entrypoint` | Electron process roles, each with its `mechanism` (`package.json:main`, `html-script-entrypoint`, `webPreferences.preload`) and `resolution_status` |
| `browser-window` | A `new BrowserWindow({...})` site, with the declared `web_preferences` and whether each value is literal or dynamic |
| `context-bridge-api` | `contextBridge.exposeInMainWorld(...)`, with member names when the object is a literal and `unknown_members` when it is computed |
| `ipc-handler` | One `ipcMain`/`ipcRenderer` registration or transmission, with side, operation, channel and handler location |
| `ipc-channel` | One literal channel aggregating both sides; `handles`/`invokes` edges point at the handlers |
| `native-addon`, `native-export` | A `.node` file, and each JavaScript request for a member of it |
| `source-map` | A `.map` file found beside its script |
| `artifact` | A file retained by content digest |

Edge relations: `imports`, `contains`, `loads`, `handles`, `invokes`, `exposes`, `maps_to`.

## What the graph does not prove

- A `paired` channel is a **candidate**: two sides using the same channel name does not prove they
  exchange messages at runtime.
- A dynamic `preload` expression stays unresolved, so `preload_entrypoints` stays `0`. Do not read
  that as "there is no preload"; read the `browser-window` node's `web_preferences` for the expression.
- `native_export_verification: "not-performed"` means the requested member names are JavaScript
  syntax, not verified exports of the add-on.
- A bundle observed in this graph does not prove every module executed. Nothing here was run.
- Counts come from this port's own lexer. They describe this scan; a differently ordered expression
  may remain unresolved where a full parser would not. `visited_ast_nodes` counts tokens, `findings`
  counts observations in the graph, and `modules` counts resolved specifiers — all three are this
  port's own measures, not the reference parser's.
- `summary.ipc.ambiguous_renderer_transmissions`, `sender_validation_observations`,
  `utility_processes` and `resolved_utility_entrypoints` are reported as `0` because this port does
  not detect those constructs. A zero there means "not observed here", never "absent".

## Feature tracing recipe

1. Find the seed. Search the sections for the feature's name:
   `--view section --selector javascript-module`, then `ipc-handler`, then `context-bridge-api`.
2. Follow one relationship at a time with `--view item --selector <node_id>`; the returned edges are
   the neighborhood of that node.
3. Collect the chain: renderer call site → channel → main handler → the module it imports.
4. Report the chain with the node IDs and the `resolution_status` of every link, and name the links
   that stayed dynamic. A chain with an unresolved link is a partial answer, not a finding.

Reading a large graph: page sections with `--offset` and `--limit`. `remaining` and `total` are page
counters; `coverage.source_complete` is the producer's own completeness. They are different claims —
never read "no more pages" as "nothing else exists".

Comparing two versions of an application is not implemented in this port. Analyze both, keep both
`evidence_id`s, and compare the summaries and named sections yourself; record any difference you
cannot explain as an unknown.
