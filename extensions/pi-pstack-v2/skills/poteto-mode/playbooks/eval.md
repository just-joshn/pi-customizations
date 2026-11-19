### Eval

**You own the experiment design. Plan, blind, run, synthesize.**

**Non-negotiables for blinding:**

- No `eval`, `test`, `judge`, `experiment`, `rubric`, `score`, `compare`, `benchmark`, `candidate`, or `arena` in any directory, file, or prompt the candidate sees.
- The candidate prompt looks like an organic user request. State the goal, not the meta.
- No chain-eliciting cues. Don't ask the candidate to list which skills, principles, or files they applied. Ask for design notes generally and grade chain-following from code shape, not self-report.
- Sanitize directory and slug names. Use project-shaped names a user might pick.
- Don't tell the candidate other candidates exist.
- The judge can know it's judging but sees outputs by sanitized label only, never by model name.
- Comparing two variants: one judge scores both sets in a single pass on one scale, blind to which set each came from.

**Steps:**

1. **Frame.** State what variant is under test and what behavior counts as success. Write the rubric (3-6 concrete criteria) for the judge only. Hold it back from candidates.
2. **Set up sanitized environments.** Per-candidate working dir with the variant in place. `cwd` must be inside the session's project, so use a gitignored subdirectory. A worker still loads your whole Pi configuration, skills, and the `pstack-models` section, so blinding is limited to what the dir and the prompt hide. Plant any context an organic task would have: a project skeleton, the skills the candidate would naturally read.
3. **Author one organic prompt.** What a user would type. No leakage of what's being measured.
4. **Spawn N parallel candidates** in one `subagent` call with `tasks` and `agent: "poteto-agent"`, on different models per the **arena** skill's Phase B. Each works in its own sanitized dir (`cwd`). Same prompt to each. Pick each worker's thinking level for the job, per the Spawned Pi workers section. A worker that only dispatches, polls, or packs results runs on the `swarm workers` model at a low thinking level.
5. **Spawn one blinded judge** with `subagent` and `agent: "scout"` on a different model family per the **arena** skill's Phase C. Judge sees outputs by sanitized label and the rubric, never a model name. Its brief says it must not edit any output.
6. **Verify the chain from evidence, not self-report.** A worker runs with no session, so no session file records what it opened. Do not glob across `~/.pi/agent/sessions/`. That crosses workspace boundaries and reads private sessions from unrelated projects. The `subagent` result carries only each candidate's final report, not its tool calls. Grade chain-following from the diff in each candidate's worktree and the shape of the code, never from the candidate's own claims.
7. **Read every candidate output yourself** end to end. Compare to the judge's verdict. Disagreement means a model is biased or the rubric is ambiguous. Synthesize.

**Reply:** variant under test, rubric, per-candidate notes, judge's verdict, your synthesis, and a recommendation for whether to promote the variant.
