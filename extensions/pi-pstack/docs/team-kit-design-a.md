# Candidate A. One preserved package with a complete team-kit dependency bundle

This is a read-only design review by a GPT agent. It does not establish cross-family agreement.

## Grounded result

The inspected Cursor commit is ecc249f1e306fc64ddf83c7bed16cacf7c2239db. The team-kit manifest declares version 1.2.0. Its subtree has 29 files, 18 skills, two agents, and two alwaysApply rules. Pstack has direct references to exactly three kit skills. They are deslop, control-cli, and control-ui. References occur in the Poteto mode instructions, opening-a-pr, shipping, multi-phase-plan, autopilot-full, autopilot-stack, and orchestrate. The pstack README explicitly recommends installing the kit alongside pstack.

The complete kit has a small, cohesive dependency closure. All 18 skills are useful to pstack's review, verification, shipping, and preference-capture work. Preserving the whole kit eliminates selection arguments and includes its renderer assets and agent rubric. It adds no new external executable service. Commands embedded in the skills still require local tools and authentication.

## Current trace

1. package.json declares one skills directory and src/index.ts.
2. scripts/resources.mjs checks all 158 upstream file hashes, transforms only skill names and Pi directory references, emits 122 resources, and rejects unexpected output files.
3. index.ts scans immediate child skill directories and registers aliases with full-body expansion. Pi also discovers native skill commands through the package manifest.
4. before_agent_start adds the explicit host contract, model config, mode, and todos to systemPromptOptions.sections.
5. workers.ts accepts only generalPurpose, poteto-agent, comment-sicko, and Comment Sicko. It reads upstream agent prose, creates a DefaultResourceLoader with all generated skills, and starts a real SDK session.
6. Readonly workers disable all extensions. Therefore new global rules implemented only in the extension hook would disappear in those workers.

## Consumer usage first

- /deslop, /control-cli, /control-ui and /skill:deslop work with the exact upstream body and correct resource directory.
- All 18 kit workflows appear alongside the existing 47 skills. Native Pi frontmatter continues to hide pr-review-canvas and thermo-nuclear-code-quality-review from automatic model selection.
- Task with subagent_type ci-watcher or thermo-nuclear-code-quality-review reads the original persona body.
- Every parent and child receives both alwaysApply rules, regardless of sticky Poteto mode. Readonly child rules remain present even when extensions are disabled.
- A Cursor-only model value such as fast fails clearly unless the caller supplies a concrete configured Pi model. It does not select a guessed cheap provider.

## Proposed data shape and files

Keep upstream/ unchanged. Add upstream-team-kit/ with all 29 exact source files and a separate docs/team-kit-source-inventory.json. Append kit provenance to docs/provenance.json without changing the recorded pstack pin.

Keep a single generated skills/ directory. Extend scripts/resources.mjs with a fixed source descriptor array.

```ts
type SourceBundle = {
  directory: string;
  inventory: string;
};
const bundles = [
  { directory: 'upstream', inventory: 'docs/source-inventory.json' },
  { directory: 'upstream-team-kit', inventory: 'docs/team-kit-source-inventory.json' },
];
```

The script loops over these two descriptors with the existing exact-file and hash checks. Both write skills/<slug>/... and one resource map records the actual source root. Reject duplicate generated destinations before any write. Check the final union of outputs. The resulting census should be 187 preserved files and 143 generated skill resources. This keeps package skill discovery and index alias scanning unchanged.

Add a small src/personas.ts only if it replaces the existing persona branch chain and owns both agent bodies and alwaysApply rule text.

```ts
type Persona = {
  file: string | null;
  skills: readonly string[];
  defaultModel?: string;
};
const personas: Readonly<Record<string, Persona>> = {
  generalPurpose: { file: null, skills: [] },
  'poteto-agent': { file: 'upstream/agents/poteto-agent.md', skills: ['poteto-mode'] },
  'comment-sicko': { file: 'upstream/agents/comment-sicko.md', skills: [] },
  'Comment Sicko': { file: 'upstream/agents/comment-sicko.md', skills: [] },
  'ci-watcher': { file: 'upstream-team-kit/agents/ci-watcher.md', skills: [], defaultModel: 'fast' },
  'thermo-nuclear-code-quality-review': {
    file: 'upstream-team-kit/agents/thermo-nuclear-code-quality-review.md',
    skills: ['thermo-nuclear-code-quality-review'],
  },
};
```

