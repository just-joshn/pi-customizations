# Official pi API references

The implementation targets the official repository revision recorded in [provenance](provenance.json). SDK 0.87.1 is installed as a development dependency for typechecking and runtime verification. Context7 searches for both pi coding agent and pi-mono returned unrelated projects under the configured library filters. The official repository was fetched directly instead.

| Used contract | Official reference |
| --- | --- |
| Package manifest, resource paths, host peer dependencies | [Pi packages](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/docs/packages.md) |
| Skill names, discovery, relative files, native commands | [Skills](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/docs/skills.md) |
| Tools, commands, questions, custom entries, shutdown, branch restoration | [Extensions](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/docs/extensions.md) |
| Mutable prompt sections and exact extension types | [Extension declarations](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/src/core/extensions/types.ts) |
| Child sessions, resources, prompt, steering, abort, disposal | [SDK](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/docs/sdk.md) |
| Extension binding, native input expansion order, shutdown mechanics | [AgentSession source](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/src/core/agent-session.ts) |
| Branch ownership and workspace-scoped history | [Session manager](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/src/core/session-manager.ts) |
| Real CLI check, acceptance versus completion, JSONL framing | [RPC](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/docs/rpc.md) |

SDK child construction explicitly binds extensions. Cleanup emits the child shutdown lifecycle before disposing the SDK session, so nested extension-owned workers can release resources. A bare `dispose()` is insufficient for that ownership contract. The worker test exercises recursive cleanup with actual SDK sessions.

## Team-kit documentation refresh

On 2026-09-26, fetching both repositories' `main` branches returned the same pinned revisions. Two Context7 searches using `pi coding agent` and `earendil-works/pi` returned only third-party projects under the configured filters. The official docs above and their exported types were read directly.

The team-kit increment uses existing package skill discovery, `parseFrontmatter`, structured `before_agent_start` sections, and the SDK resource loader's `appendSystemPrompt`. The latter carries persona and host-adaptation instructions into readonly children that deliberately disable tool extension loading. The comprehensive audit removed injected team-kit rules to match observed Reference plugin behavior. These APIs are defined in the [official resource loader](https://github.com/earendil-works/pi/blob/2b0a123de98318c2ff8069661721ce0c3794c34e/packages/coding-agent/src/core/resource-loader.ts).

Plugin contracts come from the [pinned team-kit source](the upstream plugins repository/tree/ecc249f1e306fc64ddf83c7bed16cacf7c2239db/team-kit). Its 18 skills, two agents, and two rules are preserved under `upstream-team-kit`. Neither the plugin nor pi documentation defines Reference's private `shell`, `explore`, cloud, or persistent scheduler behavior.

## Comprehensive audit refresh

On 2026-09-26, `git ls-remote https://github.com/earendil-works/pi HEAD` still returned the pinned revision above. Two Context7 library searches returned third-party projects only. The audit read the official repository and the installed declarations directly. Dialogs, mode changes, and todo updates use sequential execution. Worker controls remain explicitly parallel so a wait can coexist with the message or stop that releases it. Their lifecycle guards and real control-batch test are documented in the comprehensive audit. Failed child tool results retain nested usage through the documented `tool_result` return value. Readonly children copy only the selected provider registration through public `ModelRegistry` and `ModelRuntime` methods. See [the comprehensive audit](comprehensive-audit.md) for evidence and limits.
