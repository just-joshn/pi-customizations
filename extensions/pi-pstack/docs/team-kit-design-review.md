# Team kit design judgment

## Decision

Select candidate A, the single pi-pstack package with a second preserved source bundle. Include all 18 kit skills, both published agents, both alwaysApply rules, and the adjacent canvas assets. Graft candidate B's explicit source identity and agent metadata into that package. Do not introduce a second installable package or dependency API for this request.

This is an independent review by a GPT-family agent. It does not satisfy the requested cross-family Claude/Grok review diversity.

## Scores

Scores assess the proposed design, not completed implementation. Five is strongest.

| Criterion | Candidate A | Candidate B | Reason |
| --- | ---: | ---: | --- |
| Source fidelity | 5 | 5 | Both retain original source, assets, metadata, and explicit host gaps. |
| Runtime completeness | 4 | 3 | A connects existing discovery and lifecycle directly. B adds package resolution and independent registration that still need integration. Both retain missing host behavior. |
| Maintainability | 5 | 3 | A adds one fixed source descriptor and extends current ownership. B adds an exported resource interface and packaging coordination without a requested separate consumer. |
| Verifiability | 5 | 4 | A extends existing source, discovery, prompt, and package checks. B additionally needs dependency installation and separate module-root coverage. |
| Total | 19 | 15 | A is the better base for this repository. |

## Evidence checked

I read the existing generator, package manifest, worker construction, and prompt section registration. The generator owns one complete source inventory, skill derivation, executable modes, and the generated resource map. The worker presently accepts only generalPurpose, poteto-agent, and Comment Sicko aliases. Readonly workers disable extensions but keep explicit skill paths. This confirms both candidates' main integration assumptions.

The actual kit agent files declare `ci-watcher` with `model: fast` and `is_background: true`. The thermo agent requires its full skill rubric and shows parent collection through Cursor `shell` and `explore` personas. Neither persona is published in this kit. Both rule files declare `alwaysApply: true` with no file filter.

The actual pstack README recommends installing the kit alongside pstack. Its Poteto skill explicitly calls deslop, control-cli, and control-ui. The three direct references establish the minimum dependency repair. Bundling all 18 is reasonable under this request because the complete small kit also supplies related CI, verification, review, and conversation workflows. Count the remaining 15 as newly available workflows, not 15 proven pstack parity fixes.

The pinned official Pi skills documentation confirms native skill expansion and `disable-model-invocation`. Its package documentation explicitly requires bundled dependent Pi resources and separate module roots. The actual resource-loader type exposes `additionalSkillPaths` and `appendSystemPrompt`. These APIs support A without a new package loader. Documentation freshness and Context7 retrieval remain the parent's shared grounding responsibility.

## Required implementation decisions

1. Preserve pstack's existing upstream directory and pin. Give the kit its own source directory, inventory, and provenance entry. Validate the complete destination union before writing generated resources, so a collision cannot partially replace a source.
2. Keep all 18 skill bodies and three canvas assets. Preserve native hidden-skill metadata. Alias availability alone must not be described as automatic model discovery for those hidden skills.
3. Put persona source selection and defaults in one closed registry. Preserve explicit model override, then resumed concrete model, then the published persona default. An unresolved `fast` must fail clearly. Inheriting the parent silently loses the source's declared model choice.
4. Put both rule bodies in every relevant main and child prompt. Ordinary children receive them through the extension hook. Readonly children receive them through their explicit appended prompt. Avoid two copies in ordinary child sessions.
5. Make the thermo rubric directly available to its agent through an absolute installed path or full body. Its hidden discovery flag makes a vague instruction to find it insufficient.
6. Keep Task lifecycle ownership in workers.ts. Do not duplicate Task registration in a kit extension.
7. Do not emulate Cursor `shell` or `explore` based on their names. The published kit source does not establish their complete policies. Disclose the unsupported parent example while supporting the thermo agent when its caller supplies collected evidence.
8. Update the host gap statement precisely. The three named kit skill dependencies become bundled. Cloud hosting, durable loop/goal scheduling, automation editing, external tools, Cursor history, and browser availability remain separate gaps.

## Design red flags

Candidate A passes the interface review if the source descriptor remains a fixed internal list for two bundles. A general plugin registry, configuration system, or rule engine would be unnecessary.

Candidate B's resource export exposes package layout across worker and extension ownership. Separate packages would be justified by independent installation or release requirements, but those are absent here. Its package boundary therefore adds coordination without enough hidden behavior. There is no need to graft that boundary.

## Evidence required before a parity claim

The parent should verify the source inventory and packed artifact, native and alias expansion, actual parent and child rule prompts, readonly rule retention, kit persona and rubric prompts, exact model failure and override, and resume behavior. Expected discovery is 65 skills. Expected preserved files are 187, including all 29 kit files. Expected generated skill resources are 143. Those figures should be confirmed from the generated artifact.

User instructions request test-first verification and coverage; the higher-priority developer instruction prohibits adding or running tests unless the user asks for testing or verification. The parent's authorization interpretation governs execution. This design review ran no tests and made no implementation edits.

Complete kit resource and local persona delivery will improve parity. It cannot establish 100% behavior parity while the explicit host gaps remain.
