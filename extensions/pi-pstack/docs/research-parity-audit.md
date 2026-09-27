# Research parity audit

This audit checks the pstack Pi extension against `~/.cursor/research/pstack-ecosystem-reverse-engineering.md`. `test/research-parity.test.ts` encodes the checkable claims and reruns with `npm test`.

## Source identity

`upstream/` matches `/Users/josh-desktop/src/experiments/plugins/pstack` and the Cursor cache at commit `ecc249f1e306fc64ddf83c7bed16cacf7c2239db` byte for byte, ignoring `.DS_Store`, `.omc`, and the cache marker. `upstream-team-kit/` matches the source `cursor-team-kit`. Every claim about source content therefore holds or fails identically in the snapshot.

## Claims

| Report section | Claim | Result |
| --- | --- | --- |
| 1 | pstack 0.15.5 by Lauren Tan, skills and agents directories | Holds. Snapshot manifest is identical. |
| 2 | Sticky mode until explicit opt-out | Holds. `pstack_mode` and `/poteto-mode off`. |
| 2 | 23 playbooks at the listed paths | Holds. Tested against the directory and the mode's routing text. |
| 2 | Five non-negotiable gates | Holds. Generated mode text keeps them. |
| 3 | 23 principle skills | Holds. Tested against the directory and the mode's citations. |
| 4 | 17 roles, four budget labels, effort ladder | Holds. `src/models.ts` maps efforts to Pi thinking levels and writes `# budget: <name> (<effort>)`. |
| 4, 6.1 | Always-applied global model rule | Holds with a Pi path. The rule lives at `~/.pi/agent/pstack/models.mdc` and the host contract injects it every turn. |
| 5 | deslop, control-ui, control-cli, thermo review, workflow-from-chats | Holds. All bundled with the complete team-kit snapshot. |
| 6.2 | recall, automate-me, show-me-your-work, and eval read workspace transcripts | Violation, fixed. Generated skills named `~/.cursor/projects/<slug>/agent-transcripts`, which Pi never writes. They now name the Pi session store, its `--<slug>--` form, and `pstack-workers` child transcripts. The host contract names both directories. |
| 6.3 | Shipping probes `command -v origin` before `gh` | Holds. Prose preserved. |
| 6.3 | Mode overrides the built-in babysit | Holds. |
| 6.3 | `/loop`, `/create-skill`, cloud timers | Host capability, not pstack. The report and the upstream guide both call `/loop` a Cursor built-in. The host contract names it as an unmet gate. |
| 7 | Benny is dormant | Holds. Preserved, not discoverable. |
| 7 | watch-pr verdicts and backoff, orch stores, check-plan rules | Holds. Upstream helper suites pass through `npm run check:upstream`. |
| 7 | worktree-audit dates the last agent chat per worktree | Violation, fixed. The script searched Cursor transcripts, so every Pi-touched worktree showed no chat and could reach the `safe` bucket. It now searches the Pi session directory of the main worktree and of each worktree. It also dated files with BSD `stat -f` and `date -r`, which fail when GNU or uutils coreutils lead PATH, as on the audited machine. Perl now reads the dates. |
| 8 | Agents poteto-agent, comment-sicko, ci-watcher, thermo review, and a 10-chapter guide | Holds. |

## Report inaccuracies

These claims do not match the pinned source. The port keeps the source, not the report.

- Section 5 says unslop has thirty-three rules. Its numbering reaches 33 but skips 4, 6, and 21, so it holds 30 rules.
- Section 5.3 says the thermo agent's rubric is identical to `interrogate/references/code-quality-review.md`. The agent file loads the thermo skill, and neither file matches the interrogate reference. They share the 1k-line rule, the spaghetti-growth rule, and code-judo framing.
- Section 5's diagram links `automate-me` and `workflow-from-chats`. Neither skill names the other.
