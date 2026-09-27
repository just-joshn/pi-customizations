# Candidate B. A bundled dependency package

## Scope and evidence

This is a read-only design. The source checkout is `/private/tmp/pstack-cursor-source`, at the supplied `ecc249f1e306fc64ddf83c7bed16cacf7c2239db`. Cursor Team Kit is version 1.2.0. It contains 18 skills, two agents, and two always-applied rules. Its helpers are instructional shell or browser recipes, except the PR canvas HTML/CSS/JavaScript assets. It has no cloud runtime to reuse.

Official Pi package guidance in `/private/tmp/pstack-pi-source/packages/coding-agent/docs/packages.md`, under Declare dependencies, explicitly permits package dependencies, but requires their resources to be included in the published tarball and referenced via node_modules resource paths. It also warns that separate packages have separate module roots. The existing pi-pstack uses current host peer dependencies correctly. Documentation freshness and Context7 retrieval belong to the root's shared grounding pass. This candidate uses the checked-out official 0.87.1 documentation, not remembered APIs.

I applied Model the Domain by separating source-package identity from skill names and agent profiles. I applied Architect and How by tracing actual registration and child loading before choosing ownership. This is an independent GPT-family candidate. It does not satisfy the source skill's requested Claude/Grok review diversity.

## Traced current behavior

1. `scripts/resources.mjs` trusts one inventory for `upstream/`, verifies all source hashes, and emits its `skills/` subtree with three narrowly recorded text transformations. Generated artifacts have an exhaustive second inventory.
2. `src/index.ts` reads each immediate skill directory, parses the frontmatter, and registers both command aliases and Pi's native skill resources. Mode and setup use custom stateful handling. The host contract currently says cursor-team-kit is absent.
3. `src/workers.ts` owns Task execution and rejects every persona outside generalPurpose, poteto-agent, and the two Comment Sicko spellings. It hardcodes the source agent filename and only adds the pstack skills directory to each child loader.
4. Readonly children omit extensions. They retain explicitly supplied skill directories, but any new kit rule injected solely through a kit extension would be absent in those children.
5. Kit `control-cli`, `control-ui`, and `deslop` directly close pstack's named dependency gates once discoverable. These instructions already use normal local tools. No browser tool emulation is needed to execute their chosen local harness routes.

## Caller examples first

An installed pstack user invokes `/deslop` before committing or reads `/skill:control-cli` to drive their CLI. They should get the actual kit body and correct reference directory.

A parent invokes `Task({subagent_type: 'thermo-nuclear-code-quality-review', prompt: '### Git / diff output\n...\n### Changed file contents\n...', model: '<available exact Pi model>'})`. The child receives the original kit agent prompt and can load the complete kit review rubric.

A caller invokes `Task({subagent_type: 'ci-watcher', prompt: 'Watch this branch CI', model: '<available exact Pi model>', run_in_background: true})`. The child can execute the source gh commands. The original `model: fast` is a source alias, not a verified Pi model. This design must refuse an unresolved default or let an explicit model override it. Silently mapping fast to the parent would claim a model decision the source never made.

Kit's thermo agent also prescribes parent preparation through `Task({subagent_type: 'shell', ...})` and `Task({subagent_type: 'explore', ...})`. Existing workers reject both. Full delivery of that agent requires documented host adapters for those built-in Cursor roles, or an explicit unmet-role error. Merely shipping the rubric does not fix the orchestration.

## Proposed separate ownership

Create a sibling package `extensions/pi-cursor-team-kit` with the kit's complete immutable source, a hash inventory, generated skills, and the minimal rule/alias extension. Keep package-specific source generation in that package. Publishable pi-pstack bundles a pinned dependency and declares its resource paths. The concrete package shape is:

- `pi-cursor-team-kit/upstream/`. Exact kit source, including manifest, license, agents, rules, and canvas assets.
- `pi-cursor-team-kit/skills/`. All 18 native Pi skill directories, preserving all reference assets.
- `pi-cursor-team-kit/src/index.ts`. Kit-only aliases and rule injection.
- `pi-cursor-team-kit/src/resources.ts`. Public resource descriptions for pstack worker integration.
- `pi-cursor-team-kit/docs/`. Source inventory and transformation records.
- `pi-pstack/src/workers.ts`. Continues to own worker lifecycle; consumes the additional agent profiles and skill roots explicitly.

The pstack manifest declares kit skill resources through its bundled dependency path. It must also include the kit extension path or otherwise call a documented kit registration entrypoint. Do not rely on npm dependency installation alone to make Pi discover resources.

Sketch:

