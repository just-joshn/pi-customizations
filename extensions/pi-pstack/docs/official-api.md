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
