# Architecture decision

Use candidate A as the base. It keeps source instructions intact and provides the tool names that those instructions already use. Graft candidate B's strict exclusion of Benny from discovery, native model validation, and real SDK verification.

Both candidates independently chose SDK child sessions after examining process-based alternatives. SDK sessions expose completion, steering, cancellation, and persisted history without another protocol implementation. This convergence limits the diversity of the comparison. The review used an independent GPT agent, not the unavailable Claude or Grok models requested by the source skill.

Keep the full upstream directory immutable. Generate operational skills with portable names and Pi paths. Generate prompt templates for reusable input and workflow entry points. Remove unsupported Reference frontmatter from active skills. The generator records every transformation and verifies all upstream hashes. Benny stays outside the package's skill manifest.

Use the actual typed `before_agent_start` event's mutable `systemPromptOptions.sections`. Do not return an invented `systemPromptOptions` result. This corrects the first candidate's incomplete reading of the current API.

The named state shapes are skill registry, branch-local mode and todo state, exact model choice, and child task lifecycle. Live child sessions belong to the worker manager. Durable state belongs to the owning Pi session. Cloud execution and external services remain explicit missing dependencies.

## Runtime modules

- `src/index.ts` registers the package through domain modules. `commands.ts` owns explicit and native mode/setup invocation. `state.ts` owns immutable branch snapshots and todo tools. `questions.ts` validates dialog inputs. `context.ts` owns status and workspace evidence. `host.ts` supplies the host instructions. Only mode and setup instructions are read at extension initialization.
- `src/models.ts` owns model selection and role configuration.
- `src/workers.ts` registers task tools. `worker-runtime.ts` owns child lifecycle and usage accounting. `worker-support.ts` constructs sessions and copies the selected provider into readonly runtimes. `worker-records.ts` validates durable task records.
- `src/personas.ts` owns the closed persona catalogue, parent-model inheritance and complete review rubric.
- `scripts/resources.mjs` verifies immutable source and generates operational skills and prompt templates. Pi discovers both through the package manifest.

The [mechanism audit](mechanism-audit.md) supersedes the original design's executable aliases. Native prompt templates own pure text entry points. Their instructions ask the model to read the full skill from the bundled path in the extension's host context. This preserves on-demand skill loading without copying workflow bodies into templates. `/bro` needs only a prompt. Mode and setup retain extension commands because they own state and dialogs.

Worker shutdown waits for registered child sessions and unfinished child construction. A generation check prevents a cancelled startup from binding session resources or publishing task state. Child resources remain owned by the parent runtime.

## Team-kit extension of the design

The [second design comparison](team-kit-design-review.md) selects one combined package. A fixed list of two source descriptors retains independent provenance without adding package dependency discovery. The complete source and destination union is checked before generation writes any skill. The original pstack snapshot stays at `upstream/`; the 29-file kit snapshot lives at `upstream-team-kit/`.

The added data shape is a closed persona catalogue. Explicit Task model choice takes precedence over a persisted resume choice, then the persona's published default. `ci-watcher` inherits the parent, matching the observed Reference plugin loader; explicit unresolved selections fail through the exact model resolver. Unpublished Reference personas are not inferred from their names.

Both kit rules have `alwaysApply: true` in the preserved source. Runtime observations show the Reference plugin loader omits them. The port therefore leaves them archived. Readonly workers disable tool extensions but retain their selected provider registration in an isolated model runtime. No user configuration or project AGENTS.md file is changed.

## Host contracts

Pi 0.87.1 exposes the package and extension APIs used here. The peer dependency ranges follow the official package guidance. Development dependencies pin the SDK used for verification. Runtime compatibility with other versions remains unverified.

Source instructions can require capabilities that this extension does not provide. The host contract preserves those gates and reports them. It must never describe local execution as cloud execution or copied automation prompts as a deployed automation.

The extension's `pstack/models.mdc` file stores role preferences. It does not configure providers and is not a Pi context file. The extension explicitly reads it. Use Pi's `models.json` for compatible provider endpoints and a provider extension when authentication or protocols need executable behavior.
