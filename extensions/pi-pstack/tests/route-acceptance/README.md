# Routing acceptance probes

This matrix supplies the 23 distinct playbook prompts required by ZIP ROUTE-01. Three additional cases cover a large-task override, unattended work, and a Feature-to-Investigation task switch in the same persisted session. Expectations follow ZIP sections 4 and 12 and the pinned guide's `02-poteto-mode.md`, `03-understand.md`, and `07-overnight.md`.

Routing is model-mediated. This suite does not add a keyword classifier to the extension or treat a table lookup as a router run. The runner invokes installed Pi, explicitly loads the package extension and generated skills, and enters through native `/skill:poteto-mode` expansion. Each probe asks only for a routing decision and source read, not execution of the described task. The JSON output constraint and read-only tool selection are experiment controls. Only `read` is selected; extensions discovery, MCP, project trust, and unrelated context discovery are disabled.

Run offline checker negatives first:

```sh
npx vitest run tests/route-acceptance/evidence.test.ts
```

For real calls, select an OpenAI model from the operator's current `pstack-models.md`. For example, when `how explorer` is `openai/gpt-6.1-terra:medium`:

```sh
PSTACK_E2E_PI=/absolute/path/to/pi node tests/route-acceptance/run.ts \
  --model openai/gpt-6.1-terra:medium \
  --out /absolute/new/evidence/directory \
  --case investigation --case new-task-readonly
```

Use `--all` instead of `--case` to run all 26 cases, including the extra preceding Feature invocation for the task-switch case. Existing output directories are refused. No automatic experiment retries are added; any installed Pi provider-retry events remain in the raw stream. Keep failed attempts and use a new directory for any subsequent attempt.

The checker requires a normally stopped final choice, the expected source path, successful read results covering the entire selected file before that choice, and a no-PR declaration where applicable. It validates consumed event fields and the canonical empty `agent_start` payload, not the complete SDK event schema. Missing or malformed consumed fields require review. PR policy is checked only for the marked no-PR cases; other tasks can have context-dependent PR requirements. It accepts complete chunked reads. Mere filenames, model claims, truncated reads, failed reads and wrong tool-call identities do not establish a full read. An unfinished process, final provider error, malformed stream or unstructured reply cannot pass. Earlier provider errors do not invalidate an eventual successful response automatically.

Each invocation preserves its exact arguments, operator task, JSONL events, stderr, exit code and decision. The summary records the installed Pi and Node versions, selected model, source root, commit, dirty state and source digest before and after the run. Source changes invalidate the run. Logs are local evidence, not authenticated attestations.

A probe PASS establishes only this controlled routing property. It does not establish the complete chosen workflow, literal TODO creation, merge authorization, OS containment, or a final ZIP receipt. Outcome, workflow and Pi-implementation axes remain separate. The automatic workflow axis stays INCONCLUSIVE unless the trace shows a required routing step violated; Pi defect attribution requires review. Final ZIP acceptance still requires the complete matrix on the final source revision and review of its raw evidence.
