const referenceNouns = 'Replace a Reference-only noun with its Pi equivalent.';
const stale = 'Resolve a stale or contradictory upstream guard natively.';
const store = 'Name the agent store directory from the host contract and the orch writers that own each store file.';
const mode = /^skills\/poteto-mode\/SKILL\.md$/;
const playbooks = (...names) => new RegExp(`^skills/poteto-mode/playbooks/(?:${names.join('|')})\\.md$`);
const taskTrail = 'a cloud Task id (read its record with `TaskOutput` or `TaskAttach`)';
const codeShipping = 'Invoked at the end of every playbook that ships a code change. Those are Bug fix, Perf issue, Hillclimb, Feature, Refactoring, Visual parity, and Authoring a skill.';

export default [
  [/^skills\/poteto-mode\/(?:SKILL|playbooks\/authoring-a-skill)\.md$/, "(Reference's built-in for authoring SKILL.md files)", "(the host contract names its file, which targets Pi's SKILL.md format)", referenceNouns],
  [
    mode,
    'Agent-facing prose also follows the **create-skill** skill',
    'Agent-facing prose also follows the **create-skill** skill for SKILL.md structure and description rules (an imperative `Use when` or `Apply when` trigger clause is accepted)',
    stale,
  ],
  [mode, 'the `deslop` skill from the `team-kit` plugin (`/deslop`)', 'the **deslop** skill (`/deslop`)', referenceNouns],
  [
    mode,
    '`team-kit` publishes `control-cli` (CLIs and TUIs) and `control-ui` (browser / Electron / web UIs).',
    'The bundled `control-cli` skill drives CLIs and TUIs and the bundled `control-ui` skill drives browser / Electron / web UIs.',
    referenceNouns,
  ],
  [mode, ", and not Reference's built-in babysit skill, whose description matches the same words.", '. Pi has no built-in babysit or autopilot skill, so this playbook is the only route.', stale],
  [
    playbooks('babysit'),
    "This playbook replaces Reference's built-in babysit skill for these requests, so do not route there even though its description matches the same words.",
    'Pi has no built-in babysit or autopilot skill, so this playbook is the only route for these requests.',
    stale,
  ],
  [mode, 'Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`) set', 'Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`, `arena`, `architect`) set', stale],
  [mode, 'PR link as `https://github.com/<owner>/<repo>/pull/<number>`', 'PR link as the URL from the resolved forge (`gh pr view` or `origin pr view`)', 'Name the resolved forge for the reply link, since Origin PRs are not on GitHub.'],
  [mode, 'from a transcript, cloud-agent URL, or pushed branch', `from a transcript, ${taskTrail}, or a pushed branch`, referenceNouns],
  [playbooks('session-pickup'), 'a cloud-agent URL', taskTrail, referenceNouns],
  [mode, 'a Reference restart', 'a Pi restart or reload', referenceNouns],
  [/^skills\/poteto-mode\/(?:SKILL|playbooks\/opening-a-pr)\.md$/, 'Invoked at the end of every other playbook.', codeShipping, stale],
  [mode, '- Broken skill mid-task →', '- Bot buttons, bot dashboards, or a bot UI over a routine → the **make-bot-ui** skill.\n- Broken skill mid-task →', 'Route bot UI requests to the bundled make-bot-ui skill.'],
  [
    playbooks('opening-a-pr'),
    'A subagent that opens a PR runs `interrogate`, `/deslop`, and `/no-comments`, and posts the URL.',
    'A subagent that opens a PR runs `interrogate` when its design is contested, then `/deslop` and `/no-comments`, and posts the URL.',
    stale,
  ],
  [playbooks('opening-a-pr'), 'Run `/deslop` from `team-kit` over the diff', 'Run `/deslop` over the diff', referenceNouns],
  [
    playbooks('babysit'),
    'Undeclared defaults to `drive`. Small or docs-only PRs get `check`, not `drive`.',
    'Undeclared defaults to `drive`, except that an undeclared request on a small or docs-only PR defaults to `check`.',
    stale,
  ],
  [
    playbooks('session-pickup'),
    `4. Route the remaining work to the matching playbook and pick the verdict: continue the execution, ship a finished recommendation, ratify or override a prior conclusion, or postmortem a failed run. The pickup playbook ends here. The routed playbook owns the rest.
5. Verify the inherited claims against the original goal on the real artifact (the **principle-prove-it-works** skill). A passing prior self-report is not the proof.`,
    `4. Verify the inherited claims against the original goal on the real artifact (the **principle-prove-it-works** skill). A passing prior self-report is not the proof. Step 3 forbids redoing the work. This step checks the inherited result on the real artifact before routing and does not redo completed work.
5. Route the remaining work to the matching playbook and pick the verdict: continue the execution, ship a finished recommendation, ratify or override a prior conclusion, or postmortem a failed run. The pickup playbook ends here. The routed playbook owns the rest.`,
    stale,
  ],
  [
    playbooks('pause-safely'),
    'This is explicit only. On',
    'This is explicit only. Explicit only contrasts with keep-going phrases, not with the compaction trigger, which is automatic. On',
    stale,
  ],
  [
    playbooks('hillclimb'),
    'A `decision.tsv`, one row per attempt: id, hypothesis, change, before, after, delta, tests, verdict (kept or reverted), note.',
    "A `decisions.tsv` with that skill's columns (ts, phase, decision, why, evidence, result), one row per attempt. Put the attempt id and hypothesis in the decision cell, the change with the before and after numbers and the delta in the evidence cell, and the tests and the verdict (kept or reverted) in the result cell.",
    'Use the show-me-your-work log name and columns instead of a second schema.',
  ],
  [playbooks('hillclimb'), 'the `decision.tsv` path', 'the `decisions.tsv` path', 'Use the show-me-your-work log name instead of a second schema.'],
  [playbooks('bug-fix'), "with Reference's `/loop` command.", 'with the `/loop` command the host contract names.', referenceNouns],
  [
    playbooks('autonomous-run'),
    "Pick the wake mechanism using Reference's `/loop` command (a built-in, not a pstack skill).",
    'Pick the wake mechanism using the local `loop` skill the host contract names (`/loop`).',
    referenceNouns,
  ],
  [
    playbooks('worktree-cleanup'),
    'misses one that lives at `.upstream/worktrees/myrepo/x`',
    'misses one that lives under a different worktree root, such as a Pi Task cloud checkout under `pstack-workers`',
    referenceNouns,
  ],
  [
    playbooks('worktree-cleanup'),
    'Get that set from the user or sidebar and cross-check every candidate.',
    'Ask the user for that set, because Pi has no chat sidebar to read it from. Cross-check every candidate against the user-supplied pinned set.',
    referenceNouns,
  ],
  [
    playbooks('worktree-cleanup'),
    '`scratch:N` is untracked throwaway, safe to drop, but name the files.',
    '`scratch:N` is untracked throwaway, safe to drop, but name the files. Treat a worktree with any untracked or ignored files as work in progress until the user has seen the file names, never as safe to drop.',
    'Never bucket untracked or ignored work for deletion without the user seeing it.',
  ],
  [
    playbooks('worktree-cleanup'),
    "`~/Library/Application Support/Reference` (`state.vscdb.backup`, and `snapshots/roots/<root>` where a `<root>` named for a folder you opened as a workspace balloons)",
    '`~/.pi/agent` growth (`sessions/` transcripts, `pstack-workers/` child transcripts and Task worktrees, and timer roots)',
    referenceNouns,
  ],
  [
    playbooks('worktree-cleanup'),
    'Clear only caches the user has not said to keep.',
    "Clear only caches the user has not said to keep. Before deleting any simulator, runtime, or cache, list each item with its size and get the user's confirmation. The deletion is irreversible.",
    'Gate irreversible simulator and cache deletion on a listed-size confirmation.',
  ],
  [playbooks('autopilot-full', 'autopilot-stack'), '(the `deslop` skill from the `team-kit` plugin (`/deslop`))', '(the **deslop** skill, `/deslop`)', referenceNouns],
  [playbooks('autopilot-full'), 'such as `control-cli` or `control-ui` from `team-kit`, or a named driver', 'such as `control-cli` or `control-ui`, or a named driver', referenceNouns],
  [
    playbooks('multi-phase-plan'),
    'Browser, Electron, and web UIs use `control-ui` from `team-kit`. CLIs and TUIs use `control-cli` from `team-kit`.',
    'Browser, Electron, and web UIs use the bundled `control-ui` skill. CLIs and TUIs use the bundled `control-cli` skill.',
    referenceNouns,
  ],
  [
    playbooks('multi-phase-plan'),
    "write the file under the agent store's `docs/`.",
    'write the file under `docs/` in the agent store directory the host contract names.',
    store,
  ],
  [
    playbooks('orchestrate'),
    "runtime verification (from `team-kit`)",
    'runtime verification (the bundled control skills)',
    referenceNouns,
  ],
  [
    playbooks('orchestrate'),
    "in the current agent's store (path in the system prompt).",
    'in the agent store directory the host contract names. Export `ORCH_STORE` as the path of that `orchestrate/<project-slug>/` directory before the first `orch` call, or pass `--store <that directory>`, because `orch` fails without one.',
    store,
  ],
  [
    playbooks('orchestrate'),
    'while its canonical plain TSV and JSON stay readable without the CLI.',
    'while its canonical plain TSV and JSON stay readable without the CLI. The files are read-only for humans and agents. Change them only through `orch`, because it fails closed on a hand edit that breaks the exact headers, column widths, gate blocks, or numbering.',
    store,
  ],
  [
    playbooks('orchestrate'),
    '`gates.md` parks human gates (question, options, default on no answer).',
    '`gates.md` parks human gates (question, options, default on no answer). `orch gate park` writes them, `orch gate list` lists the open ones, and `orch gate resolve` records the answer.',
    store,
  ],
  [playbooks('orchestrate'), 'Park each as a `gates.md` entry before asking', 'Park each with `orch gate park` before asking', store],
  [playbooks('orchestrate'), '`status.md` is derived from `units.tsv` and `ledger.tsv` at each drain', '`status.md` is derived from `units.tsv`, `ledger.tsv`, `frontier.json`, and `gates.md` at each drain', store],
  [
    playbooks('orchestrate'),
    'and seed `frontier.json` from existing PRs with `orch frontier set --repo <repo-dir>`.',
    "and seed `frontier.json` from existing PRs. Run `git fetch` first and check each head against the forge's `headRefOid`. Then run `orch frontier set --repo <repo-dir>`.",
    'Seed the frontier from fetched refs and forge heads, since a lagging local branch records a stale SHA.',
  ],
  [
    playbooks('orchestrate'),
    "Recompute `frontier.json` from `gt` after every merge and stack mutation because GitHub base refs drift mid-restack while gt tracking is authoritative: ordered PR list, branch names, head SHAs, a generation number, the lowest unmerged PR. Resolve it where gt knows the stack, normally the stacker's clone. A checkout whose gt metadata never saw the submits reports no PRs and the command errors rather than guessing.",
    "Recompute `frontier.json` with `orch frontier set --repo <repo-dir>` after every merge and stack mutation. It holds the ordered PR list, branch names, head SHAs, a generation number, and the lowest unmerged PR. Run `git fetch` first and check each head against the forge's `headRefOid`, because GitHub base refs drift mid-restack. The command derives the chain from `gt` when it is present and from the forge's PR base-branch chain (`gh pr list`) when it is not. Resolve it where the stack is visible, normally the stacker's clone. A checkout that cannot see the stack reports no PRs and the command errors rather than guessing.",
    'Make the frontier forge-neutral so a repository without Graphite can run orchestrate.',
  ],
  [
    playbooks('orchestrate'),
    'Exactly one stacker per stack may run `gt`, serialized within its stack.',
    'Exactly one stacker per stack may restack, with `gt` when the repository uses it, serialized within its stack.',
    'Make the single-stacker rule forge-neutral.',
  ],
  [
    playbooks('orchestrate'),
    "the cloud agent's status in the Reference dashboard.",
    '`TaskList` with `repository: true`, `TaskAttach` status reads (which reconcile a cloud record without sending a prompt), and `TaskOutput` without resume.',
    referenceNouns,
  ],
  [playbooks('orchestrate'), 'After a Reference restart:', 'After a Pi restart or reload:', referenceNouns],
  [
    playbooks('orchestrate'),
    '`orch` replaces a lock whose holder pid is gone.',
    "`orch` replaces a lock whose holder pid is gone. A lock held by a live pid blocks the write, so retry after a short backoff. If an unrelated process reused the dead holder's pid, run the command again with `--force` to steal the lock.",
    'Name the lock recovery for a live holder and a reused pid.',
  ],
  [/^skills\/reflect\/SKILL\.md$/, "hand to Reference's built-in `create-skill` skill", 'hand to the `create-skill` skill', referenceNouns],
  [/^skills\/automate-me\/SKILL\.md$/, "Reference's built-in `create-skill` (authoring)", 'the `create-skill` skill (authoring)', referenceNouns],
  [/^skills\/automate-me\/SKILL\.md$/, "Use Reference's built-in `create-skill` skill", 'Use the `create-skill` skill', referenceNouns],
  [
    /^skills\/why\/SKILL\.md$/,
    'list the available MCPs from the Reference environment. Use the available-tools map when present. Otherwise inspect the `mcps/` directory Reference exposes for enabled MCP servers.',
    'list the available MCPs by calling `pstack_context` and classifying the MCP tools it returns.',
    referenceNouns,
  ],
  [/^skills\/workflow-from-chats\/SKILL\.md$/, 'recent Reference chats', 'recent agent chats', referenceNouns],
  [
    /^skills\/setup-pstack\/SKILL\.md$/,
    "If Reference also exposes a models API or CLI that lists the user's entitled models, prefer it for completeness.",
    "If Pi also exposes a model registry or CLI that lists the user's configured models, prefer it for completeness.",
    referenceNouns,
  ],
];
