# Cursor customization host source discovery

## Scope and provenance

This partition gathers official customization contracts. It does not verify runtime behavior or accept parity. All nodes and edges are proposal-unverified. No installation, activation, Cursor service execution, model-backed Cursor journey, settings changes, secret access, commits, publication, or external communication occurred. Read-only public HTTP retrievals are retained under `sources/`.

The parent contract was read in two ranges, 1 through 387 and 388 through 437. The parent discovery review and all seven assigned documents were read fully. Hooks was read in ranges 1–400, 401–800, 801–1200 and 1201–1490. `read-receipts.json` records source hashes and actual read ranges. Copies of assigned documents preserve their exact bytes under `sources/snapshot-*.md`.

Old snapshots have no authenticated per-file retrieval time. The supplied original job start is 2026-10-08T03:25:31.833Z. File mtimes are observations only. Newly retrieved responses preserve bodies, response headers, curl JSON metadata including effective URLs, requested URLs, actual local retrieval start/end timestamps and SHA256. A current HTTP response does not prove the older snapshots remain current.

No authenticated physical model identity was established in this partition. Environment names would not establish provider authentication. No runtime was operated to resolve that distinction.

## Discovery and mode metadata

`plugins.md`, Component discovery in `sources/plugin-reference.md`, and `skills.md` establish different discovery contracts. Cursor manifests use `.cursor-plugin/plugin.json`; portable Agent Plugins use root `plugin.json`. Explicit component fields replace default directory discovery. Default discovery includes skills, agents, rules, commands, hooks and MCP. Root SKILL.md is a fallback only without a skills directory or manifest skills field.

Skills have project and user roots in `.agents` and `.cursor`, plus Claude and Codex compatibility roots. Discovery walks nested skill folders. Folder identity comes from the directory containing SKILL.md; nested project roots scope availability to their directory. Required name and description, optional paths, legacy globs fallback, disable-model-invocation, icon, color and metadata all matter. A manual skill attaches to one message. A custom mode keeps it in context on every turn until exit. `sources/prompting.md`, Custom Modes, records Option+Enter, Alt+Enter and Use as Mode. Unknown badge styles fall back to the default.

Plugin local loading has reload, administrator permission, same-name marketplace precedence and symlink containment branches. Team installation has Default Off, Default On and Required branches. Publishing a personal skill creates one plugin, does not bundle referenced skills, and is distinct from private cloud sync. These are supported branches, not inferred configured defaults.

## Authoring and rules

`skills.md` describes progressive resources, script paths relative to the skill root, references and assets. The built-in skill table includes create-skill, create-rule, create-hook, create-subagent, automate, loop and other managed workflows. Their public descriptions establish dependencies, not full subordinate contracts. Closed source does not remove those dependencies.

`rules.md` gives the alwaysApply/description/globs routing truth table. Rule file references are not inlined. Team, project and user rules merge with that precedence. Nested AGENTS.md combines parent instructions with more-specific precedence. User rules affect Agent Chat, not Inline Edit or Tab.

The plugin reference allows `.md`, `.mdc` and `.markdown` rule discovery, while project rules require `.mdc` and ignore plain `.md`. Keep plugin discovery and project-rule parsing distinct. The plugin reference's abbreviated agents format says name/description are required; the specialized subagents reference says both are optional. Resolve this by component context and observation rather than silently flattening the schemas.

## Tasks, models, context and permissions

`subagents.md` describes clean context without parent history, explicit necessary context in the launch prompt, foreground blocking and background immediate return. Default checkout sharing differs from optional worktree or VM isolation. Worktree isolation is same-machine isolation; cloud isolation uses its own VM and branch. Cloud MCP comes from team configuration rather than the local parent's servers.

Project agent names override user names, and Cursor roots override compatibility roots. Fields include model, readonly and is_background. readonly restricts file edits and state-changing shell commands. MCP inheritance is documented separately. Model inherit is the default; explicit IDs accept parameter brackets for effort, context and speed. Plan limitations, administrator blocking and legacy Max Mode can cause compatible fallback. Later FAQ text specifies Composer fallback and blocked-Composer failure conditions on legacy plans. Parent Auto does not mean children use Auto. Task cards and usage rows expose the model that ran.

Resume preserves agent context by returned ID. Background progress is written under the subagents directory. Failure returns error status. Nesting permits main-agent children and their children, but not another generation, and requires Task access and unblocked policy. These are public contracts, not evidence that any particular provider or cloud worker is working.

## Hooks and schemas

