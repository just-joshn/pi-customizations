# Architecture decision

Use candidate A as the base. It keeps source instructions intact and provides the tool names that those instructions already use. Graft candidate B's strict exclusion of Benny from discovery, native model validation, and real SDK verification.

Both candidates independently chose SDK child sessions after examining process-based alternatives. SDK sessions expose completion, steering, cancellation, and persisted history without another protocol implementation. This convergence limits the diversity of the comparison. The review used an independent GPT agent, not the unavailable Claude or Grok models requested by the source skill.

Keep the full upstream directory immutable. Generate the operational skill directory because Pi requires legal skill names and different locations for the model rule and generated user or project skills. The generator changes only those bindings. It records every transformation and verifies all upstream hashes. Benny stays outside the package's skill manifest.

Use the actual typed `before_agent_start` event's mutable `systemPromptOptions.sections`. Do not return an invented `systemPromptOptions` result. This corrects the first candidate's incomplete reading of the current API.

The named state shapes are skill registry, branch-local mode and todo state, exact model choice, and child task lifecycle. Live child sessions belong to the worker manager. Durable state belongs to the owning Pi session. Cloud execution and external services remain explicit missing dependencies.

## Runtime modules

- `src/index.ts` registers skill aliases, mode state, todos, questions, workspace context, and the host contract.
- `src/models.ts` owns model selection and role configuration.
- `src/workers.ts` owns child sessions and task operations.
- `scripts/resources.mjs` verifies immutable source and generates the operational skills.

## Host contracts

Pi 0.87.1 exposes the package and extension APIs used here. The peer dependency ranges follow the official package guidance. Development dependencies pin the SDK used for verification. Runtime compatibility with other versions remains unverified.

Source instructions can require capabilities that this extension does not provide. The host contract preserves those gates and reports them. It must never describe local execution as cloud execution or copied automation prompts as a deployed automation.