The body loader parses frontmatter with the official parseFrontmatter function. The thermo rubric must be directly included or explicitly linked at its installed absolute path because disable-model-invocation prevents automatic discovery. Only ci-watcher supplies a model default. Task's explicit model or persisted resume model takes precedence. Its is_background true already agrees with the Task default.

Load the two rule bodies from their immutable source files. Validate their declared alwaysApply values at the boundary. The root adds them to a distinct before_agent_start section. Child DefaultResourceLoader appendSystemPrompt includes the same rule text, so readonly children retain them. Avoid duplicate injection in normal workers by giving the child the extension hook only when extensions are enabled, or using a documented single section override strategy. Do not create or alter user AGENTS.md files.

Update the existing host contract to say the three previous dependencies are bundled. Keep all actual host gaps. Point the host contract to the kit agent and resource locations.

## Contracts available from this change

- deslop performs its supplied diff review through ordinary tools.
- control-cli and control-ui provide complete repeatable local verification instructions. The agent must discover actual terminal or browser tooling as specified. Installation does not itself furnish tmux, Playwright, a browser, or an inspector.
- verify-this supplies the baseline/treatment method and exact verdict contract.
- PR workflows use git and gh with existing authentication.
- canvas has all three adjacent assets and its script-safe JSON injection guidance.
- the two kit rules apply through official structured system prompt sections.
- the two agent personas execute using the existing durable local SDK task lifecycle.

## Remaining limits and decisions

The thermo agent's example orchestrator asks for Task shell and explore. These are Cursor built-in personas, not published kit agent files. Do not invent their full behavior or claim host parity. Either explicitly expose limited Pi collector roles with documented tool sets and label that mapping as a local adaptation, or retain this example as a known missing built-in dependency. Exact new agent body execution can work independently because the parent may supply its already collected diff and contents.

ci-watcher's model fast is a host selector, not a portable provider/model ID. Requiring an explicit concrete model is the smallest honest behavior. Automatically inheriting the parent would erase its published model contract.

workflow-from-chats names Cursor chats. Pi workspace history can satisfy a documented local equivalent through pstack_context, but it cannot supply Cursor conversation links or hidden transcripts. Cite available parent conversation IDs without fabricating links. Original prose should remain preserved.

The in-app browser mentioned by pr-review-canvas is not built into Pi. Its generated local HTML remains usable through actual available browser tooling. State this distinction.

The kit supplies no /loop or /goal host primitive, no cloud Task environment, no automation editor, no Cursor built-in create-skill, and no Grok Bot runtime. loop-on-ci is an ordinary skill that executes a bounded model task with gh watch; it is not the missing persistent /loop primitive.

## Verification proposal

A new failing discovery expectation of 65 skills proves the starting gap. Add literal expected kit names rather than deriving expectations from the same inventory being tested. Exercise /deslop and /skill:control-cli through real SDK model prompt capture. Verify rule bodies in parent, normal child, and readonly child prompts. Test exact kit persona/rubric loading, ci-watcher fast rejection, explicit model success, and resume preservation. Resource checks prove 29 source hashes and all three canvas assets. Existing actual CLI RPC check should discover the kit commands and print a correct status census. Do not run external GitHub workflows or browser installs merely to prove resource portability.

## Official Pi evidence used

The pinned official Pi checkout is /private/tmp/pstack-pi-source at 2b0a123de98318c2ff8069661721ce0c3794c34e, version 0.87.1.

- packages/coding-agent/docs/skills.md specifies recursive SKILL.md discovery, relative resource paths, /skill:name expansion, disable-model-invocation semantics, and collision diagnostics.
- packages/coding-agent/docs/extensions.md documents registerCommand and before_agent_start structured systemPromptOptions sections.
- packages/coding-agent/docs/sdk.md describes DefaultResourceLoader and createAgentSession ownership.
- packages/coding-agent/src/core/resource-loader.ts declares additionalSkillPaths and appendSystemPrompt.

## Principles and selection

Model the Domain changes persona handling from another conditional branch to one closed registry. Build the Lever extends the existing checked generator rather than manually copying generated files. This design needs no provider abstraction, rule engine, scheduler, or replacement CLI. Its tradeoff is 18 extra skill descriptions in discovery, which is justified by the requested kit dependency closure. The parent should compare this bundled design with the independent alternative before implementation.