`hooks.md` is fully read. Generic tool hooks, subagent lifecycle, shell/MCP/file permission hooks, prompt submission, responses, thoughts, compaction, stop, Tab and workspace lifecycle are separate surfaces. Common payload includes conversation/generation identifiers, legacy and structured model identifiers/parameters, version, workspace roots, optional user and transcript fields. Workspace lifecycle omits agent-session fields.

Command hooks exchange JSON over stdio. Prompt hooks use a fast model, support model override and ARGUMENTS substitution. Cloud only supports command hooks. Read-only early cloud turns do not run hooks; session and MCP timing exclusions are documented. Self-hosted worker claim/release session boundaries differ from hosted cloud.

Exit 2 denies. Invalid JSON or schema-invalid permission responses deny even without failClosed. Other crashes, timeouts and nonzero exits normally fail open; failClosed changes that branch. All matching source hooks run. Deny outranks ask, which outranks allow. Messages concatenate. Other fields use the last response, with lower-priority sources overriding higher-priority ones for those fields. `sources/third-party-hooks.md` uses different general priority wording. Preserve this discrepancy for reconciliation.

preToolUse accepts ask but does not enforce it today. subagentStart treats ask as deny. Shell/MCP permission hooks support ask. sessionStart and sessionEnd are fire-and-forget, and sessionStart continue does not block creation. preCompact cannot block or modify compaction. Stop and completed-only subagentStop followups use configurable per-script limit 5, with null unlimited; Claude defaults differ. workspaceOpen can return absolute pluginPaths and runs on workspace folder changes, skipping empty workspaces.

Match targets, timeout, failClosed, source-relative cwd, trusted project requirements, config hot reload, environment variables and enterprise thirty-minute distribution are all separately cited in proposals. Script examples, fictional telemetry services, PyYAML guards and partner vendors are illustrative, not unconditional product dependencies.

## MCP transports and integration schemas

`mcp.md` documents stdio, SSE and Streamable HTTP; tools, prompts, resources, roots, elicitation and Apps. Local command entries support command, args, env and stdio-only envFile. Remote entries use url and headers. Static OAuth supports required CLIENT_ID, optional CLIENT_SECRET and scopes discovery. Web/Agents and desktop have different fixed callbacks. Interpolation includes environment, home, workspace and separators; plugin variables are a distinct schema-driven placeholder mechanism.

`plugin-reference.md` adds mcpServers custom path/inline/array override, plugin root expansion in command/args/env/cwd, and explicitly unsupported standard PLUGIN_ROOT/PLUGIN_DATA expansion. Agent Plugins require transport declaration while Cursor Plugins can infer command/url transport. Manifest paths must be relative, valid and exclude parent traversal.

MCP distribution is not authorization and allowlisting is not installation. Optional policy branches include command and URL patterns, automatic-tool allowlists and network modes allow-all, allowlist, deny-all and no-sandbox. Default tool approval is documented. Run Mode policy needs the separately retrieved but unread `sources/run-modes.md`. Disabled servers do not load or appear. Server crash/timeout marks that tool failed, reports an error, permits retry and leaves other servers operating.

`mcp-install-links.md` defines base64 JSON configuration in the cursor deeplink and an install confirmation prompt. The guessed extension-api Markdown path returned Page not found. Its response is preserved. The actual reference link remains unresolved; that is not evidence the API or service is unavailable.

## Proposal interpretation and remaining work

`proposals.json` contains 12 source nodes and 347 section-level evidence edges. Each edge carries an exact source file, heading locator, inclusive line span, full-file SHA256, verbatim quote, normative/conditional/illustrative classification, target host contract and proposal-unverified status. These are discovery sections, not independently falsifiable acceptance definitions. Mixed sections retain illustrative examples within normative text; sample payload values must not become product requirements.

`queue.json` retains unread relevant links, unresolved built-in bodies and schema dependencies. It excludes CLI discovery, which belongs to the other explorer. Missing located public contracts, untested working integrations, and legitimate denied/unavailable branches remain distinct. No missing service was demonstrated here. No closure, acceptance, frozen or passing verdict is issued.

## Exact next step

Read the preserved `sources/run-modes.md` in full with chunk continuation. Then resolve the real programmatic MCP registration reference through the official documentation index, preserving each new HTTP response and retrieval metadata. Follow queued model parameters, model-access, cloud capabilities and authoring schemas read-only. Reconcile the rule-format, agent-frontmatter and hook-merge context differences before splitting these proposals into independent requirements. Runtime operation remains outside this partition's authorization.