```ts
type AgentProfile = Readonly<{
  name: string;
  instructionsFile: string;
  defaultModel?: string;
  background?: boolean;
}>;

type KitResources = Readonly<{
  skillDirectory: string;
  agents: readonly AgentProfile[];
  ruleFiles: readonly string[];
}>;

export function kitResources(): KitResources;
```

Rules have `alwaysApply: true` and no file globs. The kit extension can place their original bodies in a dedicated official `before_agent_start` system prompt section. Worker creation must append the same rules to readonly child prompts because those children intentionally disable extensions. The kit must not import or register Task itself. That remains one owner in pstack.

## Why this is structurally distinct

Candidate B preserves independent Pi package installation and versioning for the two plugins. It avoids converting pstack's single-source generator into a general registry. The dependency package exposes only resources, never worker state. It makes all kit components available as a complete plugin dependency, useful outside Poteto mode as the original kit is.

## Tradeoffs and likely synthesis

This design has real distribution cost. The user requested one pstack extension. A sibling package requires npm publishing or explicit tarball inclusion, an additional lifecycle registration path, and proof that source installs and packed installs resolve it consistently. The node_modules reference is fragile if a developer installs only the local pstack directory and its dependency tree was never materialized. An unpublished file dependency can work locally yet break when packed.

I would select a unified in-package source registry for this request if it keeps the current upstream path stable, records kit as a separate source, and loads both plugins' resources through one extension. Graft Candidate B's explicit package identity, agent metadata, and rules ownership onto that simpler distribution. Do not create generic dependency resolution or a plugin API solely for two pinned sources.

## Missing semantics that remain relevant

| Source instruction | Current behavior | Feasible response |
| --- | --- | --- |
| Pstack requires deslop/control-cli/control-ui. | Host prompt marks all absent. | Bundle original kit skills and register native resources plus aliases. Remove this specific gap statement. |
| Kit agent loads its rubric. | Unknown persona rejected. | Add kit agent profile and all kit skill paths to writable and readonly children. |
| Kit agent preparation uses shell/explore. | Unknown personas rejected. | Add explicit host role adapters with accurate tool policy, or document role limitation. Exact Cursor policies are absent from the kit source. |
| ci-watcher requests fast model and background execution. | Parent model selected when no model supplied; every task defaults background. | Preserve declared metadata, require exact model resolution, and document unavailable fast alias. Do not claim full agent default parity. |
| Kit rules always apply. | No kit rules. | Inject original rule bodies in main and child sessions, including readonly. |
| control-cli uses PTY/tmux and profiling. | Built-in Pi bash executes commands. | Instructions can create standard local harnesses. Verify local program availability before use. No unconditional PTY or screen tool parity claim. |
| control-ui uses local Playwright/CDP. | No built-in browser automation. | Use repo tools per source. Report missing runtime/browser dependencies. |
| pr-review-canvas requests in-app browser and background server. | Pi has no Cursor browser. | Preserve assets and generate HTML; document external browser/CDP path. Built-in bash background process longevity needs real evidence. |
| workflow-from-chats requires Cursor parent citations without exposing local paths. | pstack_context lists Pi workspace history and transcript paths. | Scope to Pi corpus and use session IDs, explicitly naming corpus. Never invent Cursor links or claim Cursor corpus completeness. |
| TaskOutput polling with timeout if encountered. | Only block boolean, no bounded wait. | Optional bounded wait can improve cancellation and orchestration but needs exact source caller evidence. |
| Cloud agents, loop/goal, reviewed automation editor, Grok Bot. | Explicitly unavailable. | Kit supplies none of these. Keep existing unmet gates. |
| Cross-family model review. | Depends on configured provider/model availability. | No kit addition fixes missing provider credentials or absent models. |

## Verification and risks

Use direct SDK load and native `/skill:deslop` plus `/deslop` to prove source body and location. Assert the full skill census and exact asset bytes. Exercise a kit persona through real SDK child creation and inspect the actual child prompt. Verify both always-applied rule bodies in normal and readonly child prompts. Assert unknown role and unavailable fast-model errors remain truthful. Pack the extension and inspect all source files, generated resources, and dependency paths; local filesystem success is insufficient.

Keep the tests scoped to this integration. Do not introduce new tests during this design-only pass. The root must resolve the developer restriction on unsolicited tests before running any new implementation checks.

The main risks are duplicated command aliases when the standalone kit is also installed, resource discovery differing between local and packed installs, kit rules missing from readonly children, and generic role aliases silently promising Cursor tool semantics. These favor the unified package for this user's current request.
